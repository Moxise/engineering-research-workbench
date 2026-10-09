# -*- coding: utf-8 -*-
"""检索层：FTS（复用工作台 documents_fts）+ 向量（rag.sqlite）+ 图扩展 + RRF 融合。

三路各自的角色：
- FTS：精确词面命中，覆盖「查出处 / 查冲突」里的编号、术语、数字；
- 向量：字面无交集但语义相关，覆盖「查迁移」；
- 图：命中条目沿 document_links（wikilink）1 跳扩展，体现用户自己的知识结构，作为扩展而非主排序。

融合用 RRF（只用排名，免去三路分数量纲不统一的调参问题）。

说明：FTS 的**分词规则**由 app/kb_segment.py 唯一提供（与服务端写入侧同源）；
本模块只重复了那条读取 SQL（服务跑在另一个解释器里，不便复用 app 层查询函数）。
"""
from __future__ import annotations

import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterable, Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import kb_segment  # noqa: E402

from rag import config, store  # noqa: E402

RRF_K = 60
#: 三路权重。实测（rag/eval + .scratch/tmp/_rrf_sweep.py，52 条正样本）：
#:   vector-only MRR 0.901 / fts0.5+vector MRR 0.897 / 任何含 graph 的组合 MRR ≤ 0.790。
#: 故 graph 权重置 0 —— 图不作主排序腿，改为在结果里单独输出 `related`（关联条目），
#: 既保留「沿 wikilink 扩展、体现知识结构」的价值，又不污染主排序。
LEG_WEIGHTS = {"fts": 0.5, "vector": 1.0, "graph": 0.0}

#: 拒答阈值与置信档（由 rag/eval/calibrate_threshold.py + _op_point.py + _boundary.py 实测标定）。
#: 实测教训：跨语言/改写型查询的**正确答案常常只有 0.55~0.61**（如「传感器切换时的配准」命中
#: 《Cross-Spectral Navigation with Sensor Handover》= 0.593），若把它当拒答门槛，会把正确结果
#: 直接藏掉。故改为两级：`vector_min_score` 只作「几乎没有证据」的硬拒答；证据强弱交给 confidence
#: 标注，弱证据照常返回并提示核对原文——检索工具不该替调用方决定「找不到」。
DEFAULT_VECTOR_FLOOR = 0.45
DEFAULT_MEDIUM_SCORE = 0.50
DEFAULT_CONFIRM_SCORE = 0.62
_THRESHOLD_FILE = Path(__file__).resolve().parent / "eval/threshold.json"


def _threshold(key: str, fallback: float) -> float:
    try:
        data = json.loads(_THRESHOLD_FILE.read_text(encoding="utf-8"))
        value = float(data.get(key))
        return value if value > 0 else fallback
    except Exception:  # noqa: BLE001
        return fallback


def vector_floor() -> float:
    """硬拒答下限：FTS 无命中且最高向量相似度低于此值 → 判定「未找到」。"""
    return _threshold("vector_min_score", DEFAULT_VECTOR_FLOOR)


def medium_score() -> float:
    """confidence=medium 的向量分门槛。"""
    return _threshold("medium_score", DEFAULT_MEDIUM_SCORE)


def confirm_score() -> float:
    """confidence=high 的向量分门槛（需与关键词证据同时成立）。"""
    return _threshold("confirm_score", DEFAULT_CONFIRM_SCORE)


def vector_only_medium() -> float:
    """无关键词证据时，向量分需高于此值才给 medium（默认高于实测离题上限 0.6096）。"""
    return _threshold("vector_only_medium_score", 0.65)


