from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from . import activity, store, workspace
from .perf_index_db import _connect, _init_db, _root, _LOCK
from .perf_index_core import _registry, _todos_path, index_doc_path, remove_doc, sync

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


def apply_doc_project_ids(doc: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    path_value = str(doc.get("path") or "")
    if not path_value:
        return doc
    root = _root().resolve()
    path = (root / path_value).resolve()
    if root != path and root not in path.parents:
        raise ValueError("Path escapes Workspace")
    if not path.exists():
        return doc
    normalized = normalize_project_payload(payload)
    try:
        text = path.read_text(encoding="utf-8")
        meta, body = store._frontmatter_parse(text)
        meta["project"] = normalized.get("project") or ""
        meta["projects"] = normalized.get("projects") or []
        meta["project_id"] = normalized.get("project_id") or ""
        meta["project_ids"] = normalized.get("project_ids") or []
        store._atomic_write(path, store._frontmatter_dump(meta) + body.rstrip() + "\n")
        return store._doc_from_path(str(meta.get("kind") or doc.get("kind") or "note"), path, include_body=True)
    except Exception:
        return doc


def apply_todo_project_id(item: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_project_payload(payload)
    path = _todos_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        if not isinstance(data, list):
            data = []
        changed = False
        for row in data:
            if isinstance(row, dict) and row.get("id") == item.get("id"):
                row["project"] = normalized.get("project") or ""
                row["project_id"] = normalized.get("project_id") or ""
                changed = True
                break
        if changed:
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            tmp.replace(path)
    except Exception:
        pass
    return {**item, "project": normalized.get("project") or "", "project_id": normalized.get("project_id") or ""}


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


def update_doc(doc_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    sync()
    with _connect() as conn:
        _init_db(conn)
        row = conn.execute("SELECT path,kind FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not row:
        sync(force=True)
        with _connect() as conn:
            _init_db(conn)
            row = conn.execute("SELECT path,kind FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not row:
        raise FileNotFoundError(doc_id)
    path = _root() / str(row["path"])
    kind = str(row["kind"])
    text = path.read_text(encoding="utf-8")
    meta, body = store._frontmatter_parse(text)
    allowed = {
        "title", "status", "project", "projects", "project_id", "project_ids", "tags", "kind_marks", "pinned",
        "record_date", "due", "added_date", "summary_type", "authors", "year", "venue", "doi", "url", "cite_key",
    }
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
    with _LOCK:
        store._atomic_write(path, store._frontmatter_dump(meta) + body.rstrip() + "\n")
    activity.record("doc_update", ref=doc_id, kind=kind, title=str(meta.get("title") or doc_id), project=str(meta.get("project") or ""))
    index_doc_path(path)
    return store._doc_from_path(kind, path, include_body=True)


def delete_doc(doc_id: str) -> dict[str, Any]:
    sync()
    with _connect() as conn:
        _init_db(conn)
        row = conn.execute("SELECT path,kind,title,project FROM documents WHERE id=?", (doc_id,)).fetchone()
    if not row:
        raise FileNotFoundError(doc_id)
    path = _root() / str(row["path"])
    trash = _root() / "System" / "Trash" / str(row["kind"])
    trash.mkdir(parents=True, exist_ok=True)
    target = trash / f"{datetime.now().strftime('%Y%m%d%H%M%S')}-{path.name}"
    with _LOCK:
        shutil.move(str(path), str(target))
    activity.record("doc_delete", ref=doc_id, kind=str(row["kind"]), title=str(row["title"] or doc_id), project=str(row["project"] or ""))
    remove_doc(doc_id)
    return {"ok": True}
