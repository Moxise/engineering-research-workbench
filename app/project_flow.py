from __future__ import annotations

import hashlib
import json
import os
import re
from contextlib import contextmanager

from core.contracts.kinds import RELATION_MATRIX

from . import indexer, projects
from .sync_engine import mutation_lock

MAX_NODES = 120
MAX_EDGES = 300
MAX_COORDINATE = 6000
GRID_SIZE = 16
LAYOUT = {
    "anchor": "top_left",
    "grid_size": GRID_SIZE,
    "node_width": 198,
    "node_height": 76,
    "max_coordinate": MAX_COORDINATE,
    "max_nodes": MAX_NODES,
    "max_edges": MAX_EDGES,
}
_ID = re.compile(r"[a-zA-Z0-9_-]{1,80}")
DOCUMENT_KINDS = {"experiment", "method", "principle", "idea", "entry"}
_RELATION_LABELS = {row["id"]: row["label"] for row in RELATION_MATRIX}


class FlowConflict(ValueError):
    pass


def _snap_coordinate(value):
    return (value + GRID_SIZE // 2) // GRID_SIZE * GRID_SIZE


def _path(project_id):
    record = projects._record_for_id(projects._load_registry(), project_id)
    if not record:
        raise FileNotFoundError("找不到该项目")
    root = (projects.ensure_workspace() / "Projects").resolve()
    directory = (root / record["name"]).resolve()
    path = directory / "project-flow.json"
    if directory.parent != root or path.is_symlink() or path.with_suffix(".json.tmp").is_symlink():
        raise ValueError("流程图路径无效")
    return path


def _read(path):
    if not path.exists():
        return {"nodes": [{"id": "root", "kind": "project", "ref": "", "title": "",
                           "x": _snap_coordinate(40), "y": _snap_coordinate(100)}],
                "edges": [], "revision": "new"}
    data = path.read_bytes()
    return {**json.loads(data), "revision": hashlib.sha256(data).hexdigest()}


@contextmanager
def _save_lock(project_id):
    path = _path(project_id)
    cache = path.parents[2] / "System" / "Cache"
    cache.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(str(path).encode("utf-8")).hexdigest()
    with (cache / f"project-flow-{key}.lock").open("a+b") as lock:
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield path
            finally:
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            yield path


def _text(item, key, limit, *, required=False):
    value = item.get(key, "")
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError(f"流程图字段 {key} 无效")
    return value.strip()


def _validate(payload, project_id):
    if not isinstance(payload, dict):
        raise ValueError("流程图格式无效")
    raw_nodes, raw_edges = payload.get("nodes"), payload.get("edges")
    relation_scope = payload.get("relation_scope")
    if relation_scope is not None and relation_scope not in ("hierarchy", "internal", "all"):
        raise ValueError("自动关系范围无效")
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        raise ValueError("流程图需要节点和连线列表")
    if len(raw_nodes) > MAX_NODES or len(raw_edges) > MAX_EDGES:
        raise ValueError(f"每张流程图最多支持 {MAX_NODES} 个节点与 {MAX_EDGES} 条连线")
    nodes, edges, node_ids, edge_ids, links = [], [], set(), set(), set()
    for item in raw_nodes:
        if not isinstance(item, dict):
            raise ValueError("节点格式无效")
        node_id, kind = item.get("id"), item.get("kind")
        if not isinstance(node_id, str) or not _ID.fullmatch(node_id) or node_id in node_ids:
            raise ValueError("节点 ID 无效或重复")
        if kind not in DOCUMENT_KINDS | {"project", "step"} or (node_id == "root" and kind != "project"):
            raise ValueError("节点类型无效")
        ref = _text(item, "ref", 200, required=node_id != "root" and kind in ("project", "entry"))
        if ((node_id == "root" or kind == "step") and ref) or (kind == "project" and ref == project_id):
            raise ValueError("节点引用无效")
        title = _text(item, "title", 180, required=node_id != "root")
        x, y = item.get("x"), item.get("y")
        if any(type(value) is not int or not 0 <= value <= MAX_COORDINATE for value in (x, y)):
            raise ValueError("节点坐标超出画布范围")
        node_ids.add(node_id)
        nodes.append({"id": node_id, "kind": kind, "ref": ref, "title": title,
                      "description": _text(item, "description", 2000), "x": x, "y": y})
    if "root" not in node_ids:
        raise ValueError("流程图需要保留主项目节点")
    for item in raw_edges:
        if not isinstance(item, dict):
            raise ValueError("连线格式无效")
        edge_id, source, target = (_text(item, key, 80, required=True) for key in ("id", "source", "target"))
        if (not _ID.fullmatch(edge_id) or edge_id in edge_ids or source not in node_ids or target not in node_ids
                or source == target or (source, target) in links):
            raise ValueError("连线无效，每组同方向节点只保留一条连线")
        style = item.get("style", "solid")
        if style not in ("solid", "dashed"):
            raise ValueError("无效的连线样式")
        edges.append({"id": edge_id, "source": source, "target": target,
                      "label": _text(item, "label", 32), "style": style})
        edge_ids.add(edge_id)
        links.add((source, target))
    flow = {"nodes": nodes, "edges": edges}
    if relation_scope is not None:
        flow["relation_scope"] = relation_scope
    return flow


def get(project_id):
    with projects._LOCK:
        flow = _read(_path(project_id))
    refs = [node["ref"] for node in flow["nodes"] if node.get("ref") and node["kind"] in DOCUMENT_KINDS]
    docs = indexer.get_docs_by_ids(refs) if refs else {}
    flow["documents"] = {key: {"title": doc["title"], "kind": doc["kind"]} for key, doc in docs.items()}
    flow["layout"] = LAYOUT.copy()
    return flow


def relations(project_id, document_ids):
    with projects._LOCK:
        registry = [row for row in projects._load_registry() if row.get("id") and row.get("name")]
    records = {row["id"]: row for row in registry}
    if project_id not in records:
        raise FileNotFoundError("找不到该项目")
    if len(document_ids) > MAX_NODES or any(len(doc_id) > 200 for doc_id in document_ids):
        raise ValueError("条目列表超出限制")
    children = {}
    for row in registry:
        children.setdefault(row.get("parent_id"), []).append(row["id"])
    scope = {project_id}
    queue = [project_id]
    edges = []
    for parent in queue:
        for child in children.get(parent, ()):
            if child in scope:
                continue
            scope.add(child)
            queue.append(child)
            edges.append({"source": parent, "target": child, "type": "hierarchy", "label": "包含子项目"})

    shared, references, docs = indexer.project_flow_evidence(scope, document_ids, registry)
    groups = {}
    for rows, edge_type in ((shared, "shared"), (references, "reference")):
        for row in rows:
            source, target = row["source"], row["target"]
            if source != project_id and target == project_id and edge_type == "shared":
                source, target = target, source
            key = (source, target, edge_type)
            evidence = groups.setdefault(key, {})
            item = {"id": row["doc_id"], "title": row["title"], "kind": row["kind"]}
            if edge_type == "reference":
                item.update(target_id=row["target_doc_id"], target_title=row["target_title"], target_kind=row["target_kind"],
                            label=_RELATION_LABELS.get(row["relation"], "显式引用"))
            evidence.setdefault((item["id"], item.get("target_id")), item)
    visible = [child for child in queue if child != project_id]
    related = {key for source, target, _ in groups for key in (source, target) if key not in scope}
    visible.extend(sorted(related, key=lambda key: (records[key]["name"], key)))
    for (source, target, edge_type), evidence in groups.items():
        label = "共享条目" if edge_type == "shared" else "跨项目引用"
        edges.append({"source": source, "target": target, "type": edge_type,
                      "label": f"{label} {len(evidence)}", "count": len(evidence), "evidence": list(evidence.values())[:8]})

    links = {}
    for row in docs:
        if row["source"] == row["target"] or row["relation"] not in _RELATION_LABELS:
            continue
        labels = links.setdefault((row["source"], row["target"]), [])
        if row["relation"] != "wikilink" or not labels:
            labels.append(_RELATION_LABELS[row["relation"]])
    return {
        "projects": [{"id": key, "name": records[key]["name"], "parent_id": records[key].get("parent_id", ""),
                      "child": key in scope} for key in visible],
        "edges": edges,
        "document_edges": [{"source": source, "target": target, "type": "document", "label": labels[0], "labels": labels}
                           for (source, target), labels in links.items()],
    }


def save(project_id, payload):
    flow = _validate(payload, project_id)
    with mutation_lock, projects._LOCK, _save_lock(project_id) as path:
        current = _read(path)
        if current["revision"] != payload.get("revision"):
            raise FlowConflict("流程图已在其他窗口更新。当前草稿保留，请重新载入后再编辑。")
        if "relation_scope" not in flow and "relation_scope" in current:
            flow["relation_scope"] = current["relation_scope"]
        positions = {node["id"]: (node["x"], node["y"]) for node in current["nodes"]}
        changed = set()
        for node in flow["nodes"]:
            previous = positions.get(node["id"])
            if previous == (node["x"], node["y"]):
                continue
            node["x"] = _snap_coordinate(node["x"])
            node["y"] = _snap_coordinate(node["y"])
            if previous != (node["x"], node["y"]):
                changed.add(node["id"])
        for index, node in enumerate(flow["nodes"]):
            for other in flow["nodes"][index + 1:]:
                if node["id"] not in changed and other["id"] not in changed:
                    continue
                if (abs(node["x"] - other["x"]) < LAYOUT["node_width"]
                        and abs(node["y"] - other["y"]) < LAYOUT["node_height"]):
                    first = node["title"] or "主项目"
                    second = other["title"] or "主项目"
                    raise ValueError(f"对齐网格后卡片重叠：{first}、{second}")
        projects._atomic_json(path, flow)
        return {**_read(path), "layout": LAYOUT.copy()}
