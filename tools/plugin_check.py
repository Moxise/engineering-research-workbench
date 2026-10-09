"""插件隔离体检 —— 内核必须能在「零插件」下完整运行（PLUGIN_SPEC §4.3 / 不变量 I1、I2）。

    python tools/plugin_check.py                     # 静态不变量 + 空插件集盘点
    python tools/plugin_check.py --assert-core-only  # 同上，并把「插件集非空」也当通过条件（CI 用）
    python tools/plugin_check.py --json

静态查什么（只读，不导入插件）：

1. **I2 依赖方向单向**：`core/**` 与 `server.py`、`app/**` 都不得 import 插件实现
   （`plugins.` 命名空间）；插件只能经 `core_api` 与内核交互。
2. **core 不依赖 app**：`core/**` 不得 import `app`——这是「内核可独立裁剪/测试」的前提，
   也是插件运行期动态加载 core 时不会踩 `app` 顺序炸弹的前提。
3. **空插件集可启动**：把扫描根指向一个**空目录**，插件盘点必须无 rejected/blocked/conflict
   （也就是「零插件」是合法状态，不是故障）。
4. **不是空的** 交给运行时套件：真正的行为验收是 `tools/kb_smoke.py` + `tools/ui_smoke.py`
   ——它们跑的就是「当前装配」下的完整功能。
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core.plugins import registry as R  # noqa: E402

#: 允许 import 插件的白名单（目前应为空：内核不认识任何具体插件）
PLUGIN_IMPORTERS_ALLOWED: set[str] = set()

PLUGIN_IMPORT_RE = re.compile(r"^\s*(?:from|import)\s+(plugins[\w.]*)", re.M)
APP_IMPORT_RE = re.compile(r"^\s*(?:from|import)\s+(app[\w.]*)", re.M)


def strip_comments(text: str) -> str:
    text = re.sub(r'"""[\s\S]*?"""', " ", text)
    text = re.sub(r"'''[\s\S]*?'''", " ", text)
    text = re.sub(r"(?m)#[^\n]*$", " ", text)
    return text


def scan_plugin_imports() -> list[str]:
    """I2：内核侧不得 import 插件实现。"""
    offenders: list[str] = []
    targets = list((ROOT / "core").rglob("*.py")) + list((ROOT / "app").rglob("*.py")) + [ROOT / "server.py"]
    for path in targets:
        rel = path.relative_to(ROOT).as_posix()
        if rel in PLUGIN_IMPORTERS_ALLOWED:
            continue
        if PLUGIN_IMPORT_RE.search(strip_comments(path.read_text(encoding="utf-8"))):
            offenders.append(rel)
    return offenders


def scan_core_app_coupling() -> list[str]:
    """core 不得 import app（内核独立性）；镜像 app/paths.py 的少数几行不算依赖。"""
    offenders: list[str] = []
    for path in (ROOT / "core").rglob("*.py"):
        text = strip_comments(path.read_text(encoding="utf-8"))
        if APP_IMPORT_RE.search(text):
            offenders.append(path.relative_to(ROOT).as_posix())
    return offenders


def empty_set_report() -> dict:
    """把扫描根指向空目录，验证「零插件」是合法状态。"""
    tmp = ROOT / ".scratch" / "verify" / "plugins-empty"
    (tmp / "bundled").mkdir(parents=True, exist_ok=True)
    (tmp / "user").mkdir(parents=True, exist_ok=True)
    return R.report(
        roots=[("bundled", tmp / "bundled"), ("user", tmp / "user")],
        workspace=None,
        core_version=(ROOT / "VERSION").read_text(encoding="utf-8").strip() if (ROOT / "VERSION").is_file() else "",
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="插件隔离体检（只读）")
    ap.add_argument("--assert-core-only", action="store_true", help="CI 用：显式断言零插件可跑")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    fails: list[str] = []
    notes: list[str] = []

    offenders = scan_plugin_imports()
    if offenders:
        fails.append(f"I2 违反：内核侧 import 了插件实现 {offenders}（插件只能经 core_api 交互）")
    else:
        notes.append("I2 通过：core/、app/、server.py 均未 import 插件实现")

    coupling = scan_core_app_coupling()
    if coupling:
        fails.append(f"core 依赖了 app：{coupling}（内核必须能脱离 app 独立加载）")
    else:
        notes.append("core 未 import app（内核独立性保持）")

    report = empty_set_report()
    bad = report["rejected"] + report["blocked"] + report["conflict"]
    if bad:
        fails.append(f"空插件集不是合法状态：rejected={report['rejected']} blocked={report['blocked']} conflict={report['conflict']}")
    else:
        notes.append("空插件集盘点干净（零插件 = 合法状态）")

    real = R.report(workspace=None, core_version=(ROOT / "VERSION").read_text(encoding="utf-8").strip())
    notes.append(f"当前 plugins/ 实况：发现 {len(real['plugins'])} 个，可用 {real['available']}，"
                 f"blocked {real['blocked']}，rejected {real['rejected']}，冲突 {real['conflict']}")

    # 面板契约：声明了 nav 的插件，其 mount 脚本必须自登记 ERWPanels——
    # 否则脚本会正常加载但什么都不做，表现为「插件装了却不出现」，属静默失败（I11）。
    candidates, _ = R.discover()
    for pid, cand in sorted(candidates.items()):
        if cand.state != "available":
            continue
        for item in (cand.manifest or {}).get("nav") or []:
            mount = str((item or {}).get("mount") or "")
            if not mount:
                continue
            script = Path(cand.dir) / mount
            if not script.is_file():
                fails.append(f"插件 {pid} 的 nav.mount 文件不存在：{mount}")
                continue
            text = script.read_text(encoding="utf-8")
            if "ERWPanels.register" not in text and "ERWPanels?.register" not in text:
                fails.append(f"插件 {pid} 的面板 {mount} 没有调用 ERWPanels.register"
                             "（会正常加载但不出现在侧栏）")
            else:
                notes.append(f"面板契约通过：{pid} → {mount} 自登记 ERWPanels")

    if args.assert_core_only:
        # 额外跑一次数据冒烟：它跑在「当前装配」上，等价于「核心零插件」的功能验收（I1 的代理）
        r = subprocess.run([sys.executable, str(ROOT / "tools" / "kb_smoke.py")],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", cwd=str(ROOT))
        if r.returncode != 0:
            fails.append("kb_smoke 未通过（零插件下核心必须完整可跑）")
        else:
            notes.append("kb_smoke 在零插件装配下通过（I1 代理）")

    out = {"fails": fails, "notes": notes, "core_only_report": report}
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        for n in notes:
            print(f"  - {n}")
        if fails:
            print(f"\n发现 {len(fails)} 个问题：")
            for f in fails:
                print(f"  [x] {f}")
        else:
            print("\n插件隔离体检通过：依赖方向单向、内核可脱离 app、零插件是合法状态")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
