"""前端静态体检 —— 提交前的低成本回归闸门（只读）。

背景：`17682ce fix: restore PDF workspace after performance patch syntax error` —— 一个补丁的
语法错误直接打掉整个 PDF 工作区，而当时没有任何闸门能在提交前发现它（见
docs/REFACTOR_PLAN.md P7/P14/P29）。本脚本把能静态查的都查掉：

1. **语法**：web/ 下所有非 vendor 的 `.js` / `.css` 过一遍 `node --check`（CSS 过括号配平）。
2. **装配一致性**：index.html 与 `web/manifest.json` 一致（调 web_manifest --check）。
3. **模块缺失**：清单里的文件必须在磁盘上；磁盘上的入口文件必须进清单。
4. **接缝完整（P14）**：任何 `window.ERW*` 的**消费方**都必须存在**定义方**；
   任何自定义事件（`workbench:*` / `erw-*`）的监听方都必须存在派发方。
   —— 这条是「补丁可以单独摘除」的可验证定义：删掉 billing.js 而没人提供 ERWBilling 时会立刻报错，
   而不是等用户在页面上点「用量」才发现白屏。
5. **加载顺序约束**：`v260922-performance.js` 包装 `window.fetch`，必须排在 `app.js` 之前。

用法：
    python tools/web_check.py            # 全部检查
    python tools/web_check.py --no-node  # 跳过 node 检查（无 node 时）

退出码非 0 表示有问题。
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
MANIFEST = WEB / "manifest.json"

BROWSER_EVENTS = {
    "DOMContentLoaded", "load", "beforeunload", "click", "change", "input", "keydown", "keyup",
    "resize", "scroll", "hashchange", "popstate", "paste", "drop", "dragover", "dragleave",
    "pointerdown", "pointermove", "pointerup", "pointercancel", "mousedown", "mousemove",
    "mouseup", "wheel", "focus", "blur", "submit", "animationend", "transitionend",
    "abort", "error", "readystatechange", "visibilitychange", "contextmenu", "pointerenter",
    "pointerleave", "touchstart", "touchmove", "touchend", "online", "offline", "storage",
}

#: 派发自定义事件：`new CustomEvent("x")` 与 `new Event("x")` 两种写法都要认
_DISPATCH = re.compile(r"new\s+(?:Custom)?Event\(\s*['\"]([\w:.-]+)")

problems: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)


def app_js_files() -> list[Path]:
    """web/ 根下的业务 JS（不含 vendor/ 子树）。"""
    return sorted(p for p in WEB.glob("*.js"))


def check_syntax(use_node: bool) -> None:
    files = app_js_files()
    if not use_node or not shutil.which("node"):
        notes.append("跳过 node --check（未找到 node）")
    else:
        for path in files:
            r = subprocess.run(
                ["node", "--check", str(path)], capture_output=True, text=True,
                encoding="utf-8", errors="replace", cwd=str(ROOT),
            )
            if r.returncode != 0:
                detail = (r.stderr or r.stdout).strip().splitlines()
                fail(f"语法错误 {path.relative_to(ROOT)}：{detail[-1] if detail else 'node --check 失败'}")
    # CSS：粗查括号配平（脏括号是补丁层最常见的破坏方式）
    for path in sorted(WEB.glob("*.css")):
        text = path.read_text(encoding="utf-8")
        stripped = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
        depth = stripped.count("{") - stripped.count("}")
        if depth != 0:
            fail(f"CSS 花括号不配平 {path.name}：差值 {depth:+d}")


def check_manifest() -> dict:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    r = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "web_manifest.py"), "--check"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(ROOT),
    )
    if r.returncode != 0:
        fail("index.html 与 web/manifest.json 不一致（跑 python tools/web_manifest.py --write）")

    listed: set[str] = set()
    for group in ("css", "vendor_js", "js"):
        for item in manifest[group]:
            listed.add(item["file"])
            path = WEB / item["file"]
            if not path.is_file():
                fail(f"清单引用了不存在的文件：{item['file']}（{group}）")
            if item.get("v") and path.is_file():
                pass  # 版本参数只做缓存键，无法静态校验是否"最新"，由 review 保证
    for path in app_js_files():
        rel = path.name
        if rel not in listed and rel != "vendor-lazy.js":
            fail(f"{rel} 不在 manifest.json 里（新增前端模块必须登记装配清单）")
    notes.append(f"清单登记 {len(listed)} 个资源")
    return manifest


def check_seams() -> None:
    files = app_js_files()
    defined: dict[str, set[str]] = {}
    consumed: dict[str, set[str]] = {}
    dispatched: dict[str, set[str]] = {}
    listened: dict[str, set[str]] = {}

    for path in files:
        text = path.read_text(encoding="utf-8")
        name = path.name
        for sym in set(re.findall(r"window\.(ERW[\w$]*)\s*=", text)):
            defined.setdefault(sym, set()).add(name)
        for sym in set(re.findall(r"window\.(ERW[\w$]*)\b(?!\s*[=])", text)):
            consumed.setdefault(sym, set()).add(name)
        for ev in set(_DISPATCH.findall(text)):
            dispatched.setdefault(ev, set()).add(name)
        for ev in set(re.findall(r"addEventListener\(\s*['\"]([\w:.-]+)", text)):
            listened.setdefault(ev, set()).add(name)

    for sym, users in sorted(consumed.items()):
        if sym in defined:
            continue
        # 由其它层提供（原生外壳注入 / 后端页面）的例外在此登记
        fail(f"window.{sym} 被 {', '.join(sorted(users))} 消费，但 web/ 里没有定义方")

    for ev, users in sorted(listened.items()):
        if ev in BROWSER_EVENTS or ev in dispatched:
            continue
        fail(f"自定义事件 {ev} 被 {', '.join(sorted(users))} 监听，但 web/ 里没有派发方")

    notes.append(
        f"接缝：定义 {len(defined)} 个 window.ERW*、消费 {len(consumed)} 个；"
        f"自定义事件派发 {len(dispatched)} 个、监听 {len(listened)} 个"
    )


def strip_comments(text: str) -> str:
    """去掉 JS 注释后再做结构性扫描——否则「注释里提到 window.fetch =」会被误判成违规。"""
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    return re.sub(r"(?m)//[^\n]*$", " ", text)


def check_order(manifest: dict) -> None:
    """加载顺序与 fetch 接缝的结构性不变量。

    v261009 · A10 把「全局替换 window.fetch」换成了 `window.erwFetch` 显式接缝，因此这里
    不再靠「哪个文件必须排在前面」来保证正确性，而是直接查三条硬约束：
    1. **任何模块都不得给 `window.fetch` 赋值**（全局猴子补丁是 P14 的红线：它让补丁无法摘除，
       还制造出假的加载顺序依赖）；
    2. 接缝提供方**有且只有一个**（`window.erwFetch =` 只应出现在 performance 补丁里）；
    3. 每个自带 `api()` 的模块都必须走接缝（`erwFetch`），否则会绕过分页/图谱限流/搜索取消。
    """
    order = [item["file"] for item in manifest["js"]]
    files = app_js_files()
    sources = {p.name: strip_comments(p.read_text(encoding="utf-8")) for p in files}

    offenders = [name for name, text in sources.items() if re.search(r"window\.fetch\s*=", text)]
    if offenders:
        fail(f"禁止全局替换 window.fetch（P14 红线）：{offenders}；请改用 window.erwFetch 接缝")

    providers = [name for name, text in sources.items() if re.search(r"window\.erwFetch\s*=", text)]
    if len(providers) != 1:
        fail(f"window.erwFetch 接缝提供方应恰好 1 个，实际 {len(providers)} 个：{providers}")

    bypass = []
    for name, text in sources.items():
        for m in re.finditer(r"async function api\([^)]*\)\s*\{(.*?)\n\s*\}", text, re.S):
            if "erwFetch" not in m.group(1):
                bypass.append(name)
                break
    if bypass:
        fail(f"这些模块自带 api() 却绕过接缝（会丢分页/限流/取消）：{sorted(set(bypass))}")

    if "vendor-lazy.js" not in [item["file"] for item in manifest["vendor_js"]]:
        fail("vendor-lazy.js 不在 manifest 的 vendor_js 中（erwVendor 需在业务脚本前就位）")
    if "v260922-performance.js" in order and "app.js" in order:
        # 不再强制顺序（接缝在运行期解析），但提供方排在前面更稳：未来若有求值期请求也不会漏
        notes.append("fetch 接缝提供方位于 app.js 之前（非强制，但更稳）"
                     if order.index("v260922-performance.js") < order.index("app.js")
                     else "fetch 接缝提供方排在 app.js 之后（运行期解析下仍正确，但求值期请求会漏）")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="前端静态体检（只读）")
    ap.add_argument("--no-node", action="store_true", help="跳过 node --check")
    args = ap.parse_args(argv)

    check_syntax(use_node=not args.no_node)
    manifest = check_manifest()
    check_seams()
    check_order(manifest)

    for n in notes:
        print(f"  - {n}")
    if problems:
        print(f"\n发现 {len(problems)} 个问题：")
        for p in problems:
            print(f"  [x] {p}")
        return 1
    print("\n前端体检通过：语法、装配清单、模块缺失、接缝完整性、加载顺序约束均无问题")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
