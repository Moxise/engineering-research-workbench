"""`core_api` —— 插件**唯一允许** import 的内核门面（PLUGIN_SPEC §6 代码隔离）。

插件只写 `from core_api import log` 这类导入；**不得** import `core.*` 私有模块、
`app.*`，也不得 import 别的插件。`tools/plugin_check.py` 会对内核侧做反向检查
（内核不得 import 插件），而插件的合规由加载器在运行期把关（§7 冲突与权限）。

这里保持**最小面**：只放插件真正需要、且内核承诺长期稳定的东西。要加东西是**有意的动作**——
每加一项都要在 docs/PLUGIN_SPEC.md §6 里写清语义。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

#: 内核 API 版本，与 `core.plugins.manifest.SUPPORTED_API_VERSION` 同源
API_VERSION = 1


def _data_root() -> Path:
    """可写数据根：打包态是 exe 同级，开发态是仓库根（镜像 app/paths.py 的判定）。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def plugin_dir(plugin_id: str) -> Path:
    """插件自己的目录（只读代码 + 资源）。"""
    for source_root in (_data_root() / "plugins",):
        candidate = source_root / plugin_id
        if candidate.is_dir():
            return candidate
    return _data_root() / "plugins" / plugin_id


def cache_db(plugin_id: str) -> Path:
    """插件自有派生库路径：`System/Cache/<id>.sqlite`（§3 只允许这一类）。"""
    return _data_root() / "Workspace" / "System" / "Cache" / f"{plugin_id}.sqlite"


def workspace_dir(plugin_id: str) -> Path:
    """插件自有用户数据目录：`Workspace/Plugins/<id>/`。"""
    return _data_root() / "Workspace" / "Plugins" / plugin_id


def data_root() -> Path:
    """可写数据根（打包态是 exe 同级，开发态是仓库根）。

    插件通常**不需要**它 —— 优先用 `plugin_dir` / `system_dir` / `workspace_dir` /
    `config_path` 这些**命名空间内**的助手。它存在的正当理由只有一个：**一次性迁移**，
    即把内核时代写在别处（如 `System/Cache/*`）的数据认领进插件自己的命名空间；
    迁移完成后就不该再用。
    """
    return _data_root()


def http_get(url: str, timeout: float = 8.0, headers: dict | None = None, limit: int = 8 * 1024 * 1024) -> bytes:
    """取 URL 的内容（字节，限长）。插件出网的推荐方式。

    带**代理兜底**：系统代理若指向回环地址而端口没人监听（Clash/V2Ray 没启动的常见情形），
    本次请求自动改走直连，避免所有出网请求都撞上 `WinError 10061`；真正的远程代理不受影响，
    超时 / DNS 失败 / 非 2xx 也照原样抛出（详见 `core/net.py`）。
    """
    from core import net

    return net.read_url(url, timeout=timeout, headers=headers, limit=limit)


def system_dir(plugin_id: str) -> Path:
    """插件自有系统数据目录：`System/Plugins/<id>/`。"""
    return _data_root() / "Workspace" / "System" / "Plugins" / plugin_id


def config_path(plugin_id: str) -> Path:
    """插件自有配置：`config/plugins/<id>.json`（内核不解释其内容）。"""
    return _data_root() / "config" / "plugins" / f"{plugin_id}.json"


def read_config(plugin_id: str, default: dict | None = None) -> dict:
    path = config_path(plugin_id)
    if not path.is_file():
        return dict(default or {})
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else dict(default or {})
    except (OSError, json.JSONDecodeError):
        return dict(default or {})


def write_config(plugin_id: str, data: dict) -> None:
    path = config_path(plugin_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def log(plugin_id: str, message: str) -> None:
    """插件日志（带插件前缀，便于在内核日志里区分）。"""
    print(f"[plugin:{plugin_id}] {message}", flush=True)


__all__ = [
    "API_VERSION", "plugin_dir", "cache_db", "workspace_dir", "data_root", "system_dir",
    "config_path", "read_config", "write_config", "http_get", "log",
]
