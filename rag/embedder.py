# -*- coding: utf-8 -*-
"""kb RAG 层 · 向量编码器（bge-small-zh-v1.5，GPU 优先，惰性加载）。

用法：
    from rag import config
    config.apply_hf_env()          # 必须在 import sentence_transformers 之前
    from rag.embedder import Embedder
    emb = Embedder()
    vecs = emb.encode_docs(["..."])        # 文档侧：不加前缀
    qv = emb.encode_query("质心 定位")      # 查询侧：加 bge-zh 官方检索前缀
"""
from __future__ import annotations

import time
from typing import Any, Sequence

from . import config


class Embedder:
    """包装 SentenceTransformer，统一 dtype/device/batch 与查询前缀。"""

    def __init__(self, model_name: str | None = None, device: str | None = None,
                 batch_size: int = 32, max_length: int = 512, quiet: bool = True) -> None:
        self.model_name = model_name or config.MODEL_NAME
        self.device = device
        self.batch_size = batch_size
        self.max_length = max_length
        self.quiet = quiet
        self._model: Any = None
        self.load_seconds: float = 0.0

    # ------------------------------------------------------------------ 模型
    def _ensure_model(self) -> Any:
        if self._model is not None:
            return self._model
        config.apply_hf_env()
        import torch  # noqa: PLC0415
        from sentence_transformers import SentenceTransformer  # noqa: PLC0415

        if self.device is None:
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        t0 = time.perf_counter()
        model = SentenceTransformer(self.model_name, device=self.device)
        if self.device == "cuda":
            try:
                model.half()          # 8 GB 显存上省一半，检索精度无实质损失
            except Exception:         # noqa: BLE001
                pass
        model.max_seq_length = self.max_length
        self._model = model
        self.load_seconds = time.perf_counter() - t0
        return model

    @property
    def dim(self) -> int:
        return int(self._ensure_model().get_sentence_embedding_dimension())

    def warmup(self) -> dict[str, Any]:
        """加载模型并跑一次小批量，返回设备/维度/耗时（服务启动自检用）。"""
        import torch  # noqa: PLC0415

        t0 = time.perf_counter()
        vec = self.encode_docs(["warmup"])
        return {
            "model": self.model_name,
            "device": self.device,
            "dim": len(vec[0]),
            "dtype": str(next(self._ensure_model().parameters()).dtype),
            "cuda": bool(torch.cuda.is_available()),
            "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
            "load_seconds": round(self.load_seconds, 2),
            "warmup_seconds": round(time.perf_counter() - t0, 2),
        }

    # ---------------------------------------------------------------- 编码
    def _encode(self, texts: Sequence[str], prefix: str = "") -> list[list[float]]:
        model = self._ensure_model()
        payload = [prefix + t if prefix else t for t in texts]
        out = model.encode(
            payload,
            batch_size=self.batch_size,
            normalize_embeddings=True,     # 归一化后余弦 == 点积
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return [[float(x) for x in row] for row in out]

    def encode_docs(self, texts: Sequence[str]) -> list[list[float]]:
        """文档/片段侧编码：不加查询前缀。"""
        return self._encode(list(texts))

    def encode_query(self, text: str) -> list[float]:
        """查询侧编码：加 bge-zh 官方检索前缀（显著提升中文检索召回）。"""
        return self._encode([text], prefix=config.QUERY_INSTRUCTION)[0]


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    """两个已归一化向量的余弦相似度（退化为点积）。"""
    return float(sum(x * y for x, y in zip(a, b)))
