# -*- coding: utf-8 -*-
"""置信信号的分离度实验：绝对分 vs 峰值显著性（top1 相对全库分数的 z / margin）。

动机：绝对分分不开「跨语言正确命中（0.55~0.61）」与「离题命中（0.48~0.61）」。
若 query 的分数分布有尖峰（top1 明显高于自身背景），才是真命中；离题查询分布应当更平。

用法（cuda env）：python .scratch/tmp/_signal_experiment.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(r"D:/Project/engineering-research-workbench")
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402

from rag import config, search as rag_search, store  # noqa: E402
from rag.eval.run_eval import load_queries  # noqa: E402

config.apply_hf_env()
from rag.embedder import Embedder  # noqa: E402

emb = Embedder()
emb.warmup()
conn = store.connect(read_only=True)
rows, mat = rag_search.load_matrix(conn)
print(f"向量库 {len(rows)} 块 · 评测集 {len(load_queries())} 条\n")

records = []
for item in load_queries():
    qv = np.asarray(emb.encode_query(item["query"]), dtype="float32")
    scores = mat @ qv
    top1 = float(scores.max())
    mean = float(scores.mean())
    std = float(scores.std())
    records.append({
        "type": item["type"], "query": item["query"], "top1": top1,
        "z": (top1 - mean) / (std or 1e-6), "margin": top1 - mean,
        "k": item["id"],
    })

for key in ("top1", "z", "margin"):
    pos = sorted(r[key] for r in records if r["type"] != "negative")
    neg = sorted(r[key] for r in records if r["type"] == "negative")
    p_min, n_max = pos[0], neg[-1]
    # 分离度：负样本里有几个超过「正样本最小值」
    overlap = sum(1 for v in neg if v >= p_min)
    print(f"[{key:<7}] 正样本 min={p_min:.4f} · 负样本 max={n_max:.4f} · "
          f"{'可分' if p_min > n_max else f'重叠（{overlap}/8 负样本越过正样本下限）'}")

print("\n== 按 z 降序的负样本 ==")
for r in sorted([x for x in records if x["type"] == "negative"], key=lambda x: -x["z"]):
    print(f"  z={r['z']:.2f}  top1={r['top1']:.4f}  {r['query'][:32]}")

print("\n== 按 z 升序的正样本（最弱的 8 条）==")
for r in sorted([x for x in records if x["type"] != "negative"], key=lambda x: x["z"])[:8]:
    print(f"  z={r['z']:.2f}  top1={r['top1']:.4f}  {r['k']} {r['query'][:30]}")
