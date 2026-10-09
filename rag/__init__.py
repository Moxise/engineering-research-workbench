# -*- coding: utf-8 -*-
"""kb RAG 层（本地检索增强）。

模块划分：
    config      路径/常量/HF 环境重定向（必须在 import sentence_transformers 前调用）
    chunk       条目内分块（md 与 PDF 文本共用）
    store       rag.sqlite 的 schema 与读写（派生数据，可重建）
    embedder    bge-small-zh-v1.5 向量编码（GPU 优先）
    build_index 从 index.sqlite + md 正文构建/增量刷新向量索引
    search      向量检索 + RRF 融合（FTS / 向量 / 图）
    service     本机 HTTP 服务（127.0.0.1:8770）
    client      stdlib 客户端（MCP / 内置 Agent 调用）

硬约束：只读 Workspace（绝不写 index.sqlite），rag.sqlite 可随时重建。
"""
