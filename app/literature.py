from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .workspace import ensure_workspace

READING_STATUSES = ("未读", "在读", "已读")
ANNOTATION_TYPES = ("highlight", "underline", "strikeout", "rect", "ink", "note")

def _root() -> Path:
    root = ensure_workspace() / "Knowledge" / "Literature"
    for rel in ("PDF", "Annotations", "Notes", "Index", "Previews"):
        (root / rel).mkdir(parents=True, exist_ok=True)
    return root

def _registry_path() -> Path:
    return _root() / "Index" / "library.json"

def _load_registry() -> dict[str, Any]:
    p = _registry_path()
    if not p.exists():
        return {"version": 1, "items": []}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict): raise ValueError()
        data.setdefault("items", [])
        return data
    except Exception:
        return {"version": 1, "items": []}

def _save_registry(data: dict[str, Any]) -> None:
    p = _registry_path()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)

def _safe_name(name: str) -> str:
    base = Path(str(name or "paper.pdf")).name
    stem = re.sub(r"[^\w\-. ()\[\]]+", "_", Path(base).stem, flags=re.UNICODE).strip(" ._")[:120] or "paper"
    return stem + ".pdf"

def list_items(query: str = "", status: str = "", category: str = "", page: int = 1, page_size: int = 60) -> dict[str, Any]:
    rows = list(_load_registry().get("items") or [])
    q = str(query or "").strip().lower()
    if q:
        rows = [x for x in rows if q in " ".join([
            str(x.get("title") or ""), str(x.get("authors") or ""), str(x.get("venue") or ""),
            " ".join(x.get("tags") or []), " ".join(x.get("categories") or [])
        ]).lower()]
    if status:
        rows = [x for x in rows if x.get("reading_status") == status]
    if category:
        rows = [x for x in rows if category in (x.get("categories") or [])]
    rows.sort(key=lambda x: str(x.get("updated_at") or x.get("created_at") or ""), reverse=True)
    total = len(rows)
    page = max(1, int(page)); page_size = max(10, min(200, int(page_size)))
    start = (page - 1) * page_size
    return {"items": rows[start:start+page_size], "total": total, "page": page, "page_size": page_size}

def get_item(paper_id: str) -> dict[str, Any]:
    for item in _load_registry().get("items") or []:
        if item.get("id") == paper_id:
            return item
    raise FileNotFoundError(paper_id)

