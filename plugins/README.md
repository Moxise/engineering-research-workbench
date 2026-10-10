# plugins/ · 插件库（放这里就能用）

这是**统一插件库**（PLUGIN_SPEC §1 的「用户库」= `DATA_ROOT/plugins/`）。把插件丢进这个目录即可被发现：

```text
plugins/
├─ weather/                 ← 目录态：直接扫描加载
│  ├─ plugin.json           ← 唯一必需文件（字段见 docs/PLUGIN_SPEC.md §3）
│  ├─ backend.py            ← 可选：register(ctx) 入口
│  └─ web/panel.js          ← 可选：前端面板（必须自登记 window.ERWPanels）
└─ weather-1.0.0.zip        ← 单文件包态：自动解包到 plugins/weather/
```

常用命令：

```powershell
python -m core.plugins list            # 已发现 / 可用 / blocked / 冲突
python -m core.plugins check <id>      # 单个插件的校验 + 依赖 + 权限报告（不落盘）
python -m core.plugins verify          # 全库盘点
python tools/plugin_check.py           # 隔离体检：依赖方向单向、内核可脱离 app、零插件合法
```

约定（违反会被拦下并给出原因）：

1. **目录名必须等于 `plugin.json` 的 `id`**；
2. `routes` 写**相对路径**（内核挂到 `/api/plugins/<id>/`），不得写 `/api/...`；
3. `mcp_tools` 写**裸名**，对外名由内核加前缀 `p_<id>__<tool>`；
4. `storage.derived_db` 只允许 `System/Cache/<id>.sqlite`；
5. `permissions` 只能用已支持的权限（见 `core/plugins/manifest.py` 的 `KNOWN_PERMISSIONS`）；
6. 插件只经 `core_api` 与内核交互，**不得 import `core.*` 私有模块，也不得 import 别的插件的私有模块**；
7. 核心绝不依赖任何插件：零插件时工作台必须完整可跑（不变量 I1）。

> 当前阶段：内核侧的**发现 / 校验 / 依赖解析 / 执行（`register(ctx)`）**、前端面板管线
> （`GET /api/plugins` + `/plugins-file/<id>/<rel>` + 面板自登记 `ERWPanels`，含**顶栏槽位面板**与
> **无导航页 UI** `panel.mount`）、**图谱渲染接管**（`ERWGraphRenderers`）、**内核事件**（`ctx.events`）、
> **插件 MCP 工具接入内置 Agent**（`p_<id>__<tool>`，读工具直接执行、**写工具由内核统一走草稿确认流**）
> 都已可用。仓库里已有七个真插件：
> `focus`（专注计时，纯前端）、`rss`（科研资讯，后端路由 + 自带样式）、`weather`（天气，顶栏槽位 + 设置模态）、
> `billing`（用量计费，订阅 `llm.usage` 事件 + 数据命名空间认领）、
> `knowledge-graph`（知识图谱可视化：图谱页渲染接管 + 总览迷你图，纯前端、无后端）、
> `literature-reader`（**文献阅读工作区 v2.0.0**：PDF 阅读 + 批注 + 阅读区「笔记」tab（含 2 个 AI 工具）
> + 阅读区「AI」助手 tab——由原 literature-reader / litnote / reader-assist 三个插件按用户要求合并；
> 文献数据与文件服务仍在内核）、
> `floating-assist`（悬浮球 AI 助手：浮层槽位 `overlay`；含工具轨迹时间线、阅读中知识关联、
> 会话回看、写模式开关 UI、AI 助手人设编辑器）。
> **尚未实现**：MCP stdio 服务侧的插件工具、`settings_schema` 通用表单（插件目前自带设置 UI）、
> 后台任务（`ctx.jobs`）、`ctx.search.addSection`（RAG 的位置）、`ctx.kinds`（自定义知识类型）。
