# -*- coding: utf-8 -*-
"""RAG 客户端（stdlib only）：MCP 工具与工作台内置 Agent 共用。

行为约定：
1. 首选本机 RAG 服务（127.0.0.1:8770）→ 三路融合检索；
2. 服务不可达时可自动拉起（可在参数里关闭），等待模型就绪；
3. 仍不可用则**降级为本地 FTS + 图**（不需要模型），并在 caveats 里明确说明降级。
"""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rag import config  # noqa: E402

RUNTIME_FILE = config.LOCAL_DIR / "service.json"
LOG_FILE = config.LOG_DIR / "service.log"
CONDA_ENV = "cuda"


# ----------------------------------------------------------------- 工具函数
def service_url() -> str:
    host, port = config.HOST, config.PORT
    try:
        data = json.loads(RUNTIME_FILE.read_text(encoding="utf-8"))
        host = str(data.get("host") or host)
        port = int(data.get("port") or port)
    except Exception:  # noqa: BLE001
        pass
    return f"http://{host}:{port}"


def _post(path: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        service_url() + path, data=body, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def health(timeout: float = 3.0) -> dict[str, Any] | None:
    try:
        with urllib.request.urlopen(service_url() + "/health", timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:  # noqa: BLE001
        return None


def find_python() -> str:
    """找 cuda 环境的解释器；找不到就退回当前解释器（可能没有 torch）。"""
    override = os.environ.get("ERW_RAG_PYTHON")
    if override and Path(override).is_file():
        return override
    candidates = [
        Path(os.environ.get("USERPROFILE", "")) / f".conda/envs/{CONDA_ENV}/python.exe",
        Path("C:/ProgramData/miniforge3") / f"envs/{CONDA_ENV}/python.exe",
        Path("D:/Software/Miniforge") / f"envs/{CONDA_ENV}/python.exe",
    ]
    for path in candidates:
        if path.is_file():
            return str(path)
    return sys.executable


def ensure_service(wait_seconds: float = 90.0, auto_start: bool = True) -> dict[str, Any]:
    """确保服务可用并等模型就绪。返回 {"ready": bool, "started": bool, "detail": str}。"""
    info = health()
    if info and info.get("model_ready"):
        return {"ready": True, "started": False, "detail": "服务在线"}
    if info and not info.get("model_ready"):
        deadline = time.time() + wait_seconds
        while time.time() < deadline:
            time.sleep(2)
            info = health()
            if info and info.get("model_ready"):
                return {"ready": True, "started": False, "detail": "服务在线（模型已就绪）"}
            if info and info.get("model_error"):
                return {"ready": False, "started": False, "detail": f"模型加载失败：{info['model_error']}"}
        return {"ready": False, "started": False, "detail": "等待模型就绪超时"}
    if not auto_start:
        return {"ready": False, "started": False, "detail": "服务未启动（auto_start=False）"}

    config.LOG_DIR.mkdir(parents=True, exist_ok=True)
    python = find_python()
    creation = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
    with LOG_FILE.open("a", encoding="utf-8") as log:
        log.write(f"\n--- start {time.strftime('%Y-%m-%dT%H:%M:%S')} · {python}\n")
        subprocess.Popen(
            [python, str(ROOT / "rag/service.py")],
            cwd=str(ROOT), stdout=log, stderr=log, creationflags=creation, close_fds=True,
        )
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        time.sleep(2)
        info = health()
        if info and info.get("model_ready"):
            return {"ready": True, "started": True, "detail": f"已拉起服务（{python}）"}
        if info and info.get("model_error"):
            return {"ready": False, "started": True, "detail": f"模型加载失败：{info['model_error']}"}
    return {"ready": False, "started": True, "detail": "服务已拉起但模型未就绪（超时）"}


# --------------------------------------------------------------- 本地降级
def local_retrieve(query: str, topk: int = 8) -> dict[str, Any]:
    """降级路径：只用工作台 FTS + 图扩展（stdlib，不需要模型与向量库）。"""
    from rag import search as rag_search  # noqa: PLC0415

    conn = sqlite3.connect(f"file:{config.INDEX_DB.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        fts = rag_search.fts_rank(conn, query, limit=max(20, topk * 3))
        related = rag_search.graph_expand(conn, fts[:8]) if fts else {}
        sources = []
        for doc_id in fts[:topk]:
            row = conn.execute(
                "SELECT id,title,kind,status,excerpt FROM documents WHERE id=?", (doc_id,)
            ).fetchone()
            if not row:
                continue
            sources.append({
                "doc_id": str(row["id"]), "title": str(row["title"]), "kind": str(row["kind"]),
                "status": str(row["status"]),
                "snippet": str(row["excerpt"] or "")[:240],
                "score": None, "in_fts": True, "in_vector": False,
                "in_graph": doc_id in related,
            })
        return {
            "ok": True, "query": query, "sources": sources,
            "confidence": "medium" if sources else "none",
            "caveats": ["RAG 服务不可用，已降级为本地 FTS + 图（结果按 bm25，无向量语义召回）。"],
            "related": [{"doc_id": d, "score": round(s, 3)} for d, s in
                        sorted(related.items(), key=lambda kv: -kv[1])[:5]],
            "legs": {"fts": len(fts), "graph": len(related)}, "degraded": True,
        }
    finally:
        conn.close()


# ------------------------------------------------------------------ 主入口
def retrieve(query: str, topk: int = 8, *, use_vector: bool = True, use_graph: bool = True,
             auto_start: bool = True, wait_seconds: float = 90.0) -> dict[str, Any]:
    """检索入口：优先服务，失败降级。返回结构与 rag.search.hybrid 一致。"""
    query = str(query or "").strip()
    if not query:
        return {"ok": False, "error": "缺少 query", "sources": [], "confidence": "none"}
    if use_vector:
        status = ensure_service(wait_seconds=wait_seconds, auto_start=auto_start)
        if status["ready"]:
            try:
                result = _post("/search", {"query": query, "topk": topk,
                                           "use_vector": True, "use_graph": use_graph},
                               timeout=config.CLIENT_TIMEOUT)
                result.setdefault("caveats", [])
                result["degraded"] = False
                result["service"] = status["detail"]
                return result
            except Exception as exc:  # noqa: BLE001
                fallback = local_retrieve(query, topk=topk)
                fallback["caveats"].append(f"服务调用失败（{type(exc).__name__}: {exc}），已降级。")
                return fallback
        fallback = local_retrieve(query, topk=topk)
        fallback["caveats"].append(f"RAG 服务未就绪：{status['detail']}；已降级为本地 FTS + 图。")
        return fallback
    return local_retrieve(query, topk=topk)


if __name__ == "__main__":
    # 手工验证：python rag/client.py "查询词"
    import argparse  # noqa: PLC0415

    ap = argparse.ArgumentParser()
    ap.add_argument("query", nargs="?", default="卡尔曼滤波 状态估计")
    ap.add_argument("--topk", type=int, default=8)
    ap.add_argument("--no-auto-start", action="store_true")
    args = ap.parse_args()
    out = retrieve(args.query, topk=args.topk, auto_start=not args.no_auto_start)
    print(json.dumps(out, ensure_ascii=False, indent=2)[:4000])
