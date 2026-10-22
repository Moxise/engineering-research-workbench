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


def validate_payload(payload: dict[str, Any], *, partial: bool = False) -> dict[str, Any]:
    """Validate before any writes. Omitted create fields keep their old defaults.

    Empty/null due explicitly clears the deadline; other editable task fields
    require their declared types. Existing invalid records must be corrected on
    update, never silently removed or coerced.
    """
    if not isinstance(payload, dict):
        raise ValueError("待办输入必须是 JSON 对象")
    result = dict(payload)
    if not partial:
        for key, default in (("title", "新任务"), ("due", date.today().isoformat()),
                             ("priority", "普通"), ("done", False)):
            result.setdefault(key, default)
    if "title" in result:
        title = result["title"]
        if not isinstance(title, str) or not title.strip():
            raise ValueError("title：标题必须是非空字符串")
        result["title"] = title.strip()
    if "due" in result:
        due = result["due"]
        if due is None or due == "":
            result["due"] = ""
        else:
            try:
                if not isinstance(due, str) or date.fromisoformat(due).isoformat() != due:
                    raise ValueError()
            except (TypeError, ValueError):
                raise ValueError("due：日期必须是有效的 YYYY-MM-DD，或留空") from None
    if "priority" in result:
        if not isinstance(result["priority"], str) or result["priority"] not in ("普通", "紧急", "高", "低"):
            raise ValueError("priority：优先级必须是普通、紧急、高或低")
    if "done" in result and not isinstance(result["done"], bool):
        raise ValueError("done：完成状态必须是布尔值")
    return result


def create(payload: dict[str, Any]) -> dict[str, Any]:
    payload = validate_payload(payload)
    now = datetime.now().isoformat(timespec="seconds")
    project = str(payload.get("project") or "").strip()
    item = {
        "id": "todo-" + uuid.uuid4().hex[:10],
        "title": payload["title"],
        "project": project,
        "project_id": str(payload.get("project_id") or ""),
        "due": payload["due"],
        "priority": payload["priority"],
        "done": payload["done"],
        "created": now,
        "updated": now,
    }
    ensure_project(project)
    with _LOCK:
        items = _load(); items.append(item); _save(items)
    activity.record("todo_create", ref=item["id"], kind="todo", title=item["title"], project=item["project"])
    return item


def update(todo_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    payload = validate_payload(payload, partial=True)
    with _LOCK:
        items = _load()
        for item in items:
            if item.get("id") == todo_id:
                validated = validate_payload({**item, **payload})
                was_done = bool(item.get("done"))
                for key in ("title", "project", "project_id", "due", "priority", "done"):
                    if key in payload:
                        item[key] = validated[key]
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


def delete_many(ids: list[str], *, completed_only: bool = False) -> dict[str, Any]:
    """Delete an explicit selection; completed-only cleanup rechecks under the lock."""
    with _LOCK:
        items = _load()
        by_id = {item.get("id"): item for item in items}
        deleted = [key for key in dict.fromkeys(ids)
                   if key in by_id and (not completed_only or by_id[key].get("done"))]
        failed = [{"id": key, "message": "待办不存在" if key not in by_id else "待办尚未完成，已保留"}
                  for key in dict.fromkeys(ids) if key not in deleted]
        if deleted:
            removed = set(deleted)
            _save([item for item in items if item.get("id") not in removed])
    return {"deleted": deleted, "failed": failed}
