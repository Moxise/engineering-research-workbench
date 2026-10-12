"""MCP stdio 服务入口 —— 暴露工程科研工作台的知识库约束与操作工具。

运行：在工作项根目录执行 ``python -m mcp.server``（或直接 ``python mcp/server.py``）。
"""

from __future__ import annotations

import json
import sys
import traceback
from pathlib import Path
from typing import Any

if __package__ in (None, ""):  # 支持 `python mcp/server.py` 直接运行
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from mcp.server import main as _main  # type: ignore[no-redef]

    raise SystemExit(_main())

from . import constraints as C  # noqa: E402
from .bridge import Workbench, WorkbenchError  # noqa: E402
from .protocol import (  # noqa: E402
    DEFAULT_PROTOCOL_VERSION,
    INTERNAL_ERROR,
    INVALID_PARAMS,
    METHOD_NOT_FOUND,
    SUPPORTED_PROTOCOL_VERSIONS,
    RpcError,
    StdioTransport,
    ok,
    resource,
)
from .tools_knowledge import HANDLERS as KB_HANDLERS, TOOLS as KB_TOOLS  # noqa: E402
from .tools_workspace import HANDLERS as WS_HANDLERS, TOOLS as WS_TOOLS  # noqa: E402

ALL_TOOLS = KB_TOOLS + WS_TOOLS
HANDLERS = {**KB_HANDLERS, **WS_HANDLERS}

INSTRUCTIONS = (
    "这是「工程科研工作台」（engineering-research-workbench）的 Agent 接口。\n"
    "工作台的 Markdown + frontmatter 是唯一事实来源，System/Cache 中的 SQLite 索引只是可重建的派生物。\n"
    "工作约定：\n"
    "1. 会话开始先调用 kb_constraints（至少 topic=storage 与 topic=naming）读取存放规则与命名规范；\n"
    "2. 建档前用 kb_search / kb_list_entries 查重，用 ws_list_projects 确认项目归属，不要凭空拼项目名；\n"
    "3. 一切写入都走 kb_create_entry / kb_update_entry / kb_rename_entry / kb_delete_entry，不要手写 frontmatter 落盘；\n"
    "4. 命名规范是硬约束：`level=error` 的校验项会导致工具拒绝写入；\n"
    "5. 改名必须用 kb_rename_entry，它会同步 title/H1/交叉引用并只追加一次 doc_update 事件；\n"
    "6. 收尾用 kb_check_entries 复核，必要时 ws_reindex 重建索引。"
)

RESOURCES: list[dict[str, Any]] = [
    resource(f"workbench://constraints/{topic}", f"constraints-{topic}",
             f"{C.SERVER_NAME} 约束：{desc}", f"工作台约束主题 `{topic}`：{desc}")
    for topic, desc in C.TOPICS.items()
]
RESOURCES.append(resource(
    "workbench://rules/naming-source", "naming-rule-source",
    "知识库条目命名规范（原始规则文档）",
    "`.trae/rules/知识库条目命名规范.md` 的原文，命名约束的权威出处。"))
RESOURCES.append(resource(
    "workbench://workspace/layout", "workspace-layout",
    "Workspace 目录骨架",
    "Workspace 与项目标准子目录、System 文件语义。"))

PROMPTS: list[dict[str, Any]] = [
    {
        "name": "kb-capture",
        "title": "按规范沉淀一条知识",
        "description": "引导 Agent 先读约束、再查重、再按命名规范建档，最后复核。",
        "arguments": [
            {"name": "content", "description": "要沉淀的内容原文或要点", "required": True},
            {"name": "kind", "description": "预期条目类型：" + " / ".join(C.KIND_ORDER), "required": False},
        ],
    },
    {
        "name": "kb-audit",
        "title": "知识库命名体检与整改",
        "description": "扫描全库命名合规问题并逐条给出改名方案。",
        "arguments": [{"name": "kind", "description": "限定条目类型，留空为全部", "required": False}],
    },
]


# ------------------------------------------------------------------ 请求处理

def _protocol_version(params: dict[str, Any]) -> str:
    asked = str(params.get("protocolVersion") or "")
    return asked if asked in SUPPORTED_PROTOCOL_VERSIONS else DEFAULT_PROTOCOL_VERSION


def handle_initialize(params: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocolVersion": _protocol_version(params),
        "capabilities": {
            "tools": {"listChanged": False},
            "resources": {"subscribe": False, "listChanged": False},
            "prompts": {"listChanged": False},
            "logging": {},
        },
        "serverInfo": {"name": C.SERVER_NAME, "version": C.SERVER_VERSION,
                       "title": f"{C.SERVER_NAME} MCP（工作台 {C.WORKBENCH_VERSION_EXPECTED}）"},
        "instructions": INSTRUCTIONS,
    }


