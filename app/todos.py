from __future__ import annotations

import json
import threading
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .workspace import ensure_workspace, ensure_project
from . import activity

_LOCK = threading.RLock()


def _path() -> Path:
    return ensure_workspace() / "System" / "todos.json"


def _load() -> list[dict[str, Any]]:
    p = _path()
    if not p.exists():
        p.write_text("[]", encoding="utf-8")
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(items: list[dict[str, Any]]) -> None:
    p = _path()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(p)


def list_todos() -> list[dict[str, Any]]:
    with _LOCK:
        items = _load()
    return sorted(items, key=lambda x: (bool(x.get("done")), x.get("due") or "9999-99-99", x.get("created") or ""))


def create(payload: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now().isoformat(timespec="seconds")
    project = str(payload.get("project") or "").strip()
    item = {
        "id": "todo-" + uuid.uuid4().hex[:10],
        "title": str(payload.get("title") or "新任务").strip(),
        "project": project,
        "due": str(payload.get("due") or date.today().isoformat()),
        "priority": str(payload.get("priority") or "普通"),
        "done": bool(payload.get("done", False)),
        "created": now,
        "updated": now,
    }
    ensure_project(project)
    with _LOCK:
        items = _load(); items.append(item); _save(items)
    activity.record("todo_create", ref=item["id"], kind="todo", title=item["title"], project=item["project"])
    return item


def update(todo_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    with _LOCK:
        items = _load()
        for item in items:
            if item.get("id") == todo_id:
                was_done = bool(item.get("done"))
                for key in ("title", "project", "due", "priority", "done"):
                    if key in payload:
                        item[key] = payload[key]
                ensure_project(str(item.get("project") or ""))
                item["updated"] = datetime.now().isoformat(timespec="seconds")
                _save(items)
                event_type = "todo_done" if (not was_done and bool(item.get("done"))) else "todo_update"
                activity.record(event_type, ref=item["id"], kind="todo", title=str(item.get("title") or ""), project=str(item.get("project") or ""))
                return item
    raise FileNotFoundError(todo_id)


def delete(todo_id: str) -> dict[str, Any]:
    with _LOCK:
        items = _load()
        new_items = [x for x in items if x.get("id") != todo_id]
        if len(new_items) == len(items):
            raise FileNotFoundError(todo_id)
        _save(new_items)
    return {"ok": True}
