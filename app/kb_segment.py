# -*- coding: utf-8 -*-
"""中文 bigram 预分词：FTS 写入侧与查询侧**唯一共用**的实现。

为什么需要（实测）：`documents_fts` 原用 `tokenize='trigram'`，而 trigram 要求 token
≥ 3 字符，于是「质心」「滤波」「CW」这类最高频的领域短词在 `MATCH` 下永远 0 命中
（27 个回归词实测仅 12 个命中）。改用：

- 写入侧：中文按 2 字滑窗切分，英文/数字整体小写，空格连接；表用 `tokenize='unicode61'`；
- 查询侧：同一个 `segment()` 切分；**词内 bigram 组成短语**（等价于原子串匹配），
  **词间 AND**（多词查询不再要求整串相邻），并在无结果时允许降级为 OR。

两侧必须调用同一函数，否则索引 token 与查询 token 对不上 —— 这是本模块存在的唯一理由。
本模块只依赖标准库，故工作台（3.12）、RAG 服务（3.14）与评测脚本可共用。
"""
from __future__ import annotations

import re

#: 连续 ASCII 字母数字 或 连续 CJK 汉字 视为一个 token 源
_TOKEN_SOURCE = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+")
#: 查询分词：按空白与中英文标点切词
_TERM_SPLIT = re.compile(r"[\s,，。；;、:：/\\|()\[\]{}<>《》\"'“”‘’!！?？+*~^$#@%&=\-_]+")


def segment(text: str) -> str:
    """切分文本用于**写入** FTS：中文 bigram 滑窗 + 英文/数字小写，空格连接。

    >>> segment("本项目采用CW相对运动模型")
    '本项 项目 目采 采用 用 cw 相对 对运 运动 动模 模型'
    """
    out: list[str] = []
    for match in _TOKEN_SOURCE.finditer(str(text or "")):
        piece = match.group()
        if piece[0].isascii():
            out.append(piece.lower())
        elif len(piece) == 1:
            out.append(piece)
        else:
            out.extend(piece[i : i + 2] for i in range(len(piece) - 1))
    return " ".join(out)


def tokens_for_term(term: str) -> list[str]:
    """单个查询词 → 索引里的 token 序列（与 segment 完全一致的切分规则）。"""
    return segment(term).split()


def terms(text: str) -> list[str]:
    """把查询切成词：空白/标点分隔；整串无分隔符时本身就是一词。"""
    return [t for t in _TERM_SPLIT.split(str(text or "").strip()) if t]


def match_expression(text: str, *, mode: str = "and") -> str:
    """构造 FTS5 MATCH 表达式。

    - `and`：词内 bigram 组成短语（等价原子串匹配），词间 AND —— 精确、可作证据；
    - `or`：同上但词间 OR —— 多词查询的降级召回；
    - `loose`：把**每个 bigram 都当独立词并 OR 连接** —— 中文整句查询的兜底。
      为什么需要：`红外暗弱目标识别` 这类没有一个空格的整句，在 and/or 下都是「整串短语匹配」，
      只要原文措辞略有差别就 0 命中（实测线上就是 0 命中，而库里明明有大量相关条目）。
      注意 loose 极宽松、几乎总能命中，**只能用于「有没有相关内容」的检索，不能当作证据**。
    """
    keyword = str(mode).lower()
    if keyword == "loose":
        tokens: list[str] = []
        for term in terms(text):
            tokens.extend(tokens_for_term(term))
        return " OR ".join(f'"{t}"' for t in dict.fromkeys(tokens))
    joiner = " OR " if keyword == "or" else " AND "
    parts: list[str] = []
    for term in terms(text):
        toks = tokens_for_term(term)
        if not toks:
            continue
        # token 只可能是 [a-z0-9] 与汉字，不含引号，故直接加引号安全
        parts.append('"' + " ".join(toks) + '"')
    return joiner.join(parts)


def like_pattern(text: str) -> str:
    """LIKE 兜底用的模式（小写化，调用方需 lower() 列）。"""
    return f"%{str(text or '').strip().casefold()}%"


__all__ = ["segment", "tokens_for_term", "terms", "match_expression", "like_pattern"]
