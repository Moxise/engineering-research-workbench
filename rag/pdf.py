# -*- coding: utf-8 -*-
"""PDF 全文提取（PyMuPDF，逐页保留页码）。

为什么要页码：科研场景的「查出处」必须能定位到「论文 X 第 N 页」，因此按页提取、
分块时把页码带进 chunk，检索结果里直接给出页码与 PDF 路径。

映射关系（实测 56/56）：`documents.attachment` 存的是**相对 Workspace 根**的 PDF 路径，
形如 `Knowledge/Literature/PDF/<zotero附件key>_<作者-年-标题>.pdf` —— 用它把 PDF 挂回文献条目，
这样检索命中 PDF 片段时引用的是**知识库条目 id**（可核验），而不是一个裸文件名。
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any

from rag import config

_PAGE_NO_LINE = re.compile(r"^\s*\d{1,4}\s*$")
_MULTI_SPACE = re.compile(r"[ \t]{2,}")
_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")

# ---------------------------------------------------------------- 噪声页/片段识别
# 为什么需要：目录页罗列全部章节标题、参考文献页罗列大量领域术语、封面/摘要页是元数据，
# 它们**关键词密度极高**，在向量检索里会被顶到前面，但作为「证据」毫无价值
# （用户实测反馈：点进去看到的是目录与参考文献；截图里 p.150 整页是 ［4］李凡．…［D］．西安电子科技大学）。
# 两级过滤：页级（page_kind）+ 片段级（chunk_is_noise，兜住混排页里的引用块）。
_EXTRACT_VERSION = 6  # 提取/过滤逻辑版本：改动后必须让 PDF 分域重新入库（见 build_index 的指纹）
EXTRACT_VERSION = _EXTRACT_VERSION  # 公开别名，供 build_index 组装指纹

_HEAD_REFS = re.compile(r"^\s*(参考文献|引用文献|References|REFERENCES|Bibliography|BIBLIOGRAPHY)\b")
_HEAD_TOC = re.compile(r"^\s*(目录|目\s*录|Contents|CONTENTS|Table of Contents)\b")
_HEAD_FRONT = re.compile(
    r"^\s*(致\s*谢|Acknowledg|基金项目|作者简介|Biograph|About the author|"
    r"摘要|Abstract|关键词|Keywords|收稿日期|通讯作者|学位论文原创性声明|独创性声明)"
)
_DOT_LEADER = re.compile(r"\.{4,}\s*\d{1,4}\s*$")
#: 引用/书目特征（在**全角转半角归一化后**匹配）
_CITE_LINE = re.compile(
    r"(\[\d{1,3}\]|\(\s*(19|20)\d{2}\s*[a-z]?\s*\)|et al\.|"
    r"doi:|DOI:|vol\.\s*\d+|pp\.\s*\d+|学报|出版社|Proceedings|Conference on|Journal of)"
)
#: 中文学位论文/期刊的文献类型标记与常见书目要素
_REF_MARKERS = re.compile(
    r"(\[\d{1,3}\]|\[[DJMCRPN]\]|学位论文|出版社|大学学报|大学硕士学位论文|大学博士学位论文|"
    r"et al\.|doi:|DOI:|Proceedings|Conference on|Journal of|vol\.\s*\d+|pp\.\s*\d+|ISBN|"
    r"\(\s*(19|20)\d{2}\s*[a-z]?\s*\)|，\s*(19|20)\d{2}|．\s*(19|20)\d{2})"
)
#: 文本框/乱码/全角数字密集等「文本层质量差」的迹象
_GARBAGE = re.compile(r"[□■◻◼�]")


def normalize_width(text: str) -> str:
    """全角 → 半角（数字/字母/常见标点）。

    必需：中文学位论文的参考文献常写成「［4］李凡．…［D］．西安电子科技大学」，全角方括号与
    全角点号会让半角正则全部失配 —— 这是第一版剔噪漏掉整页参考文献的直接原因。
    """
    out = []
    for ch in text or "":
        code = ord(ch)
        if 0xFF01 <= code <= 0xFF5E:          # 全角 ASCII 区
            out.append(chr(code - 0xFEE0))
        elif code == 0x3000:                  # 全角空格
            out.append(" ")
        elif code in (0x3002, 0x3001):         # 。 、
            out.append("." if code == 0x3002 else ",")
        elif 0xFF10 <= code <= 0xFF19:         # 全角数字（冗余兜底）
            out.append(chr(code - 0xFEE0))
        else:
            out.append(ch)
    return "".join(out)


def _cite_stats(text: str) -> tuple[int, float, float]:
    """返回 (引用标记数, 引用行占比, 短行占比)。"""
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    long_lines = [ln for ln in lines if len(ln) > 12]
    markers = len(_REF_MARKERS.findall(text))
    cite_ratio = (
        sum(1 for ln in long_lines if _CITE_LINE.search(ln)) / len(long_lines) if long_lines else 0.0
    )
    short_ratio = (
        sum(1 for ln in lines if len(ln) < 25) / len(lines) if lines else 0.0
    )
    return markers, cite_ratio, short_ratio


def page_kind(text: str, page_no: int = 0) -> str:
    """页级分类：body / refs / toc / front / empty（保守判定，宁可漏判不可误杀正文）。

    page_no 用于「论文首页的摘要/关键词页」判定 —— 那是元数据，且题录条目里已有摘要，
    留在索引里只会以低信息密度的方式抢占相似度。
    """
    raw = text or ""
    lines = [ln.strip() for ln in raw.split("\n") if ln.strip()]
    if not lines:
        return "empty"
    norm = normalize_width(raw)
    head = lines[0]
    if _HEAD_REFS.match(norm.strip().split("\n")[0].strip()) or _HEAD_REFS.match(head):
        return "refs"
    if _HEAD_TOC.match(head):
        return "toc"
    if _HEAD_FRONT.match(head):
        return "front"
    if page_no and page_no <= 3:
        # 论文前 3 页里的「摘要/关键词/收稿日期…」都是元数据（题录条目里已有摘要）。
        # 实测 CNKI 式题录页共 59 行、摘要在第 21 行，固定 20 行窗口会漏判 —— 故扫描前 45% 行，
        # 且要求标记出现在行首（避免正文里引用到 "Abstract" 就被误杀）。
        window = max(25, int(len(lines) * 0.45))
        for ln in lines[:window]:
            if _HEAD_FRONT.match(ln):
                return "front"
    markers, cite_ratio, short_ratio = _cite_stats(norm)
    # 参考文献页形态：短行多（每条一行）+ 引用标记密集
    if markers >= 6 and short_ratio >= 0.5 and len(lines) >= 6:
        return "refs"
    if markers >= 10:
        return "refs"
    long_lines = [ln for ln in lines if len(ln) > 12]
    if not long_lines:
        return "toc" if sum(1 for ln in lines if _DOT_LEADER.search(ln)) >= 3 else "body"
    if cite_ratio >= 0.55:
        return "refs"
    if sum(1 for ln in lines if _DOT_LEADER.search(ln)) >= 5:
        return "toc"
    return "body"


def chunk_is_noise(text: str) -> bool:
    """片段级噪声：兜住「正文页里夹着的引用块」与文本层乱码。

    判据刻意保守（宁留正文不误杀）：短片段 + 引用标记密集 + 短行占比高，三者同时成立。
    """
    norm = normalize_width(" ".join((text or "").split()))
    if len(norm) < 60:
        return False
    if len(_GARBAGE.findall(norm)) >= 2:
        return True
    markers = len(_REF_MARKERS.findall(norm))
    if markers < 3:
        return False
    density = markers / max(1.0, len(norm) / 80.0)      # 每 80 字 1 个标记 = 1.0
    digits = sum(1 for ch in norm if ch.isdigit())
    digit_ratio = digits / max(1, len(norm))
    return len(norm) < 300 and density >= 1.2 and digit_ratio >= 0.04


def clean_page_text(text: str) -> str:
    """保守清洗：合并断词、压缩空白、丢掉纯页码行（不动正文内容）。"""
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    lines = [ln.rstrip() for ln in text.split("\n")]
    kept = [ln for ln in lines if ln.strip() and not _PAGE_NO_LINE.match(ln)]
    joined = "\n".join(kept)
    return _MULTI_SPACE.sub(" ", joined).strip()


def extract_pages(pdf_path: Path) -> list[tuple[int, str]]:
    """返回 [(页码, 文本)]；扫描件（无文本层）返回空列表。"""
    try:
        import pymupdf  # noqa: PLC0415
    except ImportError:  # 兼容旧名
        import fitz as pymupdf  # type: ignore  # noqa: PLC0415

    pages: list[tuple[int, str]] = []
    with pymupdf.open(str(pdf_path)) as doc:
        for index, page in enumerate(doc, 1):
            text = clean_page_text(page.get_text("text"))
            if text:
                pages.append((index, text))
    return pages


def pdf_targets(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """列出可入库的 PDF：literature 条目 + 存在的 attachment 文件。"""
    rows = conn.execute(
        "SELECT id,title,kind,attachment FROM documents "
        "WHERE kind='literature' AND coalesce(attachment,'')<>'' ORDER BY title"
    ).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        rel = str(row["attachment"]).strip()
        path = config.WORKSPACE / rel
        if not path.is_file():
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        out.append({
            "doc_id": str(row["id"]),
            "title": str(row["title"] or ""),
            "kind": str(row["kind"] or "literature"),
            "rel_path": rel,
            "path": path,
            "mtime_ns": int(stat.st_mtime_ns),
            "size": int(stat.st_size),
        })
    return out


def chunks_for_pdf(target: dict[str, Any], *, chunker: Any, page_limit: int = 0,
                   keep_noise: bool = False) -> dict[str, Any]:
    """把一个 PDF 逐页分块成待嵌入行（页码 → chunk）。

    返回 {"rows": [...], "skipped": {kind: 页数}, "pages": 有文本页数}。
    keep_noise=False（默认）时跳过 refs/toc/front 页 —— 见 page_kind 的说明。
    """
    pages = extract_pages(target["path"])
    if page_limit:
        pages = [p for p in pages if p[0] <= page_limit]
    rows: list[dict[str, Any]] = []
    skipped: dict[str, int] = {}
    for page_no, text in pages:
        kind = page_kind(text, page_no)
        if kind != "body" and not keep_noise:
            skipped[kind] = skipped.get(kind, 0) + 1
            continue
        for seq, piece in enumerate(chunker.chunk_text(text)):
            if not keep_noise and chunk_is_noise(piece):
                skipped["chunk"] = skipped.get("chunk", 0) + 1      # 混排页里的引用块/乱码块
                continue
            rows.append({
                "chunk_id": f"{target['doc_id']}#pdf{page_no}#{seq}",
                "doc_id": target["doc_id"],
                "source_type": "pdf",
                "seq": seq,
                "title": target["title"],
                "kind": target["kind"],
                "status": "",
                "path": target["rel_path"],
                "page": page_no,
                "text": piece,
                # 指纹带提取版本：过滤规则一改，PDF 分域自动重新入库
                "doc_updated": f"pdfv{_EXTRACT_VERSION}",
                "mtime_ns": target["mtime_ns"],
            })
    return {"rows": rows, "skipped": skipped, "pages": len(pages)}
