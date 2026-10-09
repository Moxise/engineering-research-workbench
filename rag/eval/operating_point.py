# -*- coding: utf-8 -*-
"""工作点实验：一个阈值参数同时决定「拒答率（负样本）」与「Recall@5（正样本）」。

拒答规则（rag/search.py 同款）：FTS 无命中 **且** 最高向量相似度 < 阈值 → 拒答。
用法（cuda env）：python .scratch/tmp/_op_point.py
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(r"D:/Project/engineering-research-workbench")
sys.path.insert(0, str(ROOT))

from rag import config, search as rag_search, store  # noqa: E402
from rag.eval.run_eval import load_queries  # noqa: E402

config.apply_hf_env()
from rag.embedder import Embedder  # noqa: E402

WEIGHTS = {"fts": 0.5, "vector": 1.0, "graph": 0.0}

emb = Embedder()
emb.warmup()
conn_rag = store.connect(read_only=True)
rows, mat = rag_search.load_matrix(conn_rag)
conn_index = sqlite3.connect(f"file:{config.INDEX_DB.as_posix()}?mode=ro", uri=True)
conn_index.row_factory = sqlite3.Row

pos: list[dict] = []
neg: list[dict] = []
for item in load_queries():
    fts = rag_search.fts_rank(conn_index, item["query"], limit=30)
    vec = rag_search.vector_rank(rows, mat, emb, item["query"], limit_docs=30)
    record = {
        "item": item,
        "fts": fts,
        "vec_ids": [d for d, _s, _r in vec],
        "vec_top": vec[0][1] if vec else 0.0,
    }
    (neg if item["type"] == "negative" else pos).append(record)
print(f"正样本 {len(pos)} · 负样本 {len(neg)}\n")

print("  阈值   | 正样本 Recall@5  MRR@10  被误拒 | 负样本拒答率")
for floor in [0.40, 0.45, 0.47, 0.50, 0.52, 0.55, 0.5718, 0.60, 0.65]:
    hits = 0
    rr = 0.0
    refused_pos = 0
    for record in pos:
        refused = (not record["fts"]) and record["vec_top"] < floor
        if refused:
            refused_pos += 1
            continue
        ranked = [d for d, _s in rag_search.rrf(
            {"fts": record["fts"], "vector": record["vec_ids"]}, weights=WEIGHTS)]
        expected = list(record["item"]["expected_doc_ids"])
        rank = next((i for i, d in enumerate(ranked, 1) if d in expected), None)
        if rank and rank <= 5:
            hits += 1
        if rank and rank <= 10:
            rr += 1.0 / rank
    refused_neg = sum(1 for r in neg if (not r["fts"]) and r["vec_top"] < floor)
    recall = hits / len(pos)
    mrr = rr / len(pos)
    print(f"  {floor:<6} | {recall:.3f}            {mrr:.3f}   {refused_pos:<7} | "
          f"{refused_neg}/{len(neg)} = {refused_neg/len(neg):.2f}")
