# 版本管理（version-manager）

同一笔记的不同版本：**查看版本族 → 逐版对照（含来源）→ 按小节合并 → 归档 / 取回**。

- 入口：侧栏「研究 · 知识 → 版本」（停用本插件则入口消失）
- 后端：`backend.py`（路由 `/api/plugins/version-manager/*`；工具 `versions` / `merge_versions` / `archive_versions`）
- 前端：`web/panel.js` + `web/panel.css`

## 为什么数据模型不在这里

版本与来源**必须在内核的写入收口点**（`store.create_doc` / `store.update_doc`）处理，否则
界面、内核 Agent、MCP、插件四条写入路径里总有漏网的。所以：

| 归内核 | 归本插件 |
| --- | --- |
| 契约字段（`variant_of` / `variant_label` / `has_variants` / `origin_*`） | 页面与交互（族列表、对照、挑小节、归档/取回按钮） |
| 写入时记来源、分叉/冲突时先留一版 | 本插件自己的 HTTP 路由与 Agent 工具 |
| 版本逻辑引擎 `app/versions.py`（归族、分节合并、归档区） | —— |
| MCP 侧同名工具（`mcp/` 是内核侧） | —— |

本插件只经 `core_api` 的版本窗口读写（`version_overview` / `variant_family` / `merge_variants` /
`archive_variants` / `restore_variant`），符合 I3（插件只许 `from core_api import …`）。
