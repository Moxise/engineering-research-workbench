# -*- coding: utf-8 -*-
"""下载 pdf.js 运行资源到 web/vendor/pdfjs（本地化：断网也能读 PDF，CDN 仍作回退）。

为什么需要：
1. 文献阅读目前依赖 jsDelivr CDN —— 断网/被墙就打不开 PDF；
2. 无头验收工具（tools/shot_page.py）用 `--virtual-time-budget` 等待，**不等远端脚本加载**，
   于是任何依赖 CDN 的界面验证都会假失败（本次排查中真实踩到）。

用法：
    python tools/fetch_pdfjs.py            # 缺什么下什么
    python tools/fetch_pdfjs.py --force    # 全量重下
    python tools/fetch_pdfjs.py --check    # 只检查本地是否齐备（不联网）
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "web/vendor/pdfjs"
VERSION = "3.11.174"
# 主源用 unpkg（实测 jsDelivr 连续请求会被限流中止：WinError 10053），备用 jsDelivr
HOSTS = (
    f"https://unpkg.com/pdfjs-dist@{VERSION}",
    f"https://cdn.jsdelivr.net/npm/pdfjs-dist@{VERSION}",
)
LIST_API = f"https://data.jsdelivr.com/v1/packages/npm/pdfjs-dist@{VERSION}?structure=flat"
THROTTLE_SECONDS = 0.12
RETRIES = 3

WANT_PREFIXES = ("/build/pdf.min.js", "/build/pdf.worker.min.js", "/cmaps/", "/standard_fonts/")
SKIP_SUFFIXES = (".md", ".map")
REQUIRED = ["build/pdf.min.js", "build/pdf.worker.min.js",
            "cmaps/UniGB-UCS2-H.bcmap", "cmaps/GBK-EUC-H.bcmap",
            "standard_fonts/FoxitSerif.pfb", "standard_fonts/LiberationSans-Regular.ttf"]


def fetch(url: str, timeout: float = 60.0) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "erw-fetch-pdfjs",
                                              "Accept": "*/*", "Connection": "close"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_with_retry(name: str) -> bytes:
    """逐源重试；每一步之间节流，避免被 CDN 判为高频请求。"""
    last: Exception | None = None
    for attempt in range(RETRIES):
        for host in HOSTS:
            try:
                blob = fetch(host + name)
                if blob:
                    return blob
            except Exception as exc:  # noqa: BLE001
                last = exc
            time.sleep(THROTTLE_SECONDS)
        time.sleep(0.6 * (attempt + 1))
    raise last or RuntimeError("下载失败")


def list_files() -> list[str]:
    data = json.loads(fetch(LIST_API, timeout=60).decode("utf-8"))
    out: list[str] = []
    for item in data.get("files", []):
        name = str(item.get("name") or "")
        if not name.startswith(WANT_PREFIXES):
            continue
        if name.endswith(SKIP_SUFFIXES) or name.endswith("/"):
            continue
        out.append(name)
    return sorted(out)


def check_local() -> tuple[int, int]:
    files = [p for p in DEST.rglob("*") if p.is_file()]
    missing = [rel for rel in REQUIRED if not (DEST / rel).is_file()]
    print(f"  本地文件 {len(files)} 个，体积 {sum(p.stat().st_size for p in files)/1024/1024:.1f} MB")
    for rel in missing:
        print(f"  缺失必需文件：{rel}")
    return len(files), len(missing)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="已存在也重下")
    ap.add_argument("--check", action="store_true", help="只检查本地")
    args = ap.parse_args()

    if args.check:
        _, missing = check_local()
        print("  结论：" + ("齐备" if missing == 0 else f"缺 {missing} 个必需文件"))
        return 0 if missing == 0 else 1

    names = list_files()
    print(f"pdf.js {VERSION}：待同步 {len(names)} 个文件 → {DEST}")
    done = skipped = failed = 0
    total_bytes = 0
    for i, name in enumerate(names, 1):
        target = DEST / name.lstrip("/")
        if target.is_file() and not args.force and target.stat().st_size > 0:
            skipped += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            blob = fetch_with_retry(name)
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  ! {name} 失败：{type(exc).__name__}: {str(exc)[:60]}")
            continue
        target.write_bytes(blob)
        done += 1
        total_bytes += len(blob)
        time.sleep(THROTTLE_SECONDS)
        if i % 25 == 0 or i == len(names):
            print(f"  进度 {i}/{len(names)}  新下 {done} 个（{total_bytes/1024/1024:.1f} MB）", flush=True)

    print(f"\n完成：新下 {done} · 已有 {skipped} · 失败 {failed}")
    _, missing = check_local()
    return 1 if (failed or missing) else 0


if __name__ == "__main__":
    raise SystemExit(main())
