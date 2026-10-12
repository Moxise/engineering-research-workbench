"""版本管理 · 插件后端 v1.0.0

把「同一笔记的不同版本」做成工作台里的一个页面：版本族列表、逐版对照（含来源）、
按 H2 小节挑内容合并、归档与取回。

**为什么数据模型不在这里**：版本/来源必须在内核的写入收口点（`store.create_doc/update_doc`）处理，
否则界面、内核 Agent、MCP、插件四条路径里总有漏网的。本插件只做**界面与操作**，
经 `core_api` 的版本窗口读写（I3：插件只许 `from core_api import …`）。

路由（内核挂到 `/api/plugins/version-manager/` 下）：
  GET  overview  · 版本族总览
  GET  family    · 一个族的详情（?id=<条目 id>）
  POST merge     · 按小节合并
  POST archive   · 归档指定版本
  POST restore   · 从归档取回
工具：versions（读）· merge_versions / archive_versions（写，走内核草稿确认）
"""

from __future__ import annotations

import core_api

PLUGIN_ID = "version-manager"


def register(ctx):
    def _origin(tool: str) -> dict:
        return {"origin_surface": "plugin", "origin_tool": f"{PLUGIN_ID}:{tool}"}

    # ---------------------------------------------------------------- 路由
    def route_overview(request):
        return core_api.version_overview()

    def route_family(request):
        query = request.get("query") or {}
        doc_id = str((query.get("id") or [""])[0] or "").strip()
        if not doc_id:
            return {"error": "bad_request", "message": "缺少 id（条目 id）"}
        try:
            return core_api.variant_family(doc_id, with_body=True)
        except FileNotFoundError:
            return {"error": "not_found", "message": f"条目不存在：{doc_id}"}

    def route_merge(request):
        body = request.get("body") or {}
        base_id = str(body.get("base_id") or "").strip()
        if not base_id:
            return {"error": "bad_request", "message": "缺少 base_id"}
        try:
            out = core_api.merge_variants(base_id, body.get("picks") or {},
                                          archive_merged=bool(body.get("archive_merged")),
                                          origin=_origin("merge"))
        except FileNotFoundError as exc:
            return {"error": "not_found", "message": str(exc)}
        return {"ok": True, **out}

    def route_archive(request):
        body = request.get("body") or {}
        base_id = str(body.get("base_id") or "").strip()
        ids = [str(x) for x in (body.get("variant_ids") or []) if str(x).strip()]
        if not base_id or not ids:
            return {"error": "bad_request", "message": "需要 base_id 与 variant_ids"}
        return {"ok": True, **core_api.archive_variants(base_id, ids)}

    def route_restore(request):
        body = request.get("body") or {}
        base_id = str(body.get("base_id") or "").strip()
        file_name = str(body.get("file") or "").strip()
        if not base_id or not file_name:
            return {"error": "bad_request", "message": "需要 base_id 与 file"}
        try:
            return {"ok": True, **core_api.restore_variant(base_id, file_name)}
        except FileNotFoundError:
            return {"error": "not_found", "message": f"归档里没有这个文件：{file_name}"}

    def route_history(request):
        """某条笔记（及其各版本）的**修改记录**：时间 · 类型 · 来源 · 合并细节。"""
        query = request.get("query") or {}
        doc_id = str((query.get("id") or [""])[0] or "").strip()
        if not doc_id:
            return {"error": "bad_request", "message": "缺少 id（条目 id）"}
        days = int((query.get("days") or ["30"])[0] or 30)
        try:
            fam = core_api.variant_family(doc_id)
        except FileNotFoundError:
            return {"error": "not_found", "message": f"条目不存在：{doc_id}"}
        ids = [fam["base_id"]] + [v["id"] for v in fam.get("variants") or []]
        out = core_api.activity_events(days, refs=ids, limit=200)
        out["base_id"] = fam["base_id"]
        return out

    ctx.routes.get("history", route_history)
    ctx.routes.get("overview", route_overview)
    ctx.routes.get("family", route_family)
    ctx.routes.post("merge", route_merge)
    ctx.routes.post("archive", route_archive)
    ctx.routes.post("restore", route_restore)

    # ---------------------------------------------------------------- 工具
    def tool_versions(args, call_ctx=None):
        args = args or {}
        doc_id = str(args.get("doc_id") or "").strip()
        if not doc_id:
            return {"ok": False, "error": "缺少 doc_id"}
        try:
            fam = core_api.variant_family(doc_id)
        except FileNotFoundError:
            return {"ok": False, "error": f"条目不存在：{doc_id}"}
        return {"ok": True, **fam,
                "_hint": "合并用 merge_versions（选基准 + 逐节挑来源）；结束后用 archive_versions 归档。"}

    def tool_merge(args, call_ctx=None):
        args = args or {}
        base_id = str(args.get("base_id") or args.get("doc_id") or "").strip()
        if not base_id:
            return {"ok": False, "error": "缺少 base_id"}
        picks = args.get("picks") if isinstance(args.get("picks"), dict) else {}
        try:
            out = core_api.merge_variants(base_id, picks,
                                          archive_merged=bool(args.get("archive_merged")),
                                          origin=_origin("merge"))
        except FileNotFoundError as exc:
            return {"ok": False, "error": str(exc)}
        return {"ok": True, **out}

    def tool_archive(args, call_ctx=None):
        args = args or {}
        base_id = str(args.get("base_id") or "").strip()
        ids = [str(x) for x in (args.get("variant_ids") or []) if str(x).strip()]
        if not base_id or not ids:
            return {"ok": False, "error": "需要 base_id 与 variant_ids"}
        return {"ok": True, **core_api.archive_variants(base_id, ids)}

    ctx.mcp.tool("versions", {
        "description": "列某条条目的版本族：基条 + 各版本 + 已归档清单，并显示每一版是谁写的"
                       "（工作台界面 / 内核 Agent / 外部 MCP 客户端 / 插件）。",
        "parameters": {"type": "object",
                       "properties": {"doc_id": {"type": "string",
                                                 "description": "任一条目的 id（基条或某个版本都行）"}},
                       "required": ["doc_id"]},
    }, tool_versions)

    ctx.mcp.tool("merge_versions", {
        "description": "按小节合并版本族：先选基准（基条），再逐节指定用哪个版本的内容；"
                       "合并结果写回基条。可顺带归档被合并掉的版本。**写工具**：先出草稿，确认后落盘。",
        "parameters": {"type": "object",
                       "properties": {"base_id": {"type": "string", "description": "族里的基条 id"},
                                      "picks": {"type": "object",
                                                "description": "小节标题 → 来源版本 id；未列出的小节沿用基准",
                                                "additionalProperties": {"type": "string"}},
                                      "archive_merged": {"type": "boolean",
                                                         "description": "合并后把被替换的版本一并归档"}},
                       "required": ["base_id"]},
        "write": True,
    }, tool_merge)

    ctx.mcp.tool("archive_versions", {
        "description": "归档指定版本：移入 Workspace/System/Versions/<基条>/archived/ 永久保留"
                       "（可追溯、可再取回），主库与检索里不再出现。**写工具**：先出草稿，确认后落盘。",
        "parameters": {"type": "object",
                       "properties": {"base_id": {"type": "string"},
                                      "variant_ids": {"type": "array", "items": {"type": "string"},
                                                      "description": "要归档的版本 id 列表"}},
                       "required": ["base_id", "variant_ids"]},
        "write": True,
    }, tool_archive)
