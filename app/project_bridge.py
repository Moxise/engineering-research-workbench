from __future__ import annotations

from typing import Any

from . import projects, store


def _maps() -> tuple[dict[str, str], dict[str, str]]:
    by_stable: dict[str, str] = {}
    by_legacy: dict[str, str] = {}
    for rec in projects.list_projects():
        stable = "project:" + str(rec.get("id") or "")
        legacy = "project:" + str(rec.get("name") or "")
        if stable != "project:" and legacy != "project:":
            by_stable[stable] = legacy
            by_legacy[legacy] = stable
    return by_stable, by_legacy


def to_legacy(node_id: str) -> str:
    stable, _ = _maps()
    return stable.get(str(node_id or ""), str(node_id or ""))


def to_stable(node_id: str) -> str:
    _, legacy = _maps()
    return legacy.get(str(node_id or ""), str(node_id or ""))


def neighborhood(root_id: str, depth: int = 1) -> dict[str, Any]:
    original = str(root_id or "")
    data = store.graph_neighborhood(to_legacy(original), depth)
    items = []
    for item in data.get("items") or []:
        row = dict(item)
        row["id"] = to_stable(str(row.get("id") or ""))
        items.append(row)
    return {**data, "root": original, "items": items}


def build_bundle(root_id: str, selected_ids: list[str], title: str = "", active_node_ids: list[str] | None = None, relations: list[dict[str, Any]] | None = None) -> str:
    selected = [to_legacy(x) for x in (selected_ids or [])]
    active = [to_legacy(x) for x in (active_node_ids or [])]
    rels = None
    if relations is not None:
        rels = []
        for edge in relations:
            row = dict(edge)
            row["source"] = to_legacy(str(row.get("source") or ""))
            row["target"] = to_legacy(str(row.get("target") or ""))
            rels.append(row)
    return store.build_bundle(to_legacy(root_id), selected, title, active, rels)