#: 会改知识库的 MCP 工具（v261009.38 起受「外部接入授权」约束，默认关闭）
WRITE_TOOLS = frozenset({"kb_create_entry", "kb_update_entry", "kb_rename_entry",
                         "kb_change_kind", "kb_delete_entry",
                         "kb_merge_variants", "kb_archive_variants"})


def handle_tools_call(wb: Workbench, params: dict[str, Any]) -> dict[str, Any]:
    name = str(params.get("name") or "")
    handler = HANDLERS.get(name)
    if handler is None:
        raise RpcError(METHOD_NOT_FOUND, f"未知工具 `{name}`",
                       {"available": sorted(HANDLERS)})
    if name in WRITE_TOOLS:
        # 外部接入授权：默认**拒绝**（只读），在「设置 → 外部接入」里显式打开后放行
        from app import external_access

        # 注意别用 `ok` 当变量名：本模块从 protocol 导入了 `ok()`，遮蔽它会让成功路径直接崩
        allowed, reason = external_access.allowed("mcp_write")
        if not allowed:
            return {"content": [{"type": "text", "text": f"[未授权] {reason}"}], "isError": True}
    raw_args = params.get("arguments")
    args: dict[str, Any] = raw_args if isinstance(raw_args, dict) else {}
    try:
        result = handler(wb, args)
    except WorkbenchError as exc:
        return {"content": [{"type": "text", "text": f"[错误] {exc}"}], "isError": True}
    except FileNotFoundError as exc:
        return {"content": [{"type": "text", "text": f"[错误] 目标不存在：{exc}"}], "isError": True}
    except Exception as exc:  # noqa: BLE001
        detail = traceback.format_exc(limit=6)
        return {"content": [{"type": "text",
                             "text": f"[错误] 工具 `{name}` 执行失败：{exc}\n```\n{detail}\n```"}],
                "isError": True}
    # 仅当返回值确实是 MCP 结果信封（content 为“字典列表”）时才原样透传，
    # 否则一律重新封装，避免业务载荷里恰好存在名为 content 的字段被误判。
    if isinstance(result, dict):
        content = result.get("content")
        if isinstance(content, list) and content and all(isinstance(x, dict) for x in content):
            return result
    return ok(result)


def _constraint_body(topic: str) -> str:
    from .tools_knowledge import _constraint_text

    return _constraint_text(topic)


def handle_resources_read(wb: Workbench, params: dict[str, Any]) -> dict[str, Any]:
    uri = str(params.get("uri") or "")
    prefix = "workbench://constraints/"
    if uri.startswith(prefix):
        topic = uri[len(prefix):]
        if topic not in C.TOPICS:
            raise RpcError(INVALID_PARAMS, f"未知约束主题 `{topic}`", {"available": list(C.TOPICS)})
        return {"contents": [{"uri": uri, "mimeType": "text/markdown", "text": _constraint_body(topic)}]}
    if uri == "workbench://rules/naming-source":
        path = wb.repo_root / ".trae" / "rules" / "知识库条目命名规范.md"
        if not path.exists():
            raise RpcError(INVALID_PARAMS, "规则原文不存在", {"path": str(path)})
        return {"contents": [{"uri": uri, "mimeType": "text/markdown",
                              "text": path.read_text(encoding="utf-8")}]}
    if uri == "workbench://workspace/layout":
        text = _constraint_body("storage") + "\n\n" + _constraint_body("kinds")
        return {"contents": [{"uri": uri, "mimeType": "text/markdown", "text": text}]}
    raise RpcError(INVALID_PARAMS, f"未知资源 `{uri}`")


def handle_prompts_get(wb: Workbench, params: dict[str, Any]) -> dict[str, Any]:
    name = str(params.get("name") or "")
    args = params.get("arguments") if isinstance(params.get("arguments"), dict) else {}
    if name == "kb-capture":
        kind = str(args.get("kind") or "未指定")
        content = str(args.get("content") or "")
        text = (
            "请把下面的内容按工作台规范沉淀成知识条目。\n\n"
            f"预期条目类型：{kind}\n预期内容：\n{content}\n\n"
            "执行步骤：\n"
            "1. kb_constraints（topic=naming、topic=kinds）确认前缀、类别词与命名规则；\n"
            "2. kb_search 查重，避免重复建档；\n"
            "3. ws_list_projects 确认 projects 归属；\n"
            "4. kb_create_entry（先给 name + category，让工具生成规范标题），再 kb_update_entry 补正文；\n"
            "5. kb_check_entries 复核命名与 title/H1 一致性。"
        )
        return {"description": "按规范沉淀一条知识条目", "messages": [{"role": "user", "content": {"type": "text", "text": text}}]}
    if name == "kb-audit":
        kind = str(args.get("kind") or "")
        text = (
            "请对知识库做一次命名规范体检与整改。\n\n"
            f"限定条目类型：{kind or '全部'}\n\n"
            "执行步骤：\n"
            "1. kb_constraints（topic=naming、topic=sync）读取命名与改名同步要求；\n"
            "2. kb_check_entries（check_h1=true）产出问题清单；\n"
            "3. 对每条问题给出规范标题，用 kb_rename_entry（先 dry_run=true 看影响面）逐条修正；\n"
            "4. 汇总：合规率、已修正条目、仍需人工确认的条目。"
        )
        return {"description": "知识库命名体检与整改", "messages": [{"role": "user", "content": {"type": "text", "text": text}}]}
    raise RpcError(INVALID_PARAMS, f"未知提示 `{name}`", {"available": [p["name"] for p in PROMPTS]})


