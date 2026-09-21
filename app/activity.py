from __future__ import annotations

import json
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .config import workspace_root

_LOCK = threading.RLock()


def _path() -> Path:
    p = workspace_root() / "System" / "activity.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def record(event_type: str, *, ref: str = "", kind: str = "", title: str = "", project: str = "", weight: int = 1, timestamp: str | None = None) -> None:
    """Append one lightweight research-activity event.

    This file is intentionally append-only. A failed activity write must never block
    the primary operation (saving a note, finishing a task, etc.).
    """
    event = {
        "timestamp": timestamp or datetime.now().isoformat(timespec="seconds"),
        "type": str(event_type or "activity"),
        "ref": str(ref or ""),
        "kind": str(kind or ""),
        "title": str(title or ""),
        "project": str(project or ""),
        "weight": max(1, int(weight or 1)),
    }
    try:
        line = json.dumps(event, ensure_ascii=False) + "\n"
        with _LOCK:
            with _path().open("a", encoding="utf-8") as f:
                f.write(line)
    except Exception:
        # Activity analytics are secondary; never make the research workflow fail.
        return


def list_events(since: date | None = None) -> list[dict[str, Any]]:
    p = _path()
    if not p.exists():
        return []
    out: list[dict[str, Any]] = []
    with _LOCK:
        try:
            lines = p.read_text(encoding="utf-8").splitlines()
        except Exception:
            return []
    for raw in lines:
        try:
            item = json.loads(raw)
            if not isinstance(item, dict):
                continue
            ts = str(item.get("timestamp") or "")
            if since:
                try:
                    if datetime.fromisoformat(ts).date() < since:
                        continue
                except Exception:
                    continue
            out.append(item)
        except Exception:
            continue
    return out
