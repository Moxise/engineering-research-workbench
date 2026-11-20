# -*- coding: utf-8 -*-
"""开机自动启动（Windows 启动项）。

实现：写 `HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` 下的一条 REG_SZ，
不需要管理员权限；登录后由系统拉起，不弹 UAC。

自启命令按当前运行形态决定：
- 打包后的桌面版 exe（与 Workspace 同目录）：`"<exe>"` —— 登录后直接打开工作台窗口；
- 源码版（没有 exe 时）：`"<pythonw>" "<client.py>"`（有托盘依赖时 `--background` 常驻托盘；
  缺失时正常开窗；client.py 缺失则退回 `pythonw server.py`）。

非 Windows 平台返回 `supported=False`，调用方只展示说明、不写任何东西。
"""

from __future__ import annotations

import sys
from pathlib import Path

from app import paths

APP_NAME = "EngineeringResearchWorkbench"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def _supported() -> bool:
    return sys.platform == "win32"


def _pythonw() -> str:
    """优先用 pythonw.exe：开机自启不应该留一个控制台黑窗。"""
    exe = Path(sys.executable)
    candidate = exe.with_name("pythonw.exe")
    return str(candidate if candidate.exists() else exe)


def _has_module(name: str) -> bool:
    try:
        import importlib.util as util

        return util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def _desktop_exe() -> Path | None:
    """打包后的桌面版 exe（与当前 Workspace 同目录）；没有就返回 None。"""
    if paths.FROZEN:
        return Path(sys.executable).resolve()
    candidate = Path(paths.DATA_ROOT) / "ResearchWorkbench.exe"
    return candidate if candidate.is_file() else None


def command() -> str:
    """当前形态下应该写入启动项的命令行。

    优先级：打包后的 exe（开机直接打开工作台窗口）→ 源码客户端（有托盘时托盘常驻，
    没有托盘时正常开窗，避免"启动了却看不见"）→ 仅后台服务。
    """
    exe = _desktop_exe()
    if exe:
        return f'"{exe}"'
    root = Path(paths.DATA_ROOT)
    client = root / "client.py"
    if client.exists():
        tray = _has_module("pystray") and _has_module("webview")
        suffix = " --background" if tray else ""
        return f'"{_pythonw()}" "{client}"{suffix}'
    return f'"{_pythonw()}" "{root / "server.py"}"'


def _read() -> tuple[bool, str]:
    if not _supported():
        return False, ""
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_READ) as key:
            value, _kind = winreg.QueryValueEx(key, APP_NAME)
            return True, str(value or "")
    except FileNotFoundError:
        return False, ""
    except OSError:
        return False, ""


def status() -> dict:
    """返回启动项状态；`enabled` 只表示键存在，`stale` 表示命令与当前形态不一致。"""
    enabled, current = _read()
    expected = command() if _supported() else ""
    return {
        "supported": _supported(),
        "enabled": enabled,
        "name": APP_NAME,
        "command": expected,
        "current": current,
        "stale": bool(enabled and current and current != expected),
        "mode": "desktop" if _desktop_exe() else "source",
    }


def enable() -> dict:
    if not _supported():
        raise ValueError("当前系统不支持开机自启（仅 Windows）")
    import winreg

    cmd = command()
    with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, cmd)
    return status()


def disable() -> dict:
    if not _supported():
        raise ValueError("当前系统不支持开机自启（仅 Windows）")
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
            winreg.DeleteValue(key, APP_NAME)
    except FileNotFoundError:
        pass
    return status()