def update_item(paper_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    data = _load_registry()
    allowed = {"title","authors","year","venue","doi","url","cite_key","bibtex","reading_status","categories","tags","projects","favorite","last_page","page_count"}
    for item in data.get("items") or []:
        if item.get("id") != paper_id: continue
        for key in allowed:
            if key in patch:
                value = patch[key]
                if key == "reading_status" and value not in READING_STATUSES: value = "未读"
                if key in {"categories","tags","projects"}:
                    value = list(dict.fromkeys(str(v).strip() for v in (value or []) if str(v).strip()))
                item[key] = value
        item["updated_at"] = datetime.now().isoformat(timespec="seconds")
        _save_registry(data)
        return item
    raise FileNotFoundError(paper_id)

def delete_item(paper_id: str) -> dict[str, Any]:
    data = _load_registry()
    item = next((x for x in data.get("items") or [] if x.get("id") == paper_id), None)
    if not item: raise FileNotFoundError(paper_id)
    pdf = (_root() / "PDF" / str(item.get("stored_filename") or "")).resolve()
    data["items"] = [x for x in data["items"] if x.get("id") != paper_id]
    trash = ensure_workspace() / "System" / "Trash" / "Literature"
    trash.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    for p in (pdf, annotation_path(paper_id), note_path(paper_id), _root() / "Previews" / paper_id):
        if p.exists(): shutil.move(str(p), str(trash / f"{stamp}-{p.name}"))
    _save_registry(data)
    return {"ok": True}

def import_pdf(filename: str, source_path: Path, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    metadata = metadata or {}
    paper_id = uuid.uuid4().hex
    name = _safe_name(filename)
    dest = _root() / "PDF" / f"{paper_id}-{name}"
    h = hashlib.sha256()
    with source_path.open("rb") as src, dest.open("wb") as out:
        head = src.read(5)
        if head != b"%PDF-": raise ValueError("仅支持有效 PDF 文件")
        h.update(head); out.write(head)
        while True:
            chunk = src.read(1024 * 1024)
            if not chunk: break
            h.update(chunk); out.write(chunk)
    now = datetime.now().isoformat(timespec="seconds")
    item = {
        "id": paper_id, "title": str(metadata.get("title") or Path(name).stem),
        "authors": str(metadata.get("authors") or ""), "year": str(metadata.get("year") or ""),
        "venue": str(metadata.get("venue") or ""), "doi": str(metadata.get("doi") or ""),
        "url": str(metadata.get("url") or ""), "cite_key": str(metadata.get("cite_key") or ""),
        "bibtex": str(metadata.get("bibtex") or ""), "reading_status": "未读",
        "categories": [], "tags": [], "projects": [], "favorite": False,
        "filename": name, "stored_filename": dest.name, "size": dest.stat().st_size,
        "sha256": h.hexdigest(), "last_page": 1, "page_count": 0,
        "created_at": now, "updated_at": now,
    }
    data = _load_registry(); data["items"].append(item); _save_registry(data)
    note_path(paper_id).write_text(f"# {item['title']}\n\n", encoding="utf-8")
    return item

def pdf_path(paper_id: str) -> Path:
    item = get_item(paper_id)
    p = (_root() / "PDF" / str(item.get("stored_filename") or "")).resolve()
    if (_root() / "PDF").resolve() not in p.parents: raise ValueError("Invalid PDF path")
    return p

def annotation_path(paper_id: str) -> Path:
    return _root() / "Annotations" / f"{paper_id}.json"

def note_path(paper_id: str) -> Path:
    return _root() / "Notes" / f"{paper_id}.md"

def preview_dir(paper_id: str) -> Path:
    p = _root() / "Previews" / str(paper_id)
    p.mkdir(parents=True, exist_ok=True)
    return p

def _save_preview_data_url(paper_id: str, ann_id: str, data_url: str) -> str:
    data_url = str(data_url or "")
    m = re.match(r"^data:image/(webp|png|jpeg);base64,(.+)$", data_url, re.I | re.S)
    if not m:
        raise ValueError("Invalid annotation preview")
    ext = {"jpeg": "jpg"}.get(m.group(1).lower(), m.group(1).lower())
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except Exception as exc:
        raise ValueError("Invalid annotation preview encoding") from exc
    if not raw or len(raw) > 3 * 1024 * 1024:
        raise ValueError("Annotation preview is too large")
    target = preview_dir(paper_id) / f"{ann_id}.{ext}"
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_bytes(raw)
    tmp.replace(target)
    return str(target.relative_to(ensure_workspace())).replace("\\", "/")

def get_annotations(paper_id: str, page: int | None = None) -> list[dict[str, Any]]:
    get_item(paper_id)
    p = annotation_path(paper_id)
    if not p.exists(): return []
    try: rows = json.loads(p.read_text(encoding="utf-8"))
    except Exception: rows = []
    if page is not None: rows = [x for x in rows if int(x.get("page") or 0) == int(page)]
    return rows

def save_annotation(paper_id: str, annotation: dict[str, Any]) -> dict[str, Any]:
    get_item(paper_id)
    typ = str(annotation.get("type") or "highlight")
    if typ not in ANNOTATION_TYPES:
        raise ValueError("Unsupported annotation type")
    p = annotation_path(paper_id)
    rows = get_annotations(paper_id)
    ann_id = str(annotation.get("id") or uuid.uuid4().hex)
    existing = next((x for x in rows if x.get("id") == ann_id), {}) or {}
    selection_kind = str(annotation.get("selection_kind") or existing.get("selection_kind") or "text")
    if selection_kind not in {"text", "area"}:
        selection_kind = "text"
    preview_path = str(annotation.get("preview_path") or existing.get("preview_path") or "")
    preview_data_url = str(annotation.get("preview_data_url") or "")
    if preview_data_url:
        preview_path = _save_preview_data_url(paper_id, ann_id, preview_data_url)
    row = {
        "id": ann_id,
        "page": max(1, int(annotation.get("page") or existing.get("page") or 1)),
        "type": typ,
        "rects": annotation.get("rects") if "rects" in annotation else existing.get("rects", []),
        "points": annotation.get("points") if "points" in annotation else existing.get("points", []),
        "text": str(annotation.get("text") if "text" in annotation else existing.get("text", ""))[:20000],
        "comment": str(annotation.get("comment") if "comment" in annotation else existing.get("comment", ""))[:20000],
        "color": str(annotation.get("color") or existing.get("color") or "yellow"),
        "selection_kind": selection_kind,
        "preview_path": preview_path,
        "created_at": existing.get("created_at") or annotation.get("created_at") or datetime.now().isoformat(timespec="seconds"),
        "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    rows = [x for x in rows if x.get("id") != ann_id] + [row]
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)
    return row

def delete_annotation(paper_id: str, annotation_id: str) -> dict[str, Any]:
    rows = get_annotations(paper_id)
    victim = next((x for x in rows if x.get("id") == annotation_id), None)
    rows = [x for x in rows if x.get("id") != annotation_id]
    p = annotation_path(paper_id)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)
    if victim and victim.get("preview_path"):
        target = (ensure_workspace() / str(victim["preview_path"])).resolve()
        root = ensure_workspace().resolve()
        if root in target.parents and target.is_file():
            try:
                target.unlink()
            except OSError:
                pass
    return {"ok": True}

def get_note(paper_id: str) -> str:
    get_item(paper_id); p = note_path(paper_id)
    return p.read_text(encoding="utf-8") if p.exists() else ""

def save_note(paper_id: str, content: str) -> dict[str, Any]:
    get_item(paper_id); p = note_path(paper_id)
    tmp = p.with_suffix(".tmp"); tmp.write_text(str(content or ""), encoding="utf-8"); tmp.replace(p)
    return {"ok": True, "path": str(p.relative_to(ensure_workspace())).replace("\\","/")}
