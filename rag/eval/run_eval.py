# -*- coding: utf-8 -*-
"""kb RAG 评测：同一评测集上对比四档检索。

    fts_legacy  修复前行为（trigram 短语 + <3 字符 LIKE 兜底），对**快照库**跑，作为基线
    fts         修复后（bigram 预分词 → MATCH）走工作台 search_docs（实时库）
    vector      仅向量（bge-small-zh）
    rrf         三路融合（FTS + 向量 + 图）

用法：
    python rag/eval/run_eval.py --mode fts_legacy --db .scratch/tmp/index-snapshot-20261009.sqlite
    python rag/eval/run_eval.py --mode fts
    python rag/eval/run_eval.py --mode vector          # 需 cuda env
    python rag/eval/run_eval.py --mode rrf --report rag/eval/report-20261009.md

指标：Recall@5、MRR@10（正样本）；误召回率（负样本，越低越好）。
判据是「期望 doc_id 出现在 Top-k」，不是「命中数 > 0」。
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from rag import config, store  # noqa: E402

QUERIES = Path(__file__).resolve().parent / "queries.jsonl"
DEFAULT_SNAPSHOT = ROOT / ".scratch/tmp/index-snapshot-20261009.sqlite"


def load_queries(limit: int = 0) -> list[dict[str, Any]]:
    items = [json.loads(line) for line in QUERIES.read_text(encoding="utf-8").splitlines() if line.strip()]
    return items[:limit] if limit else items


# --------------------------------------------------------------- 各档检索
def rank_fts_legacy(db_path: Path, query: str, limit: int = 10) -> list[str]:
    """复刻 v261009 之前的 search_docs 行为（用于基线对照）。"""
    conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        q = query.strip()
        like = f"%{q.casefold()}%"
        rows: list[sqlite3.Row] = []
        if len(q) >= 3:
            phrase = '"' + q.replace('"', '""') + '"'
            try:
                rows = conn.execute(
                    "SELECT d.id FROM documents_fts f JOIN documents d ON d.id=f.doc_id "
                    "WHERE documents_fts MATCH ? ORDER BY d.pinned DESC, bm25(documents_fts), "
                    "COALESCE(NULLIF(d.updated,''),d.created) DESC LIMIT ?",
                    (phrase, limit),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = []
        if not rows:
            rows = conn.execute(
                "SELECT d.id FROM documents d JOIN documents_fts f ON f.doc_id=d.id "
                "WHERE lower(f.title) LIKE ? OR lower(f.body) LIKE ? OR lower(f.tags) LIKE ? "
                "OR lower(f.projects) LIKE ? LIMIT ?",
                (like, like, like, like, limit),
            ).fetchall()
        return [str(r["id"]) for r in rows]
    finally:
        conn.close()


def rank_fts(query: str, limit: int = 10) -> list[str]:
    from app.perf_index_query import search_docs  # noqa: PLC0415

    return [str(d["id"]) for d in search_docs(query, limit=limit)]


def build_vector_ranker(limit: int = 10) -> Callable[[str], list[str]]:
    from rag import search as rag_search  # noqa: PLC0415
    from rag.embedder import Embedder  # noqa: PLC0415

    config.apply_hf_env()
    emb = Embedder()
    emb.warmup()
    conn = store.connect(read_only=True)
    rows, mat = rag_search.load_matrix(conn)
    print(f"向量库：{len(rows)} 块")

    floor = rag_search.vector_floor()
    print(f"拒答阈值（向量档）：{floor}")

    def rank(query: str) -> list[str]:
        ranked = rag_search.vector_rank(rows, mat, emb, query, limit_docs=limit)
        if not ranked or ranked[0][1] < floor:      # 低于阈值 → 拒答（返回空）
            return []
        return [d for d, _s, _r in ranked]

    return rank


def build_hybrid_ranker(limit: int = 10, conf_sink: dict[str, str] | None = None) -> Callable[[str], list[str]]:
    from rag import search as rag_search  # noqa: PLC0415
    from rag.embedder import Embedder  # noqa: PLC0415

    config.apply_hf_env()
    emb = Embedder()
    emb.warmup()
    conn_rag = store.connect(read_only=True)
    rows, mat = rag_search.load_matrix(conn_rag)
    conn_index = sqlite3.connect(f"file:{config.INDEX_DB.as_posix()}?mode=ro", uri=True)
    conn_index.row_factory = sqlite3.Row
    print(f"融合：向量库 {len(rows)} 块 + 工作台 FTS")

    def rank(query: str) -> list[str]:
        out = rag_search.hybrid(conn_index, conn_rag, emb, query, topk=limit,
                                vector_rows=rows, vector_mat=mat)
        if conf_sink is not None:
            conf_sink[query] = str(out.get("confidence") or "")
        if out.get("confidence") == "none":     # 只有硬拒答才算「空手」
            return []
        return [s["doc_id"] for s in out["sources"]]

    return rank


# ------------------------------------------------------------------ 打分
def evaluate(mode: str, ranker: Callable[[str], list[str]], queries: list[dict[str, Any]],
             topk: int = 5, mrr_k: int = 10,
             conf_sink: dict[str, str] | None = None) -> dict[str, Any]:
    per_query: list[dict[str, Any]] = []
    hits = 0
    positives = 0
    rr_sum = 0.0
    neg_total = 0
    neg_false = 0
    neg_mislabel = 0
    for item in queries:
        ranked = ranker(item["query"])
        expected = list(item.get("expected_doc_ids") or [])
        if item["type"] == "negative":
            neg_total += 1
            false_hit = bool(ranked)
            conf = (conf_sink or {}).get(item["query"], "")
            mislabel = conf in ("high", "medium")
            if false_hit:
                neg_false += 1
            if mislabel:
                neg_mislabel += 1
            per_query.append({"id": item["id"], "type": item["type"], "query": item["query"],
                              "rank": None, "hit": None, "false_hit": false_hit,
                              "confidence": conf, "mislabel": mislabel})
            continue
        positives += 1
        rank = next((i for i, doc in enumerate(ranked, 1) if doc in expected), None)
        hit = rank is not None and rank <= topk
        hits += 1 if hit else 0
        if rank and rank <= mrr_k:
            rr_sum += 1.0 / rank
        per_query.append({"id": item["id"], "type": item["type"], "query": item["query"],
                          "rank": rank, "hit": hit, "expected": expected, "top3": ranked[:3],
                          "confidence": (conf_sink or {}).get(item["query"], "")})
    return {
        "mode": mode,
        "total": len(queries),
        "positives": positives,
        "recall@5": round(hits / positives, 4) if positives else 0.0,
        "mrr@10": round(rr_sum / positives, 4) if positives else 0.0,
        "negative_false_recall": round(neg_false / neg_total, 4) if neg_total else 0.0,
        "negative_mislabel": round(neg_mislabel / neg_total, 4) if neg_total else 0.0,
        "per_query": per_query,
    }


def render(result: dict[str, Any], queries: list[dict[str, Any]], topk: int = 5) -> str:
    lines = [
        f"# kb RAG 评测 · {result['mode']}",
        "",
        f"> 时间：{dt.datetime.now().strftime('%Y-%m-%d %H:%M')} ｜ 评测集：`{QUERIES.name}`"
        f"（{result['total']} 条 = 正样本 {result['positives']} + 负样本 {result['total']-result['positives']}）",
        "",
        "| 指标 | 值 |",
        "| --- | --- |",
        f"| Recall@{topk} | **{result['recall@5']:.3f}** |",
        f"| MRR@10 | **{result['mrr@10']:.3f}** |",
        f"| 负样本误召回率 | {result['negative_false_recall']:.3f} |",
        "",
        "## 逐条",
        "",
        "| id | 类型 | 查询 | 首次命中排名 | 是否命中 |",
        "| --- | --- | --- | --- | --- |",
    ]
    for row in result["per_query"]:
        if row["type"] == "negative":
            lines.append(f"| {row['id']} | negative | {row['query'][:28]} | — | {'误召回' if row['false_hit'] else '正确空手'} |")
        else:
            lines.append(
                f"| {row['id']} | {row['type']} | {row['query'][:28]} | "
                f"{row['rank'] if row['rank'] else '未命中'} | {'✅' if row['hit'] else '❌'} |"
            )
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True,
                    choices=["fts_legacy", "fts", "vector", "rrf"])
    ap.add_argument("--db", type=Path, default=DEFAULT_SNAPSHOT, help="fts_legacy 用的快照库")
    ap.add_argument("--topk", type=int, default=5)
    ap.add_argument("--limit", type=int, default=0, help="只跑前 N 条（调试）")
    ap.add_argument("--report", type=Path, default=None, help="输出 markdown 报告路径")
    ap.add_argument("--show", action="store_true", help="打印逐条明细")
    args = ap.parse_args()

    queries = load_queries(args.limit)
    conf_sink: dict[str, str] = {}
    if args.mode == "fts_legacy":
        if not args.db.is_file():
            print(f"快照库不存在：{args.db}", file=sys.stderr)
            return 2
        print(f"基线库（修复前 trigram）：{args.db}")
        ranker = lambda q: rank_fts_legacy(args.db, q, limit=10)  # noqa: E731
    elif args.mode == "fts":
        ranker = lambda q: rank_fts(q, limit=10)  # noqa: E731
    elif args.mode == "vector":
        ranker = build_vector_ranker(limit=10)
    else:
        ranker = build_hybrid_ranker(limit=10, conf_sink=conf_sink)

    result = evaluate(args.mode, ranker, queries, topk=args.topk, conf_sink=conf_sink)
    print(f"\n[{result['mode']}] 正样本 {result['positives']} · "
          f"Recall@{args.topk}={result['recall@5']:.3f} · MRR@10={result['mrr@10']:.3f} · "
          f"负样本返回率={result['negative_false_recall']:.3f} · "
          f"负样本高置信误标率={result['negative_mislabel']:.3f}")
    if args.show:
        print()
        for row in result["per_query"]:
            if row["type"] == "negative":
                print(f"  {row['id']} {row['type']:<10} {row['query'][:24]:<26} "
                      f"{'误召回' if row['false_hit'] else '空手'}")
            else:
                mark = "✅" if row["hit"] else "❌"
                print(f"  {row['id']} {row['type']:<10} {row['query'][:24]:<26} "
                      f"{mark} rank={row['rank'] or '-'}")
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(render(result, queries, topk=args.topk), encoding="utf-8")
        print(f"报告已写入 {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
