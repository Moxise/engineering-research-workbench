# -*- coding: utf-8 -*-
"""条目内分块：md 正文与 PDF 文本共用。

为什么需要分块（与原始方案的分歧）：原始方案主张「条目即 chunk」，但实测 kb 条目
均约 8 KB ≈ 3000+ 中文字，**远超 bge-small-zh 的 512 token 上限**，整条嵌入会被截断
到前 16%，尾部内容等于没进索引。因此改为条目内分块 + 检索时按 doc 聚合取最高分。

策略（stdlib 实现，确定性、可复现）：
1. 统一换行 → 按空行切块 → 按标题行优先断句；
2. 合并小块到 ~target 字符，单块超过 hard_max 时按句末标点强切；
3. 相邻块保留 overlap 字符，避免答案跨块被切断。
"""
from __future__ import annotations

import re

DEFAULT_TARGET = 380
DEFAULT_HARD_MAX = 500
DEFAULT_OVERLAP = 60

_HEADING = re.compile(r"^#{1,6}\s")
_FENCE = re.compile(r"^\s*```")
_SENT_END = re.compile(r"(?<=[。！？；!?;])\s*")


def normalize(text: str) -> str:
    """统一换行并压掉过多空行。"""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _split_blocks(text: str) -> list[str]:
    """按空行切块；代码围栏整体保留（内部空行不切）。"""
    blocks: list[str] = []
    buf: list[str] = []
    in_fence = False
    for line in text.split("\n"):
        if _FENCE.match(line):
            in_fence = not in_fence
            buf.append(line)
            continue
        if in_fence:
            buf.append(line)
            continue
        if not line.strip():
            if buf:
                blocks.append("\n".join(buf).strip())
                buf = []
            continue
        buf.append(line)
    if buf:
        blocks.append("\n".join(buf).strip())
    return [b for b in blocks if b]


def _split_long(block: str, hard_max: int, overlap: int) -> list[str]:
    """超长块：先按句末标点切，仍超长再硬切。"""
    pieces: list[str] = []
    for part in _SENT_END.split(block):
        part = part.strip()
        if not part:
            continue
        if len(part) <= hard_max:
            pieces.append(part)
            continue
        step = max(1, hard_max - overlap)
        pieces.extend(part[i : i + hard_max] for i in range(0, len(part), step))
    return pieces


def chunk_text(text: str, *, target: int = DEFAULT_TARGET, hard_max: int = DEFAULT_HARD_MAX,
               overlap: int = DEFAULT_OVERLAP) -> list[str]:
    """把一段文本切成检索块（不保证覆盖全部字符，但对正文是全覆盖）。"""
    body = normalize(text)
    if not body:
        return []
    if len(body) <= hard_max:
        return [body]

    units: list[str] = []
    for block in _split_blocks(body):
        if len(block) <= hard_max:
            units.append(block)
        else:
            units.extend(_split_long(block, hard_max, overlap))

    chunks: list[str] = []
    current = ""
    for unit in units:
        if not current:
            current = unit
            continue
        if len(current) + 2 + len(unit) <= target:
            current = f"{current}\n\n{unit}"
            continue
        chunks.append(current)
        tail = current[-overlap:] if overlap > 0 else ""
        current = f"{tail}\n{unit}".strip() if tail else unit
        if len(current) > hard_max:
            chunks.append(current[:hard_max])
            current = current[hard_max - overlap :] if overlap > 0 else current[hard_max:]
    if current.strip():
        chunks.append(current.strip())
    return [c for c in chunks if c.strip()]


def strip_frontmatter(text: str) -> tuple[str, dict[str, str]]:
    """剥离 YAML frontmatter（实测 md 为 CRLF，故必须容忍 \\r\\n）。

    返回 (正文, frontmatter 键值近似字典)。字典只做宽松解析，够用即可。
    """
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    if not raw.startswith("---"):
        return raw, {}
    end = raw.find("\n---", 3)
    if end < 0:
        return raw, {}
    head = raw[3:end]
    body = raw[end + 4 :]
    meta: dict[str, str] = {}
    for line in head.split("\n"):
        if ":" in line and not line.startswith((" ", "-", "\t")):
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    return body.lstrip("\n"), meta


def snippet(text: str, limit: int = 220, query: str = "") -> str:
    """生成摘要片段：尽量包含查询词附近的内容。"""
    body = re.sub(r"\s+", " ", normalize(text))
    if len(body) <= limit:
        return body
    if query:
        for term in re.split(r"\s+", query.strip()):
            if len(term) >= 2:
                pos = body.casefold().find(term.casefold())
                if pos >= 0:
                    start = max(0, pos - limit // 3)
                    return ("…" if start else "") + body[start : start + limit] + "…"
    return body[:limit] + "…"
