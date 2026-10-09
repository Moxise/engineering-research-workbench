# -*- coding: utf-8 -*-
"""M2 · 下载/校验 bge-small-zh-v1.5 权重到 .rag/models，并跑 GPU 编码基准。

用法（cuda env）：
    python rag/fetch_model.py              # 下载（若缺失）+ 基准
    python rag/fetch_model.py --offline    # 只用已下载权重（断网校验）
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag import config  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="只用本地权重，不联网")
    args = ap.parse_args()

    # 下载脚本默认联网（offline=False）；除非显式 --offline
    config.apply_hf_env(offline=args.offline)
    print(f"HF_HOME : {config.MODELS_DIR}")

    from rag.embedder import Embedder  # noqa: PLC0415

    emb = Embedder()
    info = emb.warmup()
    for key, value in info.items():
        print(f"  {key:<16}: {value}")

    docs = [
        "知识-模型-CW 相对运动模型：Clohessy-Wiltshire 方程的推导与适用条件。",
        "知识-方法-小区域滤波（SR）：利用局部背景估计抑制红外弱小目标背景杂波。",
        "文献-FIM-based observability analysis for angles-only relative navigation。",
    ]
    queries = ["CW 相对运动", "小区域滤波怎么抑制背景", "可观性分析"]

    t0 = time.perf_counter()
    dvecs = emb.encode_docs(docs)
    t_docs = time.perf_counter() - t0
    print(f"\n文档编码 {len(docs)} 条: {t_docs*1000:.0f} ms  ({t_docs/len(docs)*1000:.0f} ms/条)")

    from rag.embedder import cosine  # noqa: PLC0415

    for q in queries:
        qv = emb.encode_query(q)
        scored = sorted(((cosine(qv, dv), d[:26]) for dv, d in zip(dvecs, docs)), reverse=True)
        top = "  ".join(f"{s:+.3f} {t}" for s, t in scored)
        print(f"  {q:<24} -> {top}")

    t0 = time.perf_counter()
    emb.encode_query("冷启动计时")
    print(f"\n单条查询延迟: {(time.perf_counter()-t0)*1000:.0f} ms")
    print("\n模型就绪。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