def dispatch(wb: Workbench, msg: dict[str, Any]) -> dict[str, Any] | None:
    """返回响应体；通知类消息返回 None。"""
    method = str(msg.get("method") or "")
    params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
    if method.startswith("notifications/"):
        return None
    if method == "initialize":
        return handle_initialize(params)
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": ALL_TOOLS}
    if method == "tools/call":
        return handle_tools_call(wb, params)
    if method == "resources/list":
        return {"resources": RESOURCES}
    if method == "resources/templates/list":
        return {"resourceTemplates": []}
    if method == "resources/read":
        return handle_resources_read(wb, params)
    if method == "prompts/list":
        return {"prompts": PROMPTS}
    if method == "prompts/get":
        return handle_prompts_get(wb, params)
    if method == "logging/setLevel":
        return {}
    if method == "completion/complete":
        return {"completion": {"values": [], "total": 0, "hasMore": False}}
    raise RpcError(METHOD_NOT_FOUND, f"未实现的方法 `{method}`")


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return _selftest()
    transport = StdioTransport(sys.stdin.buffer, sys.stdout.buffer)
    sys.stdout = sys.stderr  # 保证协议通道不被任何 stray print 污染
    wb = Workbench()
    while True:
        try:
            msg = transport.read()
        except RpcError as exc:
            transport.write({"jsonrpc": "2.0", "id": None, "error": exc.to_dict()})
            continue
        if msg is None:
            break
        if isinstance(msg, list):  # 兼容被包裹的批处理
            for item in msg:
                _serve_one(transport, wb, item)
            continue
        _serve_one(transport, wb, msg)
    return 0


def _serve_one(transport: StdioTransport, wb: Workbench, msg: Any) -> None:
    if not isinstance(msg, dict):
        return
    msg_id = msg.get("id")
    is_notification = "id" not in msg
    try:
        result = dispatch(wb, msg)
    except RpcError as exc:
        if not is_notification:
            transport.write({"jsonrpc": "2.0", "id": msg_id, "error": exc.to_dict()})
        return
    except Exception as exc:  # noqa: BLE001
        if not is_notification:
            transport.write({"jsonrpc": "2.0", "id": msg_id, "error": {
                "code": INTERNAL_ERROR, "message": str(exc),
                "data": traceback.format_exc(limit=6)}})
        return
    if result is None or is_notification:
        return
    transport.write({"jsonrpc": "2.0", "id": msg_id, "result": result})


def _selftest() -> int:
    """离线自检：不启动 stdio，直接校验工具表与约束资源。"""
    problems: list[str] = []
    names = [t["name"] for t in ALL_TOOLS]
    if len(names) != len(set(names)):
        problems.append("工具名存在重复")
    for t in ALL_TOOLS:
        if t["name"] not in HANDLERS:
            problems.append(f"工具 `{t['name']}` 缺少实现")
        schema = t["inputSchema"]
        for key in schema.get("required", []):
            if key not in schema["properties"]:
                problems.append(f"工具 `{t['name']}` 的必填参数 `{key}` 未在 properties 中声明")
    for h in HANDLERS:
        if h not in names:
            problems.append(f"实现 `{h}` 未在工具表登记")
    for topic in C.TOPICS:
        try:
            _constraint_body(topic)
        except Exception as exc:  # noqa: BLE001
            problems.append(f"约束主题 `{topic}` 渲染失败：{exc}")
    print(json.dumps({"server": C.SERVER_NAME, "version": C.SERVER_VERSION,
                      "tools": len(ALL_TOOLS), "resources": len(RESOURCES),
                      "prompts": len(PROMPTS), "topics": list(C.TOPICS),
                      "problems": problems, "ok": not problems},
                     ensure_ascii=False, indent=2))
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
