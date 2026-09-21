from __future__ import annotations

from typing import Any

from . import store, todos, agent


def search_all(query: str, limit: int = 60) -> list[dict[str, Any]]:
    q = str(query or "").strip().lower()
    if not q:
        return []
    limit = max(1, min(int(limit or 60), 120))
    results: list[dict[str, Any]] = []
    for d in store.list_docs(query=q):
        results.append({
            "source": "doc", "id": d.get("id"), "kind": d.get("kind"), "title": d.get("title"),
            "excerpt": d.get("excerpt", ""), "project": ", ".join(d.get("projects") or ([d.get("project")] if d.get("project") else [])), "projects": d.get("projects") or ([d.get("project")] if d.get("project") else []), "updated": d.get("updated", ""),
        })
        if len(results) >= limit:
            return results
    for t in todos.list_todos():
        hay = " ".join(str(t.get(k) or "") for k in ("title", "project", "priority", "due")).lower()
        if q in hay:
            results.append({"source": "todo", "id": t.get("id"), "kind": "todo", "title": t.get("title"), "excerpt": f"{t.get('project') or '未归属项目'} · 截止 {t.get('due') or '—'}", "project": t.get("project", ""), "updated": t.get("updated", "")})
            if len(results) >= limit:
                return results
    for s in agent.list_sessions():
        try:
            full = agent.get_session(str(s.get("id") or ""))
            transcript = " ".join(str(m.get("content") or "") for m in (full.get("messages") or []) if isinstance(m, dict))
        except Exception:
            transcript = ""
        hay = f"{s.get('title','')} {s.get('preview','')} {transcript}".lower()
        if q in hay:
            excerpt = s.get("preview", "")
            if q not in str(excerpt).lower() and transcript:
                pos = transcript.lower().find(q)
                excerpt = transcript[max(0, pos-60):pos+140] if pos >= 0 else transcript[:180]
            results.append({"source": "chat", "id": s.get("id"), "kind": "agent", "title": s.get("title"), "excerpt": excerpt, "project": "", "updated": s.get("updated", "")})
            if len(results) >= limit:
                return results
    results.sort(key=lambda x: str(x.get("updated") or ""), reverse=True)
    return results[:limit]
