# -*- coding: utf-8 -*-
"""M2/M4 · 构建/增量刷新 rag.sqlite 向量索引（只读 kb，可随时重建）。

索引两类语料（同一向量空间，结果里以 source_type 区分）：
  md   知识条目正文（199 条，按 ~380 字分块）
  pdf  文献全文（56 篇，**逐页**分块，保留页码；经 documents.attachment 挂回文献条目）

用法（cuda env，含 GPU 编码）：
    python rag/build_index.py --dry-run            # 只看要处理哪些条目（不加载模型）
    python rag/build_index.py                      # 增量：md + pdf 都处理
    python rag/build_index.py --no-pdf             # 只处理 md
    python rag/build_index.py --pdf-only           # 只处理 PDF
    python rag/build_index.py --rebuild            # 全量重建
    python rag/build_index.py --pdf-limit 3        # 只处理前 3 篇 PDF（小样验证）
"""
from __future__ import annotations

import argparse
import datetime as dt
import sqlite3
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rag import chunk as chunker  # noqa: E402
from rag import config, pdf as pdfmod, store  # noqa: E402

DOC_SQL = (
    "SELECT id, path, kind, coalesce(status,'') AS status, coalesce(title,'') AS title, "
    "coalesce(excerpt,'') AS excerpt, coalesce(tags_json,'') AS tags_json, "
    "coalesce(updated,'') AS updated, coalesce(mtime_ns,0) AS mtime_ns, "
    "coalesce(attachment,'') AS attachment "
    "FROM documents ORDER BY kind, id"
)


