from __future__ import annotations

import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from . import activity, store, workspace
from .sync_engine import mutation_lock
from .perf_index_db import _connect, _init_db, _root, _LOCK
from .perf_index_core import (
    _registry, index_doc_path, ensure_ready,
    _remove_doc_conn, _affected_sources, _refresh_graph_edges, _sync_activity_conn, _refresh_status,
)

def normalize_project_payload(payload: dict[str, Any]) -> dict[str, Any]:
    out = dict(payload or {})
    records = _registry()
    by_id = {str(x.get("id") or ""): x for x in records if str(x.get("id") or "")}
    by_name = {str(x.get("name") or "").casefold(): x for x in records if str(x.get("name") or "")}
    raw_ids = out.get("project_ids")
    if not isinstance(raw_ids, list):
        raw_ids = [out.get("project_id")] if out.get("project_id") else []
    ids = [str(x).strip() for x in raw_ids if str(x or "").strip()]
    raw_names = out.get("projects")
    if not isinstance(raw_names, list):
        raw_names = [out.get("project")] if out.get("project") else []
    names = [str(x).strip() for x in raw_names if str(x or "").strip()]
    resolved_ids: list[str] = []
    resolved_names: list[str] = []
    for pid in ids:
        rec = by_id.get(pid)
        if rec and pid not in resolved_ids:
            resolved_ids.append(pid)
            name = str(rec.get("name") or "").strip()
            if name and name not in resolved_names:
                resolved_names.append(name)
    for name in names:
        rec = by_name.get(name.casefold())
        if rec:
            pid = str(rec.get("id") or "").strip()
            canonical = str(rec.get("name") or name).strip()
            if pid and pid not in resolved_ids:
                resolved_ids.append(pid)
            if canonical and canonical not in resolved_names:
                resolved_names.append(canonical)
        elif name not in resolved_names:
            resolved_names.append(name)
    out["project_ids"] = resolved_ids
    out["project_id"] = resolved_ids[0] if resolved_ids else ""
    out["projects"] = resolved_names
    out["project"] = resolved_names[0] if resolved_names else ""
    return out


