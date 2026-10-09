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
> （`GET /api/plugins` + `/plugins-file/<id>/<rel>` + 面板自登记 `ERWPanels`）、以及
> **插件 MCP 工具接入内置 Agent**（`p_<id>__<tool>`）都已可用。
> 仓库里已有两个真插件：`focus`（专注计时，纯前端）与 `rss`（科研资讯，含后端路由与自带样式）。
> **尚未实现**：插件**写**工具（声明 `write: true` 会被明确拒绝——写路径要走内核的草稿确认流，
> 那条链路还没有插件分支）、MCP stdio 服务侧的插件工具、后台任务（`ctx.jobs`）、
> 事件订阅（`ctx.events`）、`settings_schema` 通用表单、topbar 组件槽位。
