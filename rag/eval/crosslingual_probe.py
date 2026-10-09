# -*- coding: utf-8 -*-
"""跨语言检索诊断：中文提问 → 英文文献，看真实分数与排名（不做拒答）。

用法（cuda env）：python .scratch/tmp/_crosslingual.py
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(r"D:/Project/engineering-research-workbench")
sys.path.insert(0, str(ROOT))

from rag import config, search as rag_search, store  # noqa: E402

config.apply_hf_env()
from rag.embedder import Embedder  # noqa: E402

QUERIES = [
    "传感器切换时的配准",          # 期望命中《Multimodal Navigation》（讲 multimodal/sensor handover）
    "多模态导航在空间交会中的应用",
    "angles-only 相对导航的可观性",
    "星点提取的阈值怎么定",
    "探测器切换时如何保持配准精度",
]

emb = Embedder()
emb.warmup()
conn_rag = store.connect(read_only=True)
rows, mat = rag_search.load_matrix(conn_rag)
print(f"向量库 {len(rows)} 块\n")
for q in QUERIES:
    ranked = rag_search.vector_rank(rows, mat, emb, q, limit_docs=5)
    print(f"■ {q}")
    for doc_id, score, row in ranked:
        print(f"    {score:.4f}  {str(row['source_type']):<4} p.{str(row['page'] or '-'):<4} "
              f"{str(row['title'])[:44]}")
    print()
