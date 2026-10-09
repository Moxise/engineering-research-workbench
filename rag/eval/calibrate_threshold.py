# -*- coding: utf-8 -*-
"""标定「拒答阈值」：负样本（库里确实没有答案）与正样本的最高向量相似度分界。

拒答规则（见 rag/search.py）：FTS 无命中 **且** 最高向量相似度低于阈值 → 判定「未找到相关内容」。
本脚本用评测集实测两类查询的分数分布，给出可分性最好的阈值，写进 rag/eval/threshold.json。

用法（cuda env）：python rag/eval/calibrate_threshold.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from rag import config, search as rag_search, store  # noqa: E402
from rag.eval.run_eval import load_queries  # noqa: E402

OUT = Path(__file__).resolve().parent / "threshold.json"
DEFAULT_FLOOR = 0.45


def main() -> int:
    config.apply_hf_env()
    from rag.embedder import Embedder  # noqa: PLC0415

    emb = Embedder()
    emb.warmup()
    conn = store.connect(read_only=True)
    rows, mat = rag_search.load_matrix(conn)
    print(f"向量库 {len(rows)} 块 · 评测集 {len(load_queries())} 条\n")

    positives: list[tuple[float, str]] = []
    negatives: list[tuple[float, str]] = []
    for item in load_queries():
        ranked = rag_search.vector_rank(rows, mat, emb, item["query"], limit_docs=1)
        top = ranked[0][1] if ranked else 0.0
        (negatives if item["type"] == "negative" else positives).append((top, item["query"]))

    negatives.sort(reverse=True)
    positives.sort()
    print("负样本 Top1 相似度（应低于阈值）：")
    for score, query in negatives:
        print(f"  {score:.4f}  {query[:40]}")
    print("\n正样本 Top1 相似度最低的 8 条（应高于阈值）：")
    for score, query in positives[:8]:
        print(f"  {score:.4f}  {query[:40]}")

    neg_max = max(s for s, _ in negatives) if negatives else 0.0
    pos_min = min(s for s, _ in positives) if positives else 1.0
    floor = round((neg_max + pos_min) / 2, 4) if pos_min > neg_max else round(neg_max, 4)
    separated = pos_min > neg_max
    print(f"\n负样本最高 {neg_max:.4f} · 正样本最低 {pos_min:.4f} → "
          f"{'可分' if separated else '重叠'}，阈值取 {floor:.4f}")

    OUT.write_text(
        json.dumps({
            "vector_min_score": floor,
            "separated": separated,
            "negative_max": round(neg_max, 4),
            "positive_min": round(pos_min, 4),
            "default_floor": DEFAULT_FLOOR,
            "calibrated_at": __import__("datetime").datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "queries": len(positives) + len(negatives),
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"已写入 {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
