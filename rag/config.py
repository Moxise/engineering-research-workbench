# -*- coding: utf-8 -*-
"""kb RAG 层 · 路径与常量（唯一权威定义处）。

设计约束（见 docs/kb-RAG可行版方案.md）：
- 只读 kb：绝不写 Workspace/System/Cache/index.sqlite（唯一写入者是工作台）；
- 派生数据：rag.sqlite 可随时一键重建，放 System/Cache/ 下（已被 Workspace/.stignore 排除同步）；
- 模型权重与日志放仓库内 `.rag/`（gitignored，不进版本库，也不同于 .scratch 的 7 天清理）。
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKSPACE = ROOT / "Workspace"

#: 工作台派生索引（只读）
INDEX_DB = WORKSPACE / "System/Cache/index.sqlite"
#: RAG 派生索引（向量 + PDF chunk），可重建
RAG_DB = WORKSPACE / "System/Cache/rag.sqlite"

#: 本地工具数据（模型权重、日志），不进 git、不参与 7 天清理
LOCAL_DIR = ROOT / ".rag"
MODELS_DIR = LOCAL_DIR / "models"
LOG_DIR = LOCAL_DIR / "logs"

MODEL_NAME = "BAAI/bge-small-zh-v1.5"
MODEL_DIM = 512

HOST = "127.0.0.1"
PORT = 8770

#: bge-zh 系列检索时的官方查询前缀（只加在 query 侧，doc 侧不加）
QUERY_INSTRUCTION = "为这个句子生成表示以用于检索相关文章："

#: 服务未启动时的默认超时（秒）
CLIENT_TIMEOUT = 120.0


def model_cached(model_name: str = MODEL_NAME) -> bool:
    """本地是否已有该模型的完整快照（有则默认离线加载，不受断网影响）。"""
    slug = "models--" + str(model_name).replace("/", "--")
    for root in MODELS_DIR.rglob(slug):
        if root.is_dir() and any(root.rglob("*.safetensors")):
            return True
    return False


def apply_hf_env(offline: bool | None = None) -> None:
    """把 HuggingFace 缓存重定向到 `.rag/models`。

    必须在 import sentence_transformers / huggingface_hub **之前**调用：
    这些库在导入期即读取 HF_HOME/HF_HUB_CACHE。

    offline=None（默认）→ **自动**：本地已有模型快照就强制离线。
    为什么必须离线：HF 不可达时（实测 huggingface.co 连接超时 WinError 10060，重试 5 次约 30 s 后
    进入半离线状态），transformers 5.x 的 AutoProcessor 会走错分支并抛
    `Unrecognized processing class in BAAI/bge-small-zh-v1.5`，**整个向量层直接不可用**。
    权重已在本地，离线加载既快又不受断网影响。
    """
    for path in (LOCAL_DIR, MODELS_DIR, LOG_DIR):
        path.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(MODELS_DIR))
    os.environ.setdefault("HF_HUB_CACHE", str(MODELS_DIR / "hub"))
    os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(MODELS_DIR / "st"))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    if offline is None:
        offline = model_cached()
    if offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    else:
        os.environ.pop("HF_HUB_OFFLINE", None)
        os.environ.pop("TRANSFORMERS_OFFLINE", None)
