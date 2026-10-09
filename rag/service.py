# -*- coding: utf-8 -*-
"""RAG 服务：本机 HTTP（默认 127.0.0.1:8770），cuda 环境运行，embedding 模型常驻显存。

为什么单独跑一个进程：工作台要保持 stdlib-only + PyInstaller 便携（不能背 torch）；
MCP 进程每次启动都加载模型也不划算。客户端只发 HTTP。

接口（全部 JSON）：
    GET  /health                     服务与模型状态（模型在后台线程加载，不阻塞启动）
    POST /embed   {"texts":[...], "kind":"doc"|"query"}
    POST /search  {"query":..., "topk":8, "use_vector":true, "use_graph":true}
    POST /reindex {"rebuild":false, "limit":0}
    POST /shutdown

启动：python rag/service.py       （用 cuda 环境的解释器，见 run_rag_service.bat）
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from rag import config, search as rag_search, store  # noqa: E402

RUNTIME_FILE = config.LOCAL_DIR / "service.json"


class State:
    """服务状态：模型与向量矩阵常驻内存，重建后热替换。"""

    def __init__(self) -> None:
        self.embedder: Any = None
        self.rows: list[Any] = []
        self.mat: Any = None
        self.model_error: str = ""
        self.model_info: dict[str, Any] = {}
        self.loaded_at: float = 0.0
        self.lock = threading.Lock()

    @property
    def model_ready(self) -> bool:
        return self.embedder is not None and self.mat is not None

    def load_model(self) -> None:
        try:
            config.apply_hf_env()
            from rag.embedder import Embedder  # noqa: PLC0415

            embedder = Embedder()
            info = embedder.warmup()
            with self.lock:
                self.embedder = embedder
                self.model_info = info
                self.model_error = ""
                self.loaded_at = time.time()
        except Exception as exc:  # noqa: BLE001
            self.model_error = f"{type(exc).__name__}: {exc}"
            traceback.print_exc()

    def load_matrix(self) -> None:
        conn = store.connect(read_only=True)
        try:
            rows, mat = rag_search.load_matrix(conn)
        finally:
            conn.close()
        with self.lock:
            self.rows, self.mat = rows, mat


STATE = State()


def _health() -> dict[str, Any]:
    info: dict[str, Any] = {
        "ok": True,
        "pid": os.getpid(),
        "model_ready": STATE.model_ready,
        "model": config.MODEL_NAME,
        "model_error": STATE.model_error,
        "chunks": len(STATE.rows),
        "rag_db": str(config.RAG_DB),
        "index_db": str(config.INDEX_DB),
        "uptime_s": round(time.time() - STARTED_AT, 1),
    }
    info.update({f"embedder_{k}": v for k, v in (STATE.model_info or {}).items()})
    if config.RAG_DB.is_file():
        try:
            conn = store.connect(read_only=True)
            try:
                info["index"] = store.stats(conn)
            finally:
                conn.close()
        except Exception as exc:  # noqa: BLE001
            info["index_error"] = f"{type(exc).__name__}: {exc}"
    return info


def _local_conn() -> Any:
    import sqlite3  # noqa: PLC0415

    conn = sqlite3.connect(f"file:{config.INDEX_DB.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _search(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or "").strip()
    if not query:
        return {"ok": False, "error": "缺少 query"}
    topk = max(1, min(30, int(payload.get("topk") or 8)))
    use_vector = bool(payload.get("use_vector", True)) and STATE.model_ready
    conn_index = _local_conn()
    try:
        conn_rag = store.connect(read_only=True) if use_vector else None
        result = rag_search.hybrid(
            conn_index, conn_rag, STATE.embedder if use_vector else None, query,
            topk=topk,
            use_vector=use_vector,
            use_graph=bool(payload.get("use_graph", True)),
            vector_rows=STATE.rows if use_vector else None,
            vector_mat=STATE.mat if use_vector else None,
        )
    finally:
        conn_index.close()
    result["ok"] = True
    return result


def _reindex(payload: dict[str, Any]) -> dict[str, Any]:
    args = [str(config.ROOT / "rag/build_index.py")]
    if payload.get("rebuild"):
        args.append("--rebuild")
    if payload.get("limit"):
        args.extend(["--limit", str(int(payload["limit"]))])
    proc = subprocess.run([sys.executable, *args], capture_output=True, text=True, cwd=str(config.ROOT))
    STATE.load_matrix()
    tail = (proc.stdout or "").strip().splitlines()[-6:]
    return {"ok": proc.returncode == 0, "exit": proc.returncode, "output": tail,
            "stderr": (proc.stderr or "").strip().splitlines()[-3:], "chunks": len(STATE.rows)}


class Handler(BaseHTTPRequestHandler):
    server_version = "ERWRag/261009"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # 静音默认访问日志
        pass

    def _send(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/health":
            return self._send(_health())
        return self._send({"ok": False, "error": "not found"}, 404)

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            return self._send({"ok": False, "error": f"JSON 解析失败：{exc}"}, 400)
        path = self.path.rstrip("/")
        try:
            if path == "/search":
                return self._send(_search(payload))
            if path == "/embed":
                if not STATE.model_ready:
                    return self._send({"ok": False, "error": "模型尚未就绪", "model_error": STATE.model_error}, 503)
                texts = [str(t) for t in (payload.get("texts") or [])]
                kind = str(payload.get("kind") or "doc")
                vecs = STATE.embedder.encode_query(texts[0]) if kind == "query" else STATE.embedder.encode_docs(texts)
                vectors = [vecs] if kind == "query" else vecs
                return self._send({"ok": True, "dim": len(vectors[0]) if vectors else 0, "vectors": vectors})
            if path == "/reindex":
                return self._send(_reindex(payload))
            if path == "/shutdown":
                self._send({"ok": True, "message": "服务退出"})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
                return
        except Exception as exc:  # noqa: BLE001
            traceback.print_exc()
            return self._send({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, 500)
        return self._send({"ok": False, "error": "not found"}, 404)


STARTED_AT = time.time()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=config.HOST)
    ap.add_argument("--port", type=int, default=config.PORT)
    ap.add_argument("--no-model", action="store_true", help="只做检索代理（不加载模型，仅 FTS+图）")
    args = ap.parse_args()

    config.apply_hf_env()
    if not args.no_model:
        threading.Thread(target=STATE.load_model, daemon=True).start()
    STATE.load_matrix()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    config.LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME_FILE.write_text(
        json.dumps({"pid": os.getpid(), "host": args.host, "port": args.port,
                    "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    "python": sys.executable}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"ERW RAG service on http://{args.host}:{args.port}  (pid {os.getpid()})")
    print(f"  index : {config.INDEX_DB}")
    print(f"  vectors: {config.RAG_DB}  块数 {len(STATE.rows)}")
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        print("\nstopping...")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