def read_index_docs() -> list[sqlite3.Row]:
    conn = sqlite3.connect(f"file:{config.INDEX_DB.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        return conn.execute(DOC_SQL).fetchall()
    finally:
        conn.close()


def load_body(rel_path: str) -> str:
    """读取条目 md 正文并剥离 frontmatter（实测 md 为 CRLF，strip_frontmatter 已容忍）。"""
    path = config.WORKSPACE / rel_path
    if not path.is_file():
        return ""
    try:
        raw = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    body, _meta = chunker.strip_frontmatter(raw)
    return body


def chunks_for_doc(row: sqlite3.Row) -> list[dict]:
    """把一条 kb 条目切成待嵌入块（整条正文分块，标题进每块的嵌入前缀）。"""
    body = load_body(str(row["path"] or ""))
    head = str(row["title"] or "").strip()
    excerpt = chunker.normalize(str(row["excerpt"] or ""))
    text = body or excerpt
    if not text:
        return []
    out: list[dict] = []
    for seq, piece in enumerate(chunker.chunk_text(text)):
        out.append({
            "chunk_id": f"{row['id']}#{seq}",
            "doc_id": str(row["id"]),
            "source_type": "md",
            "seq": seq,
            "title": head,
            "kind": str(row["kind"] or ""),
            "status": str(row["status"] or ""),
            "path": str(row["path"] or ""),
            "page": None,
            "text": piece,
            "doc_updated": str(row["updated"] or ""),
            "mtime_ns": int(row["mtime_ns"] or 0),
        })
    return out


def embedding_payload(rows: list[dict]) -> list[str]:
    """实际送进模型文本 = 标题 + 正文块（标题给每块补上下文）。"""
    return [f"{r['title']}\n{r['text']}" if r["title"] else r["text"] for r in rows]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只统计，不加载模型不写库")
    ap.add_argument("--rebuild", action="store_true", help="清空后全量重建")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 条 md（小样验证）")
    ap.add_argument("--no-pdf", action="store_true", help="不处理文献 PDF 全文")
    ap.add_argument("--pdf-only", action="store_true", help="只处理 PDF 全文")
    ap.add_argument("--pdf-limit", type=int, default=0, help="只处理前 N 篇 PDF")
    ap.add_argument("--pdf-page-limit", type=int, default=0, help="每篇只取前 N 页（调试）")
    ap.add_argument("--keep-noise", action="store_true",
                    help="保留目录/参考文献/封面等噪声页（默认剔除，见 rag/pdf.py:page_kind）")
    args = ap.parse_args()

    t0 = time.perf_counter()
    want_md = not args.pdf_only
    want_pdf = not args.no_pdf

    conn_index = sqlite3.connect(f"file:{config.INDEX_DB.as_posix()}?mode=ro", uri=True)
    conn_index.row_factory = sqlite3.Row
    all_docs = conn_index.execute(DOC_SQL).fetchall()
    all_targets = pdfmod.pdf_targets(conn_index)
    conn_index.close()

    # 「存活全集」必须来自**完整语料**，不受 --no-pdf/--pdf-only/--limit 影响：
    # 否则按分域或条数取子集运行时，未选中的分域会被误判为已消失而删除（曾误删 3093 个 md 块）。
    live_keys: set[str] = {f"{r['id']}|md" for r in all_docs}
    live_keys |= {f"{t['doc_id']}|pdf" for t in all_targets}

    docs = all_docs if want_md else []
    if args.limit:
        docs = docs[: args.limit]
    targets = all_targets if want_pdf else []
    if args.pdf_limit:
        targets = targets[: args.pdf_limit]
    print(f"语料全集：md {len(all_docs)} 条 · PDF {len(all_targets)} 篇"
          f"（本次处理 md {len(docs)} · PDF {len(targets)}）")

    conn = store.connect()
    store.ensure_schema(conn)
    if args.rebuild and not args.dry_run:
        conn.execute("DELETE FROM chunks")
        conn.commit()
        print("已清空 chunks（全量重建）")
    fingerprints = store.chunk_fingerprints(conn)

    pending_md: list[sqlite3.Row] = []
    pending_pdf: list[dict] = []

    for row in docs:
        key = f"{row['id']}|md"
        if fingerprints.get(key) == (str(row["updated"] or ""), int(row["mtime_ns"] or 0)):
            continue
        if chunks_for_doc(row):
            pending_md.append(row)

    for target in targets:
        key = f"{target['doc_id']}|pdf"
        if fingerprints.get(key) == (f"pdfv{pdfmod.EXTRACT_VERSION}", int(target["mtime_ns"])):
            continue
        pending_pdf.append(target)

    print(f"待处理：md {len(pending_md)} 条 · PDF {len(pending_pdf)} 篇")
    gone = [k for k in fingerprints if k not in live_keys]

    if args.dry_run:
        for row in pending_md[:5]:
            print(f"  · md  {row['id']} [{row['kind']}] {str(row['title'])[:40]}")
        for target in pending_pdf[:5]:
            print(f"  · pdf {target['doc_id']} {target['title'][:40]} ({target['size']/1024/1024:.1f} MB)")
        print(f"  待清理的陈旧分域 {len(gone)} 个：{gone[:6]}")
        print(f"dry-run 结束（{time.perf_counter()-t0:.1f}s），未写库。")
        conn.close()
        return 0

    if gone:
        for key in gone:
            doc_id, _, source_type = key.partition("|")
            store.delete_docs(conn, [doc_id], source_types=[source_type or "md"])
        print(f"清理已消失/已下线分域 {len(gone)} 个")

    if not pending_md and not pending_pdf:
        store.set_meta(conn, "built_at", dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"))
        conn.commit()
        print("索引已是最新，无需重嵌。")
        print(store.stats(conn))
        conn.close()
        return 0

    config.apply_hf_env()
    from rag.embedder import Embedder  # noqa: PLC0415

    emb = Embedder()
    info = emb.warmup()
    print(f"模型 {info['model']} · {info['device']} · dim={info['dim']} · 载入 {info['load_seconds']}s")

    written = 0
    md_chunks = pdf_chunks = 0
    noise_pages = 0
    scanned: list[str] = []

    for i, row in enumerate(pending_md, 1):
        rows = chunks_for_doc(row)
        if not rows:
            continue
        written += store.upsert_chunks(conn, rows, emb.encode_docs(embedding_payload(rows)))
        md_chunks += len(rows)
        if i % 25 == 0 or i == len(pending_md):
            print(f"  md  进度 {i}/{len(pending_md)}  累计 {written} 块", flush=True)

    for j, target in enumerate(pending_pdf, 1):
        result = pdfmod.chunks_for_pdf(target, chunker=chunker, page_limit=args.pdf_page_limit,
                                       keep_noise=args.keep_noise)
        rows = result["rows"]
        skipped = result["skipped"] or {}
        noise_pages += sum(skipped.values())
        if not rows:
            scanned.append(target["title"][:40])
            print(f"  pdf {j}/{len(pending_pdf)}  {target['title'][:34]} → 无可用正文页（疑似扫描件/全为噪声页，跳过）", flush=True)
            continue
        written += store.upsert_chunks(conn, rows, emb.encode_docs(embedding_payload(rows)))
        pdf_chunks += len(rows)
        detail = f"→ {len(rows)} 块（{rows[-1]['page']} 页）"
        if skipped:
            detail += f"，剔除噪声 页{sum(v for k, v in skipped.items() if k != 'chunk')}/块{skipped.get('chunk', 0)}"
        print(f"  pdf {j}/{len(pending_pdf)}  {target['title'][:34]} {detail}", flush=True)

    store.set_meta(conn, "built_at", dt.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"))
    store.set_meta(conn, "model", config.MODEL_NAME)
    store.set_meta(conn, "source_index", str(config.INDEX_DB.relative_to(config.ROOT)))
    if scanned:
        store.set_meta(conn, "pdf_no_text", "\n".join(scanned))
    conn.commit()
    print(f"\n完成：{written} 块（md {md_chunks} · pdf {pdf_chunks}）/ {time.perf_counter()-t0:.1f}s")
    if noise_pages:
        print(f"剔除目录/参考文献/封面等噪声页与引用块 {noise_pages} 个（如需保留：--keep-noise）")
    if scanned:
        print(f"无文本层（扫描件）{len(scanned)} 篇：" + "；".join(scanned[:3]))
    print(store.stats(conn))
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
