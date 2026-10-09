"""前端冒烟 —— 逐个走查页面路由，断言「能渲染、无报错、接缝在、首屏不拉重库」。

    python tools/ui_smoke.py                      # 默认 http://127.0.0.1:8765
    python tools/ui_smoke.py --base-url http://127.0.0.1:8799 --json
    python tools/ui_smoke.py --strict             # playwright 缺失时也算失败

为什么需要它（docs/REFACTOR_PLAN.md P29）：后端有 `tools/kb_smoke.py`、装配层有
`tools/web_check.py`，但**页面能不能点开**此前没有任何自动闸门——`17682ce` 那次
「一个补丁的语法错误直接打掉整个 PDF 工作区」正是这类事故。本脚本只读 DOM/控制台/网络，
**不截图**（文本优先，见 AGENTS.md：图片 token 只与像素面积相关，能文本判断就别截图）。

断言：
1. 首屏能加载，标题非空，**无 console error、无失败请求**；
2. `web/app.js` 里 `NAV_GROUPS` 声明的**每个路由**都挂得上、点得开、能渲染出内容
   （期望路由从 app.js 本身解析，不另抄一份清单）；
3. 首屏**不请求** mathjax / mermaid（A1 的按需加载是硬约束，回归了要立刻知道）；
4. `window.erwVendor` 按需加载器在；
5. base 依赖的补丁接缝（`window.ERW*`）都真的就位。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_JS = ROOT / "web" / "app.js"

#: 首屏出现即视为「按需加载回归」的重型库
HEAVY_LIBS = ("mathjax", "mermaid")
#: base 硬依赖的补丁接缝（app.js 会消费）
REQUIRED_SEAMS = ("ERWLiterature", "ERWBilling", "ERWFabTimeline", "ERWNav")


def declared_routes() -> list[str]:
    """从 web/app.js 的 NAV_GROUPS 解析路由 id（单一来源，不另抄清单）。"""
    text = APP_JS.read_text(encoding="utf-8")
    m = re.search(r"NAV_GROUPS\s*=\s*\[(.*?)\n\s*\];", text, re.S)
    if not m:
        return []
    out: list[str] = []
    for line in m.group(1).splitlines():
        for route in re.findall(r"\['([a-z0-9-]+)',", line):
            if route not in out:
                out.append(route)
    return out


def find_browser() -> str | None:
    """优先复用机器上已有的浏览器（不强制 `playwright install`）。"""
    import os
    import shutil

    candidates = [
        os.path.expandvars(r"%LOCALAPPDATA%\ms-playwright\chromium-1234\chrome-win64\chrome.exe"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
    ]
    env = os.environ.get("ERW_BROWSER") or os.environ.get("CHROME_PATH")
    if env and Path(env).is_file():
        return env
    for cand in candidates:
        if Path(cand).is_file():
            return cand
    return shutil.which("chrome") or shutil.which("msedge") or shutil.which("google-chrome")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="前端冒烟（只读 DOM/控制台/网络，不截图）")
    ap.add_argument("--base-url", default="http://127.0.0.1:8765")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--strict", action="store_true", help="playwright 缺失时也判失败")
    ap.add_argument("--timeout", type=int, default=30000, help="单次导航超时 ms")
    args = ap.parse_args(argv)

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        msg = "SKIP 未安装 playwright（pip install playwright 即可；浏览器可复用系统已有的 Chrome/Edge）"
        print(json.dumps({"skipped": True, "reason": msg}, ensure_ascii=False) if args.json else msg)
        return 1 if args.strict else 0

    routes = declared_routes()
    fails: list[str] = []
    notes: list[str] = [f"app.js 声明 {len(routes)} 个路由"]

    with sync_playwright() as p:
        exe = find_browser()
        launch_kwargs = {"headless": True}
        if exe:
            launch_kwargs["executable_path"] = exe
            notes.append(f"浏览器：{exe}")
        else:
            notes.append("浏览器：playwright 自带")
        browser = p.chromium.launch(**launch_kwargs)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()

        first_requests: list[str] = []
        console: list[str] = []
        failed_reqs: list[str] = []
        page.on("request", lambda r: first_requests.append(r.url))
        page.on("console", lambda m: console.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        page.on("requestfailed", lambda r: failed_reqs.append(f"{r.url} :: {r.failure}"))

        page.goto(args.base_url + "/", wait_until="networkidle", timeout=args.timeout)
        page.wait_for_timeout(800)
        title = page.title()

        if not title.strip():
            fails.append("首页标题为空（页面没渲染出来）")
        heavy = [u for u in first_requests if any(h in u.lower() for h in HEAVY_LIBS)]
        if heavy:
            fails.append(f"首屏请求了重型库（按需加载回归）：{heavy}")
        seams_present = page.evaluate(
            "() => Object.fromEntries("
            + json.dumps(list(REQUIRED_SEAMS))
            + ".map(n => [n, typeof window[n] !== 'undefined']))"
        )
        missing_seams = [n for n, ok in seams_present.items() if not ok]
        if missing_seams:
            fails.append(f"补丁接缝缺失：{missing_seams}")
        if not page.evaluate("() => !!window.erwVendor && typeof window.erwVendor.load === 'function'"):
            fails.append("window.erwVendor 按需加载器缺失")

        rendered: dict[str, str] = {}
        for route in routes:
            before = len(console)
            try:
                page.goto(f"{args.base_url}/#{route}", wait_until="domcontentloaded", timeout=args.timeout)
                page.wait_for_timeout(600)
                info = page.evaluate(
                    """() => {
                        const main = document.querySelector('#main');
                        const active = document.querySelector('.nav-item.active');
                        return {
                          len: main ? main.innerText.trim().length : 0,
                          active: active ? (active.dataset.route || '') : '',
                          heading: (document.querySelector('#page-title') || {}).textContent || '',
                        };
                    }"""
                )
            except Exception as exc:  # 路由渲染异常不该中断整轮
                fails.append(f"路由 {route} 打开失败：{exc}")
                continue
            rendered[route] = info["heading"] or route
            if info["len"] < 20:
                fails.append(f"路由 {route} 渲染内容过少（{info['len']} 字符）")
            if info["active"] and info["active"] != route:
                fails.append(f"路由 {route} 高亮错位到 {info['active']}")
            new_errors = console[before:]
            if new_errors:
                fails.append(f"路由 {route} 有 console error：{new_errors[:2]}")

        if console:
            fails.append(f"console 出现 {len(console)} 条 error：{console[:3]}")
        if failed_reqs:
            fails.append(f"{len(failed_reqs)} 个请求失败：{failed_reqs[:3]}")

        browser.close()

    report = {
        "base_url": args.base_url,
        "title": title,
        "routes_checked": len(routes),
        "route_headings": rendered,
        "heavy_libs_on_first_screen": heavy,
        "console_errors": console,
        "failed_requests": failed_reqs,
        "fails": fails,
        "notes": notes,
    }
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        for n in notes:
            print(f"  - {n}")
        print(f"  页面标题：{title}")
        for route, heading in rendered.items():
            print(f"  ok  #{route:<18} {heading}")
        if fails:
            print(f"\n发现 {len(fails)} 个问题：")
            for f in fails:
                print(f"  [x] {f}")
        else:
            print(f"\n前端冒烟通过：首屏干净、{len(routes)} 个路由全部可渲染、接缝齐备、首屏未拉重型库")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
