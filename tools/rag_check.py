# -*- coding: utf-8 -*-
"""交付自检：v261009 三批交付（临时空间 / 文献中文渲染 / kb 检索升级）逐项实测。

与 `tools/kb_smoke.py` 的分工：kb_smoke 测工作台知识库数据结构与命名规范；
本脚本测**本轮交付面**——.scratch 空间、PDF 中文渲染配置、FTS 中文检索、RAG 服务与
工具注册、界面入口、文档留痕、入库边界。只读 + 只发本机 HTTP 请求，不改任何数据。

用法：
    python tools/rag_check.py            # 全量核查
    python tools/rag_check.py --quiet    # 只打印汇总与失败项

前置：工作台在 8765 运行（缺省时相关项会 FAIL 并说明）；RAG 服务在 8770（未启动时该项 FAIL）。
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.stdout.reconfigure(encoding="utf-8")

OK: list[str] = []
BAD: list[str] = []
QUIET = False


def check(name: str, cond: bool, detail: str = "") -> None:
    (OK if cond else BAD).append(name)
    if not QUIET or not cond:
        print(("  PASS " if cond else "  FAIL ") + name + (f"  · {detail}" if detail else ""))


def section(title: str) -> None:
    if not QUIET:
        print("\n" + "=" * 74 + f"\n{title}\n" + "=" * 74)


def run(argv: list[str], timeout: int = 240) -> subprocess.CompletedProcess:
    """统一按 UTF-8 解码子进程输出（Windows 默认 GBK 会把中文输出变乱码导致误判）。"""
    return subprocess.run(argv, cwd=ROOT, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True,
                          encoding="utf-8", errors="replace").stdout


def http_json(url: str, timeout: float = 30.0) -> object:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    global QUIET
    ap = argparse.ArgumentParser()
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    QUIET = args.quiet

    # ---------------------------------------------------------------- A. .scratch
    section("A. 操作临时数据空间 .scratch")
    sp = ROOT / ".scratch"
    check(".scratch 与四个骨架子目录存在",
          sp.is_dir() and all((sp / d).is_dir() for d in ("tmp", "verify", "preview", "logs")))
    check(".scratch/README.md 存在", (sp / "README.md").is_file())
    gi = (ROOT / ".gitignore").read_text(encoding="utf-8")
    gi_lines = [ln.strip() for ln in gi.splitlines()]
    check(".gitignore 有 /.scratch/ 规则", "/.scratch/" in gi_lines)
    check(".gitignore 有临时产物基名约定",
          all(p in gi for p in ("_verify_*", "_preview_*", "_timing_*")))
    check("git 确认 .scratch 未被跟踪",
          not [ln for ln in git("status", "--porcelain").splitlines() if ".scratch" in ln])
    clean = run([sys.executable, str(ROOT / "tools/scratch_clean.py"), "--dry-run"])
    first = (clean.stdout or clean.stderr).strip().splitlines()[:1] or [""]
    check("一键清理脚本可运行", clean.returncode == 0, first[0][:60])
    server_src = (ROOT / "server.py").read_text(encoding="utf-8")
    check("启动自动清理已接入 server.py",
          "_scratch_boot_cleanup" in server_src and "from app import scratch" in server_src)

    # ------------------------------------------------- B. 文献 PDF 中文渲染
    section("B. 文献 PDF 中文渲染修复")
    lit = (ROOT / "web/literature.js").read_text(encoding="utf-8")
    html_head = (ROOT / "web/index.html").read_text(encoding="utf-8")
    check("literature.js 配置 cmaps/standard_fonts",
          all(k in lit for k in ("cMapUrl", "cMapPacked:true", "standardFontDataUrl")))
    check("PDF.js 版本仅一处硬编码", lit.count("pdfjs-dist@3.11.174") == 1)
    # 版本号每次发版都会变，故只断言「带版本参数」而非具体版本（避免自检随发版失效）
    check("index.html 以版本参数引用 literature.js",
          re.search(r"literature\.js\?v=", html_head) is not None)
    check("pdf.js 已本地化（断网可用，CDN 仅作回退）",
          (ROOT / "web/vendor/pdfjs/build/pdf.min.js").is_file()
          and "/vendor/pdfjs" in lit and "PDFJS_CDN" in lit)
    try:
        served = urllib.request.urlopen("http://127.0.0.1:8765/literature.js", timeout=10).read().decode()
        check("运行中服务已提供修复版 literature.js", "cMapUrl" in served and "/vendor/pdfjs" in served)
    except Exception as exc:  # noqa: BLE001
        check("运行中服务已提供修复版 literature.js", False, str(exc)[:60])

    # ------------------------------------------------------- C. FTS 中文检索
    section("C. 工作台 FTS 中文检索修复（M1）")
    check("app/kb_segment.py 存在", (ROOT / "app/kb_segment.py").is_file())
    from app import kb_segment as ks  # noqa: PLC0415

    sample = ks.segment("本项目采用CW相对运动模型")
    check("bigram 分词正确", sample.startswith("本项 项目 目采") and " cw " in f" {sample} ", sample[:36])
    db = ROOT / "Workspace/System/Cache/index.sqlite"
    conn = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    fts_sql = str(conn.execute("SELECT sql FROM sqlite_master WHERE name='documents_fts'").fetchone()[0])
    docs = conn.execute("SELECT count(*) FROM documents").fetchone()[0]
    fts_rows = conn.execute("SELECT count(*) FROM documents_fts").fetchone()[0]
    flag = conn.execute("SELECT value FROM meta WHERE key='fts_backfill_pending'").fetchone()
    check("FTS 表为 unicode61 + seg 列",
          "unicode61" in fts_sql and ", seg," in fts_sql and "trigram" not in fts_sql)
    check("文档与 FTS 行数一致", docs == fts_rows and docs > 0, f"{docs}/{fts_rows}")
    check("回填标志已清除", not flag or str(flag[0]) == "0")
    short = conn.execute("SELECT count(*) FROM documents_fts WHERE documents_fts MATCH ?",
                         (ks.match_expression("质心"),)).fetchone()[0]
    check("2 字词可经 MATCH 命中（旧 trigram 恒 0）", short > 0, f"质心 → {short} 条")
    conn.close()
    try:
        hits = http_json("http://127.0.0.1:8765/api/search?q=" + urllib.parse.quote("卡尔曼滤波 状态估计"))
        check("线上多词查询有命中（修复前 0）", isinstance(hits, list) and len(hits) > 0,
              f"{len(hits) if isinstance(hits, list) else '?'} 条")
    except Exception as exc:  # noqa: BLE001
        check("线上多词查询有命中（修复前 0）", False, str(exc)[:60])
    smoke = run([sys.executable, str(ROOT / "tools/kb_smoke.py")])
    tail = (smoke.stdout or "").strip().splitlines()[-1:] or [""]
    check("项目自带冒烟测试全通过", smoke.returncode == 0 and "全部通过" in tail[0], tail[0][:56])

    # ------------------------------------------------------------ D. RAG
    section("D. RAG 检索层（M2/M3/M4）")
    try:
        health = http_json("http://127.0.0.1:8770/health")
        check("RAG 服务在线且模型就绪", bool(health.get("model_ready")),
              f"chunks={health.get('chunks')} device={health.get('embedder_device')}")
    except Exception as exc:  # noqa: BLE001
        check("RAG 服务在线且模型就绪", False, f"{str(exc)[:50]}（run_rag_service.bat 可启动）")
    rag_db = ROOT / "Workspace/System/Cache/rag.sqlite"
    if rag_db.is_file():
        c = sqlite3.connect(f"file:{rag_db.as_posix()}?mode=ro", uri=True)
        by = dict(c.execute("SELECT source_type, count(*) FROM chunks GROUP BY 1").fetchall())
        c.close()
        check("向量库含 md 与 PDF 全文两类分域",
              by.get("md", 0) > 0 and by.get("pdf", 0) > 0, str(by))
    else:
        check("向量库存在", False, "先跑 rag/build_index.py")
    check("评测报告已落盘（≥4 份）", len(list((ROOT / "rag/eval").glob("report-*.md"))) >= 4,
          f"{len(list((ROOT / 'rag/eval').glob('report-*.md')))} 份")
    check("评测集与阈值文件存在",
          (ROOT / "rag/eval/queries.jsonl").is_file() and (ROOT / "rag/eval/threshold.json").is_file())
    try:
        r = http_json("http://127.0.0.1:8765/api/rag/search?q="
                      + urllib.parse.quote("星点提取的阈值怎么定") + "&topk=4")
        pdf_hits = [s for s in r.get("sources", []) if s.get("source_type") == "pdf"]
        check("接口可检索到 PDF 片段且带页码",
              bool(pdf_hits) and any(s.get("page") for s in pdf_hits),
              f"{len(pdf_hits)} 个 PDF 片段，页码 {[s.get('page') for s in pdf_hits][:3]}")
        st = http_json("http://127.0.0.1:8765/api/rag/status")
        check("RAG 状态接口可用", bool(st.get("service")), f"chunks={st.get('chunks')}")
    except Exception as exc:  # noqa: BLE001
        check("RAG 接口可用（/api/rag/search 与 /status）", False, str(exc)[:60])
    try:
        import mcp.server as mcp_server  # noqa: PLC0415

        names = [t["name"] for t in mcp_server.ALL_TOOLS]
        check("MCP 侧注册 kb_retrieve", "kb_retrieve" in names and "kb_retrieve" in mcp_server.HANDLERS,
              f"共 {len(names)} 个工具")
    except Exception as exc:  # noqa: BLE001
        check("MCP 侧注册 kb_retrieve", False, str(exc)[:60])
    try:
        raw = urllib.request.urlopen("http://127.0.0.1:8765/api/agent/tools", timeout=10).read().decode()
        check("工作台内置 Agent 侧注册 kb_retrieve", "kb_retrieve" in raw)
    except Exception as exc:  # noqa: BLE001
        check("工作台内置 Agent 侧注册 kb_retrieve", False, str(exc)[:60])
    try:
        from rag.client import retrieve  # noqa: PLC0415

        deg = retrieve("FIM 可观性分析", topk=3, use_vector=False)
        check("服务不可用时降级为 FTS+图并标注",
              bool(deg.get("sources")) and bool(deg.get("degraded")),
              f"{len(deg.get('sources') or [])} 条")
    except Exception as exc:  # noqa: BLE001
        check("服务不可用时降级为 FTS+图并标注", False, str(exc)[:60])

    # ------------------------------------------------------------ E. 界面入口
    section("E. 界面入口")
    appjs = (ROOT / "web/app.js").read_text(encoding="utf-8")
    check("app.js 含语义检索分区与 PDF 跳转",
          all(k in appjs for k in ("function ragSection", "function ragResultRow", "async function openRagHit")))
    check("app.js 含 ?q= 与 ?paper=&page= 深链",
          "get('q')" in appjs and "get('paper')" in appjs and "openAt" in appjs)
    check("app.js 的 PDF 命中带页码跳转", "ERWLiterature?.openAt" in appjs and "s.page||1" in appjs)
    check("新增样式表存在", (ROOT / "web/v261009-rag.css").is_file())
    html = (ROOT / "web/index.html").read_text(encoding="utf-8")
    check("index.html 引用新样式与 app.js 版本参数",
          "v261009-rag.css" in html and re.search(r"app\.js\?v=", html) is not None)
    try:
        served_js = urllib.request.urlopen("http://127.0.0.1:8765/app.js", timeout=10).read().decode()
        css = urllib.request.urlopen("http://127.0.0.1:8765/v261009-rag.css", timeout=10)
        check("运行中服务已提供新界面代码与样式",
              "ragSection" in served_js and css.status == 200, f"CSS {css.status}")
    except Exception as exc:  # noqa: BLE001
        check("运行中服务已提供新界面代码与样式", False, str(exc)[:60])

    # ------------------------------------------------------------ F. 文档留痕
    section("F. 文档与留痕")
    chg = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    check("CHANGELOG 含 v261009.1 与 v261009.2",
          "## v261009.1" in chg and "## v261009.2" in chg)
    plan = ROOT / "docs/kb-RAG可行版方案.md"
    check("方案文档存在且含追加执行章节",
          plan.is_file() and "## 10. 追加执行" in plan.read_text(encoding="utf-8"))
    rag_readme = ROOT / "rag/README.md"
    check("rag/README.md 含设计取舍与边界",
          rag_readme.is_file() and "关键设计取舍" in rag_readme.read_text(encoding="utf-8")
          and "已知边界" in rag_readme.read_text(encoding="utf-8"))

    # ------------------------------------------------------------ G. 入库边界
    section("G. 入库边界")
    ignored = git("check-ignore", "-v", "--", "rag/search.py", "run_rag_service.bat", "web/v261009-rag.css")
    # check-ignore 对「命中取反规则（!）」的路径也会打印，格式为 <来源>:<行号>:<模式>\t<路径>；
    # 模式列以 ! 开头即表示「已被放行、不忽略」。三个路径都必须是取反命中。
    ignored_lines = [ln for ln in ignored.splitlines() if ln.strip()]
    check("rag/ 与新增文件已放行（可提交）",
          len(ignored_lines) == 3 and all("!" in ln.split("\t")[0] for ln in ignored_lines),
          " | ".join(ln.split("\t")[0] for ln in ignored_lines)[:72] or "未被忽略")
    status = git("status", "--porcelain")
    check("git 状态可见 rag/ 与新增界面文件", "rag/" in status and "v261009-rag.css" in status)
    check(".gitignore 显式声明 /.rag/ 规则行", "/.rag/" in gi_lines)
    check("模型权重目录 .rag/ 被忽略", bool(git("check-ignore", "-v", "--", ".rag/models").strip()))

    # --------------------------------------------------------------- 汇总
    print("\n" + "=" * 74)
    print(f"结果：PASS {len(OK)} 项 · FAIL {len(BAD)} 项")
    if BAD:
        print("失败项：" + "；".join(BAD))
    print("=" * 74)
    print("非缺陷的已知边界：M5 生成层未做（无本地 LLM）；PDF 正文只在「语义检索」分区；"
          "跨语言检索偏弱（可换 bge-m3）；打包 exe 需重跑 build_client.bat 才带上 web/ 与 rag/ 改动。")
    return 1 if BAD else 0


if __name__ == "__main__":
    raise SystemExit(main())
