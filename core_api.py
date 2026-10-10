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
    `config_path` 这些**命名空间内**的助手。正当用途只有两个：

    1. **一次性迁移**：把内核时代写在别处（如 `System/Cache/*`）的数据认领进插件自己的命名空间；
    2. **归档/备份类插件枚举文件**（如 `plugins/backup-snapshot`）：备份天然要读到 `Workspace/**` 与
       `config/**`，这是它的职责；但**写入仍然只该落在自己的命名空间**，除非用户显式指定了外部目标目录。
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


# ---- 文献（文献库由**核心**维护：梳理与阅读进核心，见 docs/SCOPE.md §2.1/§2.2）----
# 插件若要做「文献侧」的功能（如文献笔记工具包），通过这些函数访问核心的文献库，
# **不要**自己去读 Workspace 下的 PDF/Notes 文件（那是核心的数据结构，见 §6 隔离）。

def lit_list(query: str = "", status: str = "", page: int = 1, page_size: int = 50) -> dict:
    """列出文献条目（分页）。字段与 `/api/literature` 一致。"""
    from app import literature

    return literature.list_items(query=query, status=status, page=page, page_size=page_size)


def lit_item(paper_id: str) -> dict:
    """取单篇文献的元信息（含 `doc_id` 关联、阅读状态、标签）。"""
    from app import literature

    return literature.get_item(paper_id)


def lit_note(paper_id: str) -> str:
    """读该文献的笔记正文（与知识库条目正文同源）。"""
    from app import literature

    return literature.get_note(paper_id)


def lit_note_save(paper_id: str, content: str) -> dict:
    """写该文献的笔记正文。

    **写操作的安全闸门在内核**：插件注册的**写工具**在 confirm 模式下只会生成草稿，
    用户确认后内核才以 direct 模式调用插件 handler（见 `app/agent_tools.execute`）。
    所以插件 handler 里直接写即可，不要自己再实现一套确认逻辑。
    """
    from app import literature

    return literature.save_note(paper_id, content)


def lit_annotations(paper_id: str, page: int | None = None) -> list:
    """读该文献的批注（可选按页过滤）。"""
    from app import literature

    return literature.get_annotations(paper_id, page)


def lit_note_image(paper_id: str, data_url: str) -> dict:
    """把 data_url 图片落盘到**笔记图片目录**，返回路径口径与附件一致的引用（供笔记 Markdown 使用）。

    与核心阅读器「插入图片」走的是同一个核心实现（`literature.save_note_image`）。
    """
    from app import literature

    return literature.save_note_image(paper_id, data_url)


def system_dir(plugin_id: str) -> Path:
    """插件自有系统数据目录：`System/Plugins/<id>/`。"""
    return _data_root() / "Workspace" / "System" / "Plugins" / plugin_id


# ---- 知识条目 / 项目 / 总览（只读；v261009.23 起插件可用的数据窗口）----
# 插件要用知识库数据时**走这里**（与前端 `/api/docs`、`/api/projects` 同一套查询实现），
# **不要**自己去读 `Workspace/Knowledge/*.md`：那是核心的数据结构，绕过索引会看到过期或半写的状态（§6 隔离）。

def entry(doc_id: str) -> dict:
    """取一条知识条目的完整内容（**含 `body` 正文**）。找不到时抛 `FileNotFoundError`。"""
    from app import indexer

    return indexer.get_doc(doc_id)


def entries(kind: str | None = None, *, query: str = "", status: str = "", project: str = "",
            mark: str = "", tag: str = "", unowned: bool = False,
            limit: int = 200, page: int = 1) -> list[dict]:
    """列出知识条目（只含元数据与摘要，**不含正文**）。

    字段与 `/api/docs` 一致（`id/kind/title/status/projects/tags/marks/updated/created/pinned/…`）。
    需要正文就按 id 逐条 `entry(doc_id)` —— 列表刻意不返回正文：一次拉几百条正文很慢，
    而且多数调用方（列表、统计、筛选）根本用不上。
    """
    from app import indexer

    want = max(1, int(limit or 1))
    out: list[dict] = []
    cursor = max(1, int(page or 1))
    while len(out) < want:
        chunk = indexer.list_docs(kind, query, status, project, mark, tag=tag, unowned=unowned,
                                  page=cursor, page_size=min(want - len(out), 200), paged=True)
        rows = list((chunk or {}).get("items") or [])
        out.extend(rows)
        if not rows or not (chunk or {}).get("next_page"):
            break
        cursor = int(chunk["next_page"])
    return out[:want]


def projects() -> list[dict]:
    """项目注册表（含 `project_id`/名称/状态/计数），与 `/api/project-records` 同源。"""
    from app import indexer

    return indexer.project_records()


def project_names() -> list[str]:
    """项目名列表（与 `/api/projects` 同源）。"""
    from app import indexer

    return indexer.project_names()


def todos(include_done: bool = True) -> list[dict]:
    """待办清单（`System/todos.json`），字段与 `/api/todos` 一致：`id/title/done/project/due/priority`。

    默认含已完成项；只关心待办的传 `include_done=False`。
    """
    from app import indexer

    rows = indexer.list_todos()
    return list(rows) if include_done else [r for r in rows if not r.get("done")]


def dashboard() -> dict:
    """工作台总览统计（条目/项目/待办/活动计数），与 `/api/dashboard` 同源。"""
    from app import indexer

    return indexer.dashboard()


def kind_labels() -> dict[str, str]:
    """七类 kind 的中文标签（`{"note": "笔记", …}`）。

    插件**不要**自己再抄一份标签表（前端有等价的 `window.ERWContract.kindLabels()`）：
    权威声明在 `core/contracts/kinds.py`，这里只是把它原样递给插件。
    """
    from core.contracts import kinds as contracts

    return dict(contracts.KIND_LABELS)


def kind_order() -> list[str]:
    """kind 的契约顺序（报告、目录、统计按它排列，保证各插件输出一致）。"""
    from core.contracts import kinds as contracts

    return list(contracts.KIND_ORDER)


def kernel_version() -> str:
    """内核版本（`VERSION` 文件的内容，如 `v261009.24`）。

    给需要写"由谁生成"这类来源信息的插件用（快照清单、导出文档、备份元数据）。
    去掉 UTF-8 BOM 再返回；读不到时返回空串。
    """
    from core.plugins import manifest as _manifest

    try:
        return _manifest.read_core_version(_data_root())
    except Exception:
        return ""


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
    "lit_list", "lit_item", "lit_note", "lit_note_save", "lit_annotations", "lit_note_image",
]
