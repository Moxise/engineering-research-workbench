# -*- coding: utf-8 -*-
"""rag.sqlite：向量索引的 schema 与读写（派生数据，可一键重建）。

设计要点：
- 与工作台索引物理隔离：只读 index.sqlite，所有 RAG 数据写在 rag.sqlite；
- 向量以 float32 BLOB 存（512 维 = 2 KB/块，全库约 1 MB 级），检索时内存全扫即可；
- 增量指纹用 documents.updated + mtime_ns，变更条目才重嵌。
"""
from __future__ import annotations

import array
import sqlite3
import time
from pathlib import Path
from typing import Any, Iterable, Iterator, Sequence

from . import config

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS chunks (
  chunk_id     TEXT PRIMARY KEY,
  doc_id       TEXT NOT NULL,
  source_type  TEXT NOT NULL DEFAULT 'md',
  seq          INTEGER NOT NULL DEFAULT 0,
  title        TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT '',
  path         TEXT NOT NULL DEFAULT '',
  page         INTEGER,
  text         TEXT NOT NULL,
  char_len     INTEGER NOT NULL DEFAULT 0,
  doc_updated  TEXT NOT NULL DEFAULT '',
  mtime_ns     INTEGER NOT NULL DEFAULT 0,
  dim          INTEGER NOT NULL DEFAULT 0,
  vec          BLOB,
  embedded_at  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_chunks_src ON chunks(source_type);
"""


def connect(db_path: Path | str | None = None, *, read_only: bool = False) -> sqlite3.Connection:
    path = Path(db_path or config.RAG_DB)
    if read_only:
        conn = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    set_meta(conn, "schema_version", str(SCHEMA_VERSION))
    conn.commit()


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )


def get_meta(conn: sqlite3.Connection, key: str, default: str = "") -> str:
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return str(row["value"]) if row else default


def pack(vec: Sequence[float]) -> bytes:
    return array.array("f", [float(x) for x in vec]).tobytes()


def unpack(blob: bytes) -> array.array:
    out = array.array("f")
    out.frombytes(blob)
    return out


def chunk_fingerprints(conn: sqlite3.Connection) -> dict[str, tuple[str, int]]:
    """已入库切块的增量指纹：`<doc_id>|<source_type>` -> (doc_updated, mtime_ns)。

    必须按 source_type 分域：同一条文献条目既有 md 正文块，又有 PDF 全文块，
    混在一起取 MAX 会让两侧指纹互相干扰、导致每次都要重嵌或漏嵌。
    """
    rows = conn.execute(
        "SELECT doc_id, source_type, MAX(doc_updated) AS u, MAX(mtime_ns) AS m "
        "FROM chunks GROUP BY doc_id, source_type"
    ).fetchall()
    return {
        f"{r['doc_id']}|{r['source_type']}": (str(r["u"] or ""), int(r["m"] or 0))
        for r in rows
    }


def delete_docs(conn: sqlite3.Connection, doc_ids: Iterable[str],
                source_types: Sequence[str] | None = None) -> int:
    ids = list(doc_ids)
    if not ids:
        return 0
    removed = 0
    extra = ""
    tail: list[Any] = []
    if source_types:
        extra = f" AND source_type IN ({','.join('?' * len(source_types))})"
        tail = list(source_types)
    for i in range(0, len(ids), 200):
        batch = ids[i : i + 200]
        marks = ",".join("?" * len(batch))
        removed += conn.execute(
            f"DELETE FROM chunks WHERE doc_id IN ({marks}){extra}", [*batch, *tail]
        ).rowcount
    conn.commit()
    return removed


def upsert_chunks(
    conn: sqlite3.Connection,
    rows: Sequence[dict[str, Any]],
    vectors: Sequence[Sequence[float]],
) -> int:
    """写入块与向量（同一 (doc, source_type) 的旧块先清掉，保证不残留过期块）。"""
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    pairs = sorted({(str(r["doc_id"]), str(r.get("source_type") or "md")) for r in rows})
    for doc_id, source_type in pairs:
        conn.execute("DELETE FROM chunks WHERE doc_id=? AND source_type=?", (doc_id, source_type))
    payload = [
        (
            str(r["chunk_id"]), str(r["doc_id"]), str(r.get("source_type") or "md"),
            int(r.get("seq") or 0), str(r.get("title") or ""), str(r.get("kind") or ""),
            str(r.get("status") or ""), str(r.get("path") or ""), r.get("page"),
            str(r["text"]), len(str(r["text"])), str(r.get("doc_updated") or ""),
            int(r.get("mtime_ns") or 0), len(vec), pack(vec), now,
        )
        for r, vec in zip(rows, vectors)
    ]
    conn.executemany(
        "INSERT OR REPLACE INTO chunks("
        "chunk_id,doc_id,source_type,seq,title,kind,status,path,page,text,char_len,"
        "doc_updated,mtime_ns,dim,vec,embedded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        payload,
    )
    conn.commit()
    return len(payload)


def iter_chunks(conn: sqlite3.Connection, *, with_vec: bool = True) -> Iterator[sqlite3.Row]:
    cols = "*" if with_vec else "chunk_id,doc_id,source_type,seq,title,kind,status,path,page,text,char_len"
    yield from conn.execute(f"SELECT {cols} FROM chunks ORDER BY doc_id, seq")


def stats(conn: sqlite3.Connection) -> dict[str, Any]:
    row = conn.execute(
        "SELECT COUNT(*) AS chunks, COUNT(DISTINCT doc_id) AS docs, "
        "SUM(char_len) AS chars, SUM(CASE WHEN vec IS NULL THEN 1 ELSE 0 END) AS missing_vec "
        "FROM chunks"
    ).fetchone()
    by_kind = {
        str(r["kind"] or "(空)"): int(r["n"])
        for r in conn.execute("SELECT kind, COUNT(*) AS n FROM chunks GROUP BY kind ORDER BY n DESC")
    }
    return {
        "chunks": int(row["chunks"] or 0),
        "docs": int(row["docs"] or 0),
        "chars": int(row["chars"] or 0),
        "missing_vec": int(row["missing_vec"] or 0),
        "by_kind": by_kind,
        "schema_version": get_meta(conn, "schema_version", "?"),
        "built_at": get_meta(conn, "built_at", ""),
    }