def normalize_project_update(existing: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Explicit edits replace old associations; untouched associations persist."""
    merged = {**existing, **payload}
    names_changed = "project" in payload or "projects" in payload
    ids_changed = "project_id" in payload or "project_ids" in payload
    if names_changed and not ids_changed:
        merged.pop("project_id", None)
        merged.pop("project_ids", None)
    if ids_changed and not names_changed:
        merged.pop("project", None)
        merged.pop("projects", None)
    if "project" in payload and "projects" not in payload:
        merged["projects"] = [payload["project"]] if payload["project"] else []
    if "project_id" in payload and "project_ids" not in payload:
        merged["project_ids"] = [payload["project_id"]] if payload["project_id"] else []
    return normalize_project_payload(merged)


def _safe_workspace_path(rel: str) -> Path:
    root = _root().resolve()
    target = (root / str(rel or "")).resolve()
    if target != root and root not in target.parents:
        raise ValueError("Path escapes Workspace")
    return target


def _tree_node(path: Path, include_children: bool = False) -> dict[str, Any]:
    root = _root().resolve()
    node = {
        "name": path.name if path != root else "Workspace",
        "path": "" if path == root else str(path.relative_to(root)).replace("\\", "/"),
        "type": "dir" if path.is_dir() else "file",
    }
    if path.is_file():
        try:
            st = path.stat()
            node["size"] = st.st_size
            node["modified"] = datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds")
        except OSError:
            pass
        return node
    node["lazy"] = True
    if include_children:
        children = []
        try:
            items = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.casefold()))
        except OSError:
            items = []
        for item in items:
            if item.name.startswith(".") or item.is_symlink():
                continue
            children.append(_tree_node(item, include_children=False))
        node["children"] = children
        node["child_count"] = len(children)
    return node


def workspace_tree_root() -> dict[str, Any]:
    return _tree_node(_root().resolve(), include_children=True)


def workspace_children(rel: str = "") -> dict[str, Any]:
    path = _safe_workspace_path(rel)
    if not path.exists():
        raise FileNotFoundError(str(path))
    if not path.is_dir():
        raise ValueError("Path is not a directory")
    return _tree_node(path, include_children=True)


def create_doc(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_ready()
    with mutation_lock, _LOCK:
        doc = store.create_doc(kind, normalize_project_payload(payload))
        index_doc_path(str(doc["path"]))
        return doc


def update_doc(doc_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_ready()
    with mutation_lock, _LOCK:
        return _update_doc(doc_id, payload)


def _update_doc(doc_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with _connect() as conn:
        _init_db(conn)
        row = conn.execute("SELECT path,kind FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not row:
        raise FileNotFoundError(doc_id)
    path = _root() / str(row["path"])
    kind = str(row["kind"])
    text = path.read_text(encoding="utf-8")
    meta, body = store._frontmatter_parse(text)
    schedule_changed = kind == "milestone" and bool({"start_date", "due", "progress"} & payload.keys())
    payload = normalize_project_update(meta, payload)
    if schedule_changed:
        payload.update(store.normalize_milestone_schedule(payload))
    allowed = {
        "title", "status", "project", "projects", "project_id", "project_ids", "tags", "kind_marks", "pinned",
        "record_date", "due", "added_date", "summary_type", "authors", "year", "venue", "doi", "url", "cite_key", "attachment",
    }
    if kind == "milestone":
        allowed.update({"start_date", "progress"})
    for key in allowed:
        if key in payload:
            meta[key] = payload[key]
    meta["updated"] = datetime.now().isoformat(timespec="seconds")
    if "body" in payload:
        body = str(payload.get("body") or "")
    if kind == "literature" and "bibtex" in payload:
        bib = str(payload.get("bibtex") or "").strip()
        block = f"```bibtex\n{bib}\n```" if bib else "```bibtex\n\n```"
        if store.BIBTEX_BLOCK_RE.search(body):
            body = store.BIBTEX_BLOCK_RE.sub(lambda _m: block, body, count=1)
        else:
            body = f"## BibTeX\n\n{block}\n\n" + body
    if hasattr(store, "_normalize_projects"):
        store._normalize_projects(meta)
    for project_name in meta.get("projects", []) or []:
        workspace.ensure_project(str(project_name))
    with mutation_lock, _LOCK:
        store._atomic_write(path, store._frontmatter_dump(meta) + body.rstrip() + "\n")
    activity.record("doc_update", ref=doc_id, kind=kind, title=str(meta.get("title") or doc_id), project=str(meta.get("project") or ""))
    index_doc_path(path)
    return store._doc_from_path(kind, path, include_body=True)


def delete_doc(doc_id: str) -> dict[str, Any]:
    result = delete_docs([doc_id])
    if result["failed"]:
        failure = result["failed"][0]
        if failure.get("error") == "FileNotFoundError":
            raise FileNotFoundError(doc_id)
        raise OSError(failure["message"])
    return {"ok": True}


def delete_docs(doc_ids: list[str]) -> dict[str, Any]:
    """Move an explicit selection to Trash, updating graph dependencies once."""
    ensure_ready()
    root = _root()
    deleted, failed, keys = [], [], set()
    with mutation_lock, _LOCK:
        with _connect(root) as conn:
            _init_db(conn)
            for doc_id in dict.fromkeys(doc_ids):
                row = conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,)).fetchone()
                try:
                    if not row:
                        raise FileNotFoundError(doc_id)
                    path = root / str(row["path"])
                    trash = root / "System" / "Trash" / str(row["kind"])
                    trash.mkdir(parents=True, exist_ok=True)
                    target = trash / f"{datetime.now().strftime('%Y%m%d%H%M%S%f')}-{path.name}"
                    shutil.move(str(path), str(target))
                except (OSError, ValueError) as exc:
                    failed.append({"id": doc_id, "message": str(exc), "error": type(exc).__name__})
                    continue
                keys.update((doc_id.casefold(), str(row["title_key"])))
                _remove_doc_conn(conn, doc_id, update_graph=False)
                deleted.append(doc_id)
                activity.record("doc_delete", ref=doc_id, kind=str(row["kind"]), title=str(row["title"] or doc_id), project=str(row["project"] or ""))
            if deleted:
                _refresh_graph_edges(conn, _affected_sources(conn, keys) - set(deleted))
                _sync_activity_conn(conn, root=root)
                conn.commit()
                _refresh_status(conn, root)
    return {"deleted": deleted, "failed": failed}