# --------------------------------------------------------------------- FTS
def fts_rank(conn: sqlite3.Connection, query: str, limit: int = 30) -> list[str]:
    """与工作台 search_docs 同语义的三段式：词间 AND → 词间 OR → LIKE 兜底。"""
    q = str(query or "").strip()
    if not q:
        return []
    like = kb_segment.like_pattern(q)
    exprs = [kb_segment.match_expression(q, mode="and"), kb_segment.match_expression(q, mode="or")]
    for expression in dict.fromkeys(e for e in exprs if e):
        try:
            rows = conn.execute(
                """
                SELECT f.doc_id AS doc_id FROM documents_fts f
                JOIN documents d ON d.id = f.doc_id
                WHERE documents_fts MATCH ?
                ORDER BY d.pinned DESC, bm25(documents_fts) LIMIT ?
                """,
                (expression, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            rows = []
        if rows:
            return [str(r["doc_id"]) for r in rows]
    try:
        rows = conn.execute(
            """
            SELECT f.doc_id AS doc_id FROM documents_fts f
            WHERE lower(f.title) LIKE ? OR lower(f.body) LIKE ?
               OR lower(f.tags) LIKE ? OR lower(f.projects) LIKE ?
            LIMIT ?
            """,
            (like, like, like, like, limit),
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    return [str(r["doc_id"]) for r in rows]


# ------------------------------------------------------------------ 向量
def _numpy() -> Any:
    import numpy as np  # noqa: PLC0415

    return np


def load_matrix(conn: sqlite3.Connection,
                source_types: Sequence[str] = ("md", "pdf")) -> tuple[list[sqlite3.Row], Any]:
    """把全部块向量读成 (rows, 矩阵)，检索时一次矩阵乘法。

    source_types 默认包含 `pdf`（文献全文片段），使 PDF 与知识条目同处一个向量空间。
    """
    np = _numpy()
    marks = ",".join("?" * len(source_types))
    rows = list(
        conn.execute(
            f"SELECT chunk_id,doc_id,source_type,title,kind,status,path,page,text,char_len,vec,dim "
            f"FROM chunks WHERE vec IS NOT NULL AND source_type IN ({marks}) ORDER BY doc_id, seq",
            tuple(source_types),
        )
    )
    if not rows:
        return [], np.zeros((0, config.MODEL_DIM), dtype="float32")
    dim = int(rows[0]["dim"] or config.MODEL_DIM)
    mat = np.zeros((len(rows), dim), dtype="float32")
    for i, row in enumerate(rows):
        vec = store.unpack(row["vec"])
        mat[i, : len(vec)] = vec
    return rows, mat


def chunk_quality(text: str) -> float:
    """片段质量先验（0.75~1.15）：压制「字面密度高但不是答案」的残片。

    为什么需要：查询词在**引用残片/清单/断句**里往往也密集出现（如英文文献里的一句被引标题、
    章节页的能力清单），bge-small-zh 的字面相似度会把它们排到真正的正文前面 —— 用户实测反馈
    「点进去是目录/参考文献」，其中一部分就是这类残片。判据全部是可解释的表面特征，不做学习。
    """
    t = " ".join((text or "").split())
    if len(t) < 20:
        return 0.85
    cjk = sum(1 for ch in t if "\u4e00" <= ch <= "\u9fff")
    digits = sum(1 for ch in t if ch.isdigit())
    enders = len(re.findall(r"[。！？；!?;]", t)) + len(re.findall(r"\.\s", t))
    quotes = t.count("'") + t.count('"') + t.count("“") + t.count("”")
    score = 1.0
    if enders >= 2:
        score += 0.12                                # 成句正文
    elif enders == 0:
        score -= 0.12                                # 无句末标点 → 断片
    if len(t) >= 120 and enders >= 2:
        score += 0.05                                # 有长度的完整段落
    if digits and digits / len(t) > 0.12:
        score -= 0.10                                # 数字密集 → 表格/页码/书目
    if quotes >= 4:
        score -= 0.08                                # 引号密集 → 被引标题清单
    if cjk >= 40:
        score += 0.05
    return max(0.75, min(1.15, score))


def vector_rank(rows: Sequence[sqlite3.Row], mat: Any, embedder: Any, query: str,
                limit_docs: int = 30, per_doc: int = 1) -> list[tuple[str, float, sqlite3.Row]]:
    """向量检索并按 doc 聚合（同一条目取最高分块）。返回 [(doc_id, 原始余弦, chunk_row)]。

    排序用「余弦 × 片段质量先验」；返回的是**原始余弦**（界面显示用，可比较、可复核）。
    """
    if not rows:
        return []
    np = _numpy()
    qv = np.asarray(embedder.encode_query(query), dtype="float32")
    scores = mat @ qv
    order = np.argsort(-scores)
    best: dict[str, tuple[float, float, sqlite3.Row]] = {}
    for idx in order[: max(limit_docs * 6, 60)]:
        row = rows[int(idx)]
        doc_id = str(row["doc_id"])
        score = float(scores[int(idx)])
        adjusted = score * chunk_quality(str(row["text"]))
        if doc_id not in best or adjusted > best[doc_id][0]:
            best[doc_id] = (adjusted, score, row)
        if len(best) >= limit_docs:
            break
    ranked = sorted(best.values(), key=lambda item: -item[0])
    return [(str(row["doc_id"]), score, row) for _adj, score, row in ranked]


# ------------------------------------------------------------------- 图
def graph_expand(conn: sqlite3.Connection, doc_ids: Iterable[str], limit_per: int = 5) -> dict[str, float]:
    """沿 document_links 的 wikilink 1 跳扩展：命中条目的关联条目。"""
    seeds = [d for d in dict.fromkeys(doc_ids)]
    if not seeds:
        return {}
    marks = ",".join("?" * len(seeds))
    neighbours: dict[str, float] = {}
    for i, seed in enumerate(seeds):
        rows = conn.execute(
            f"SELECT token FROM document_links WHERE doc_id IN ({marks}) AND role='wikilink' LIMIT ?",
            (*seeds, limit_per * len(seeds)),
        ).fetchall()
        for row in rows:
            token = str(row["token"])
            hit = conn.execute(
                "SELECT id FROM documents WHERE id=? OR title=? OR title LIKE ? LIMIT 1",
                (token, token, f"%{token}%"),
            ).fetchone()
            if hit and str(hit["id"]) not in seeds:
                neighbours.setdefault(str(hit["id"]), 1.0 / (1 + i))
        break  # 只按整批种子查一次
    return neighbours


# ------------------------------------------------------------------ RRF
def rrf(rank_lists: dict[str, Sequence[str]], k: int = RRF_K,
        weights: dict[str, float] | None = None) -> list[tuple[str, float]]:
    """Reciprocal Rank Fusion：score(d) = Σ_r w_r / (k + rank_r(d))。"""
    weights = weights or LEG_WEIGHTS
    scores: dict[str, float] = {}
    for leg, ranked in rank_lists.items():
        weight = float(weights.get(leg, 1.0))
        for rank, doc_id in enumerate(ranked, 1):
            scores[doc_id] = scores.get(doc_id, 0.0) + weight / (k + rank)
    return sorted(scores.items(), key=lambda kv: -kv[1])


# ---------------------------------------------------------------- 组装
def _doc_meta(conn: sqlite3.Connection, doc_ids: Sequence[str]) -> dict[str, sqlite3.Row]:
    if not doc_ids:
        return {}
    marks = ",".join("?" * len(doc_ids))
    rows = conn.execute(
        f"SELECT id,title,kind,status,path,excerpt FROM documents WHERE id IN ({marks})", tuple(doc_ids)
    ).fetchall()
    return {str(r["id"]): r for r in rows}


def hybrid(
    conn_index: sqlite3.Connection,
    conn_rag: sqlite3.Connection | None,
    embedder: Any | None,
    query: str,
    *,
    topk: int = 8,
    use_vector: bool = True,
    use_graph: bool = True,
    vector_rows: Sequence[sqlite3.Row] | None = None,
    vector_mat: Any | None = None,
    min_score: float | None = None,
) -> dict[str, Any]:
    """完整检索：三路 → RRF → 带元信息的结果。embedder 为 None 时自动降级为 FTS + 图。"""
    caveats: list[str] = []
    legs: dict[str, list[str]] = {}
    vec_detail: dict[str, tuple[float, sqlite3.Row]] = {}

    fts = fts_rank(conn_index, query, limit=30)
    legs["fts"] = fts

    if use_vector and embedder is not None and conn_rag is not None:
        if vector_rows is None or vector_mat is None:
            vector_rows, vector_mat = load_matrix(conn_rag)
        try:
            ranked_vec = vector_rank(vector_rows, vector_mat, embedder, query)
            for doc_id, score, row in ranked_vec:
                vec_detail[doc_id] = (score, row)
            legs["vector"] = [d for d, _s, _r in ranked_vec]
        except Exception as exc:  # noqa: BLE001
            caveats.append(f"向量检索不可用，已降级为 FTS+图（{type(exc).__name__}: {exc}）")
    elif use_vector:
        caveats.append("未启用向量检索（服务端模型不可用），已降级为 FTS+图。")

    related: list[dict[str, Any]] = []
    if use_graph and fts:
        graph = graph_expand(conn_index, fts[:8])
        related = [
            {"doc_id": doc_id, "score": round(score, 3)}
            for doc_id, score in sorted(graph.items(), key=lambda kv: -kv[1])[:5]
        ]
    related_ids = {r["doc_id"] for r in related}

    best_vec = max((s for s, _r in vec_detail.values()), default=0.0)
    floor = vector_floor() if min_score is None else float(min_score)

    # v261009 · 拒答：两条主路都没有证据（FTS 空 + 最高向量相似度低于标定阈值）→ 明确「未找到」，
    # 不用低分结果填充（科研场景宁可说不知道，也不给不可核验的结论）。
    if not legs.get("fts") and best_vec < floor:
        return {
            "query": query,
            "sources": [],
            "confidence": "none",
            "caveats": caveats + [
                f"未找到相关内容（FTS 无命中，最高向量相似度 {best_vec:.3f} < 阈值 {floor:.3f}）。"
            ],
            "legs": {k: len(v) for k, v in legs.items()},
            "best_vector_score": round(best_vec, 4),
            "vector_floor": floor,
            "related": related,
        }

    fused = rrf(legs)
    if not fused:
        return {"query": query, "sources": [], "confidence": "none", "caveats": caveats + ["未找到相关内容。"], "legs": {k: len(v) for k, v in legs.items()}}

    top = fused[:topk]
    meta = _doc_meta(conn_index, [d for d, _ in top])
    sources: list[dict[str, Any]] = []
    for doc_id, score in top:
        info = meta.get(doc_id)
        chunk_row = vec_detail.get(doc_id, (0.0, None))[1]
        text = ""
        if chunk_row is not None:
            text = str(chunk_row["text"])
        sources.append({
            "doc_id": doc_id,
            "title": str(info["title"]) if info else "",
            "kind": str(info["kind"]) if info else "",
            "status": str(info["status"]) if info else "",
            "snippet": _snippet(text or (str(info["excerpt"]) if info else ""), query),
            "page": (chunk_row["page"] if chunk_row is not None else None),
            "source_type": (str(chunk_row["source_type"]) if chunk_row is not None else "md"),
            "pdf": (str(chunk_row["path"]) if chunk_row is not None
                    and str(chunk_row["source_type"]) == "pdf" else None),
            "score": round(score, 5),
            # score 是 RRF 融合分（1/(k+rank)，量级 0.01 级，**不是相似度**）；
            # similarity 才是该片段与查询的余弦相似度，界面应显示后者。
            "similarity": (round(vec_detail[doc_id][0], 4) if doc_id in vec_detail else None),
            "in_fts": doc_id in legs.get("fts", []),
            "in_vector": doc_id in vec_detail,
            "in_graph": doc_id in related_ids,
            "related": doc_id in related_ids,
        })

    best_vec2 = best_vec
    # 置信度来自**证据结构**而不是分数：实测（.scratch/tmp/_signal_experiment.py）绝对分、z、margin
    # 都无法分开「跨语言正确命中 0.55~0.61」与「离题命中 0.48~0.61」——这是 bge-small-zh 在本语料上
    # 的判别力上限。故：
    #   high   = 关键词与向量双证据（fts≥3 且向量≥fts_confirm），或向量分 ≥0.75（远超观测离题上限）
    #   medium = 有关键词证据，或向量分 ≥0.65（0.65 > 实测离题上限 0.6096）
    #   low    = 仅弱语义召回 → 照常返回，但提示核对原文
    fts_hits = len(legs.get("fts", []))
    if (fts_hits >= 3 and best_vec2 >= confirm_score()) or best_vec2 >= 0.75:
        confidence = "high"
    elif fts_hits >= 1 or best_vec2 >= vector_only_medium():
        confidence = "medium"
    else:
        confidence = "low"
        caveats = caveats + [
            f"仅弱语义召回（关键词无命中，最高相似度 {best_vec2:.3f}）：属候选线索，请打开原文核对后再引用。"
        ]
    return {
        "query": query,
        "sources": sources,
        "confidence": confidence,
        "caveats": caveats,
        "legs": {k: len(v) for k, v in legs.items()},
        "best_vector_score": round(best_vec2, 4),
        "vector_floor": floor,
        "related": related,
    }


def _snippet(text: str, query: str, limit: int = 240) -> str:
    from rag.chunk import snippet  # noqa: PLC0415

    return snippet(text, limit=limit, query=query)
