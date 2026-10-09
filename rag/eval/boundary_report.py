# -*- coding: utf-8 -*-
"""边界诊断：把「FTS 空 + 向量分」的正/负样本边界值打出来，用于选定拒答阈值。

用法（cuda env）：python .scratch/tmp/_boundary.py
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

emb = Embedder()
emb.warmup()
conn_rag = store.connect(read_only=True)
rows, mat = rag_search.load_matrix(conn_rag)
conn_index = sqlite3.connect(f"file:{config.INDEX_DB.as_posix()}?mode=ro", uri=True)
conn_index.row_factory = sqlite3.Row
print(f"向量库 {len(rows)} 块（含 PDF 全文片段）\n")

records = []
for item in load_queries():
    fts = rag_search.fts_rank(conn_index, item["query"], limit=30)
    vec = rag_search.vector_rank(rows, mat, emb, item["query"], limit_docs=5)
    top = vec[0] if vec else (None, 0.0, None)
    records.append({
        "id": item["id"], "type": item["type"], "query": item["query"],
        "fts": len(fts), "vec": top[1],
        "src": (str(top[2]["source_type"]) if top[2] is not None else "-"),
        "page": (top[2]["page"] if top[2] is not None else None),
        "title": (str(top[2]["title"])[:34] if top[2] is not None else ""),
    })

print("== 负样本（FTS 空才有意义）：按向量分降序 ==")
for r in sorted([x for x in records if x["type"] == "negative"], key=lambda x: -x["vec"]):
    print(f"  {r['vec']:.4f}  fts={r['fts']:<3} src={r['src']:<5} {r['query'][:30]}  ← {r['title']}")

print("\n== 正样本中「FTS 空」的（最容易被误拒）：按向量分升序 ==")
weak = sorted([x for x in records if x["type"] != "negative" and x["fts"] == 0], key=lambda x: x["vec"])
for r in weak[:12]:
    print(f"  {r['vec']:.4f}  src={r['src']:<5} {r['id']} {r['query'][:26]}  ← {r['title']}")
print(f"\n  （正样本共 {len([x for x in records if x['type']!='negative'])} 条，其中 FTS 空 {len(weak)} 条）")

print("\n== 正样本里 FTS 命中的数量 ==")
hit = [x for x in records if x["type"] != "negative" and x["fts"]]
print(f"  {len(hit)} 条 FTS 有命中 → 不会被拒答（拒答要求 FTS 空）")
