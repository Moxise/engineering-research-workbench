# 工程科研工作台 · 插件规范（打包 / 安装 / 依赖）

> 配套：[docs/SCOPE.md](SCOPE.md)（定位与功能分层）、[docs/REFACTOR_PLAN.md](REFACTOR_PLAN.md)（§6 插件化方案）。
> 一句话目标：**把插件放进统一插件库就能用；不能用的必须明确告诉你为什么，且绝不影响核心。**

---

## 0. 三条设计原则

| # | 原则 | 含义 |
| --- | --- | --- |
| P1 | **丢进去就能用** | 用户只需把「目录」或「单文件包」放进 `plugins/`；发现、校验、注册全自动，**不改代码、不重编译** |
| P2 | **打包隔离** | 每个插件自包含（manifest + 后端 + 前端 + 迁移 + 依赖声明），不共享可变文件；共享物只能走 `core_api` 或**前提插件** |
| P3 | **失败只伤自己** | manifest 不合法 / API 版本不兼容 / 依赖缺失 / 运行时抛错 → **只拒载或停用该插件**，核心与其它插件照常运行 |

---

## 1. 统一插件库：两个来源，一个入口

| 来源 | 目录 | 谁能写 | 用途 |
| --- | --- | --- | --- |
| **用户库**（统一入口） | `DATA_ROOT/plugins/` | 用户 | 自己装/删的插件；**你说的"统一插件库"就是这里** |
| **随包库**（bundled） | `ASSET_ROOT/plugins/` | 只能由发行版更新 | 官方附属插件（天气 / RSS / 专注计时 / 图谱 …），只读 |

- 同名 `id` 同时存在时 **ASSET 优先**（防止用户误改随包插件导致升级不一致），并在诊断里报提示。
- 开发态 `DATA_ROOT` = 仓库根 → 开发时就是仓库里的 `plugins/`（已被 `.gitignore` 放行、可入库）。
- 打包态 `DATA_ROOT` = exe 同级 → 与便携数据同处一地，符合现有便携约定（`app/paths.py:16-23`）。

**安装状态**记在 `System/plugins.json`（不放在插件目录里，避免插件写坏自己的清单）：

```json
{"schema_version": 1, "plugins": {
  "weather":  {"version": "1.0.0", "source": "bundled", "enabled": true,  "installed_at": "2026-10-09T18:00:00", "hash": "sha256:…"},
  "rag":      {"version": "0.9.3", "source": "user",    "enabled": false, "installed_at": "2026-10-10T09:00:00", "hash": "sha256:…"}
}}
```

> 目录决定「在不在」，`System/plugins.json` 决定「开不开」。

---

## 2. 插件包格式：目录态 与 单文件包态

| 形态 | 样子 | 生效方式 |
| --- | --- | --- |
| **目录态**（开发/源码） | `plugins/<id>/`（含 `plugin.json`） | 直接扫描加载 |
| **单文件包态**（分发） | `plugins/<id>-<version>.zip`（内含 `plugin.json` 在根） | **自动解包到 `plugins/<id>/`**：每个功能模块**一个独立文件夹、互不混用**（已定，见 §12） |

`plugins/<id>/` 的标准结构：

```text
plugins/weather/
├─ plugin.json          # 唯一必需文件
├─ backend.py           # 可选：register(ctx) 入口
├─ web/
│  ├─ panel.js          # 可选：export mount(ctx) / unmount()
│  └─ panel.css         # 可选：必须以 [data-plugin="weather"] 作用域
├─ migrations/          # 可选：自有数据迁移（NNNN_*.py）
└─ README.md
```

**解包规则（核心要求：每插件一个独立文件夹，绝不混用）**：

1. **先临时后原子**：解到 `plugins/.unpack-<id>-<version>/`，全部校验通过后**原子改名**为 `plugins/<id>/` → 任何时候都不存在"半解包"状态。
2. **一包一插件**：包内只能是一个插件的完整内容（清单在根）；一个包里塞两个插件、或把文件直接铺到 `plugins/` 根 → **拒载**。
3. **目录名 = manifest id**：解包目录必须是 `plugins/<id>/`，与 `plugin.json` 的 `id` 一致；不一致 → 拒载（避免"文件夹叫 A、插件自称 B"的混乱）。
4. **版本替换不合并**：`plugins/<id>/` 已存在且版本不同 → 旧目录**整体**移入 `System/Trash/plugins/<id>-<旧版本>/`，再放入新版；**禁止逐文件覆盖合并**。
5. **不覆盖用户手改目录**：若 `plugins/<id>/` 是你自己放的目录态插件（非由 zip 解出），同名 zip 只提示冲突，不自动覆盖。
6. **路径安全**：解包落点必须严格在 `plugins/<id>/` 内——拒绝绝对路径、`..` 穿越、符号链接逃逸。

---

## 3. manifest（`plugin.json`）完整字段

```json
{
  "id": "weather",
  "name": "天气",
  "version": "1.0.0",
  "description": "当前位置的实况天气卡片",

  "api_version": 1,
  "core_min": "v261010",

  "kind": "inprocess",
  "distribution": "bundled",
  "default_enabled": true,

  "entry": "backend.py",

  "permissions": ["net:http", "storage:own", "config:own"],

  "requires": {
    "plugins": [{"id": "literature-base", "version": ">=1.0,<2"}],
    "python": ">=3.10"
  },
  "provides": ["weather"],

  "nav": [{"id": "weather", "label": "天气", "mount": "web/panel.js"}],
  "routes": [{"method": "GET", "path": "forecast"}],
  "mcp_tools": ["weather_now"],
  "settings_schema": {"type": "object", "properties": {"city": {"type": "string"}}},
  "jobs": [{"id": "refresh", "interval_min": 30}],
  "events": ["doc.updated"],
  "storage": {"derived_db": "System/Cache/weather.sqlite"}
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 小写字母/数字/短横线；决定命名空间（路由、工具、存储、CSS 作用域） |
| `version` | ✅ | 语义化版本，用于依赖解析与升级判定 |
| `api_version` | ✅ | 插件所依赖的**内核 API 版本**；不匹配直接拒载（I7） |
| `core_min` | — | 最低内核版本提示（不满足时给出明确信息） |
| `kind` | ✅ | `inprocess`（默认）或 `process`（独立进程，见 §6） |
| `distribution` / `default_enabled` | — | 合起来就是「附属（bundled+true）」与「可选插件（optional+false）」的唯一区别 |
| `entry` | `process`/有后端时 ✅ | 后端入口文件 |
| `permissions` | — | 权限清单（§7），安装/启用时展示给用户 |
| `requires` / `provides` | — | 依赖与供给（§4） |
| `nav` / `routes` / `mcp_tools` / `settings_schema` / `jobs` / `events` | — | 扩展点声明（注册方式与命名空间见 REFACTOR_PLAN §6.3） |
| `nav[].slot` | — | **槽位面板**：声明 `slot`（当前支持 `topbar`）后该面板**不进导航**，而是画进内核提供的槽位容器（容器带 `data-plugin="<id>"`，样式按 §2 作用域）；入口脚本用 `ERWPanels.register({id, slot, renderSlot(container)})` 自登记。未知槽位会被拒载（`P019`） |
| `storage` | — | 自有派生数据路径，**只允许** `System/Cache/<id>.sqlite` 这一类 |

---

## 4. 依赖与「前提插件」

### 4.1 两类依赖

| 类型 | 声明 | 说明 |
| --- | --- | --- |
| **前提插件**（prerequisite） | `requires.plugins[]` | 被依赖方必须已安装且启用；它就是普通插件，只是**默认开**。例：`literature-base`（文献条目/PDF 能力）被"阅读区 AI 助手""术语流水线"共同依赖 |
| 内核 API | `api_version` / `core_min` | 与内核的契约版本；不匹配 → 拒载 |

### 4.2 加载规则（确定性）

1. **拓扑排序**：按 `requires.plugins` 做 DAG 排序后再注册；检测到环 → **整环拒载**并报错（不做"部分加载"）。
2. **版本消解**：同一 `id` 在库中**只允许存在一个版本**；出现多版本（目录 + 单文件包、或两个包）→ 不猜、直接报冲突并列出候选，由用户删掉多余的那个。
3. **缺失依赖**：某插件依赖的 `id` 未安装/未启用 → 该插件状态记为 `blocked`，在设置页显示「缺少前提插件：literature-base ≥1.0」，**核心与其它插件不受影响**。
4. **级联停用**：前提插件被禁用/卸载 → 依赖它的插件**自动一起停用**（不崩溃、不清数据），恢复前提插件后可一键恢复启用。
5. **顺序无关**（I9）：每个插件在独立 `try` 中注册；任何插件的注册失败都不阻断其它插件与核心。

### 4.3 前提插件的边界（重要）

前提插件**不得成为事实上的核心**：
- 它自己必须能在「核心 + 它」的最小组合下独立工作；
- 核心绝不允许依赖任何前提插件（I1：核心 + 零插件必须完整可跑）；
- 前提插件被禁用时，核心功能不得退化（依赖它的插件一起停用即可）。

---

## 5. 安装 / 启用 / 禁用 / 更新 / 卸载

| 动作 | 用户做什么 | 内核做什么 | 生效时机 |
| --- | --- | --- | --- |
| **安装** | 把目录或 `<id>-<version>.zip` 丢进 `plugins/` | 扫描 → 校验 manifest → 检查 `api_version`/依赖/冲突 → 记入 `System/plugins.json`（默认**不启用**，除非 `default_enabled: true`） | 后端需**重启**注册路由/工具；前端刷新即可见面板 |
| **启用** | 设置页点「启用」（或 CLI） | 校验 → 拓扑排序注册 → 写 `enabled: true` | 同上 |
| **禁用** | 点「禁用」 | 注销路由/面板/工具 → 级联停用其依赖者 → **保留数据** → 写 `enabled: false` | 同上 |
| **更新** | 用新版本替换目录/包 | 版本比对 → 跑 `migrations/` → 更新记录与哈希；`api_version` 不兼容则**拒绝并保留旧版** | 同上 |
| **卸载** | 点「卸载」 | 插件移入 `System/Trash/plugins/<id>/`；**数据默认保留**并提示（`Workspace/Plugins/<id>/`、`System/Plugins/<id>/` 是否一并删除由用户勾选） | 同上 |

**CLI（与设置页同一套逻辑，便于排障）**：

```powershell
python -m core.plugins list            # 已发现 / 已启用 / blocked / 冲突
python -m core.plugins check <id>      # manifest 校验 + 依赖与权限报告（不落盘）
python -m core.plugins enable <id>     # 启用（含级联检查）
python -m core.plugins disable <id>    # 禁用（含级联停用预览）
python -m core.plugins verify          # 全库体检：孤儿派生库、缺失依赖、版本冲突
```

> 与现有约定一致：**后端改动必须重启**（AGENTS.md §二.4）；前端面板刷新即生效。

---

## 6. 隔离：三层，按插件类型选

| 层 | 做法 | 适用 |
| --- | --- | --- |
| **命名空间隔离**（所有插件） | 路由 `/api/plugins/<id>/…`、工具 `p_<id>__<tool>`、存储 `Workspace/Plugins/<id>/`、`System/Plugins/<id>/`、`System/Cache/<id>.sqlite`、配置 `config/plugins/<id>.json`、CSS `[data-plugin="<id>"]` | 全部 |
| **代码隔离**（`inprocess`） | 只允许 `from core_api import …`；禁止碰 `core.*` 私有模块；hook 全部 `try/except + 超时`，连续失败自动停用 | 轻量插件（天气、RSS、计时、面板类） |
| **进程隔离**（`process`） | 插件自带解释器环境与依赖，通过本机 HTTP 与内核通信（`process: {port, python_env, health, model_dir}`）；内核缺包/服务未起时**降级**而非报错 | 重型插件（RAG、模型类） |

**「打包隔离」的落地含义**（对应你的要求）：每个插件的**代码、前端、迁移、依赖声明、数据命名空间**都自包含，安装/启停/卸载互不写对方文件；插件之间**只能**通过 ① `core_api` ② 前提插件的公开接口 交互，**不允许** import 彼此的私有模块。

**`core_api` 的公开面**（每加一项都是有意动作，语义写在这里）：

| 成员 | 语义 |
| --- | --- |
| `API_VERSION` | 内核 API 版本，与 `core.plugins.manifest.SUPPORTED_API_VERSION` 同源 |
| `plugin_dir(id)` | 插件自己的目录（只读代码 + 资源） |
| `system_dir(id)` / `workspace_dir(id)` / `cache_db(id)` | 插件的三个数据落点：`System/Plugins/<id>/`、`Workspace/Plugins/<id>/`、`System/Cache/<id>.sqlite` |
| `config_path(id)` / `read_config(id, default)` / `write_config(id, data)` | 插件自有配置 `config/plugins/<id>.json`（内核不解释其内容；写入是原子的） |
| `http_get(url, timeout, headers, limit)` | **出网的推荐方式**：取字节。带代理兜底——系统代理若是**回环地址且端口没人监听**（Clash/V2Ray 没启动），本次请求自动改直连，避免所有出网请求都撞 `WinError 10061`；远程代理不受影响，超时 / DNS 失败 / 非 2xx 照原样抛 |
| `data_root()` | 可写数据根。**只正当用于一次性迁移**（把内核时代写在别处、如 `System/Cache/*` 的数据认领进自己的命名空间）；日常请用上面的命名空间内助手 |
| `log(id, message)` | 带插件前缀的日志 |

### 6.1 前端接缝与公开数据 API（插件 UI 的接触面）

插件的前端脚本（`nav[].mount` / `panel.mount`）跑在内核页面里，但**不得改内核 DOM**（P14 红线）。需要的能力一律走下面这些接缝：

| 接缝 | 用途 |
| --- | --- |
| `window.ERWPanels.register({...})` | 侧栏导航页 / 顶栏槽位 / 设置页 tab / 阅读区 tab（见 §3 的 `nav[]`、`panel` 字段） |
| `window.ERWContract` | 七类 kind、类别词、`kind_marks`、关系的**只读**中文契约（`kinds/kindLabels/kindLabel/entityLabel/marks/relations/relationLabel`）。插件不要再各抄一份标签表 |
| `window.ERWMarkdown.renderInto(el, raw)` / `.normalizePaths(html)` | Markdown 渲染（marked + DOMPurify + hljs + mermaid/mathjax 按需）与 `/workspace-file/` 图片路径归一 |
| `window.ERWGraphRenderers.register({id, graph?, overview?})` | **图谱渲染接管**：内核渲染图谱页 / 研究总览迷你图时把画布交给接管者；插件缺席或 `enhance()` 抛错时内核回退自带 `drawGraph` |
| `window.erwFetch(url, init)` | 出网与访问内核 HTTP API（**不得**替换 `window.fetch`） |
| `window.erwVendor.load('mathjax'\|'mermaid')` | 重型库按需加载（本地优先、CDN 兜底） |
| `window.ERWDom.onChildList(cb, {root})` | 文档级 DOM 变更观察的唯一入口（内核合并成一个 observer） |
| `workbench:*` / `erw-*` 自定义事件 | 内核广播（如 `llm.usage`）与模块间解耦通信 |

**公开数据 API**（只读，插件可直接消费）：`/api/docs`、`/api/docs/<id>`、`/api/statuses`、`/api/projects`、`/api/dashboard`、`/api/graph`、`/api/graph/overview`、`/api/graph/neighborhood`、`/api/search`、`/api/todos`、`/api/literature`。写路径一律走内核草稿闸门，插件**不得**直写 `Workspace/`。

**渲染接管契约**（`ERWGraphRenderers`）：

- 形如 `{id, graph: {async enhance(canvas, ctx)}, overview: {async enhance(canvas, ctx)}}`；同一 `id` 不得重复注册，至少声明一个作用域。
- 内核在**页面 markup 就绪后**调用 `enhance(canvas, ctx)`（`ctx = {route, host, contract}`）并 `await`：**resolve = 已接管**（内核不再画兜底图）；**throw = 没接管**（内核打印原因并回退 `drawGraph`）。
- 取消与失败要分清：页面已切走 / 画布已被更新的一次渲染替换 → **静默 `return null`**（那不是错误，别往控制台丢 error）；取数失败 → **throw**。
- 实例生命周期归插件自己：内核只在进入页面时喊一次，插件自行在 `hashchange` 上释放。

---

## 7. 安全与校验

安装/启用时的校验清单（任一不过 → **拒载并说明原因**）：

1. `plugin.json` 存在且能通过 schema 校验（`id` 合法、`version` 语义化、`api_version` 为整数）；
2. `api_version` 与内核兼容；`core_min` 满足；
3. 依赖可满足、无环、无同 id 多版本冲突；
4. 单文件包解包安全：拒绝绝对路径、`..` 穿越、符号链接逃逸（只允许包内相对路径，且落点必须严格在 `plugins/<id>/` 内，见 §2 解包规则）；
5. 可选完整性校验：包内或其旁提供 `.sha256`，与 `System/plugins.json` 记录比对；
6. **权限清单展示**：`permissions` 会在安装/启用时用人话列出（如「可访问网络」「可写入自己的数据目录」）；声明了未支持权限 → 拒载；
7. 冲突检查：`id`、路由前缀、工具名前缀、CSS 作用域与已启用插件重复 → 拒载。

**失败行为统一为**：该插件状态 `rejected`/`blocked` + 原因 + 修复建议；**核心零影响**（I4），并在 `System/plugins.json` 与设置页健康面板同时可见。

---

## 8. AI 工具的扩展路径（默认最小集 → 按需添加）

AI 的工具**只有三种来源**，且核心默认只开第一种：

| 来源 | 默认 | 命名 | 说明 |
| --- | --- | --- | --- |
| ① 核心内置 | **开（不可关）** | `kb_search`、`kb_read`、`kb_create_entry`、`kb_update_entry` | 读库 + 出草稿等确认（SCOPE §5.1） |
| ② 插件注册的工具包 | 关（可勾选） | `p_<plugin>__<tool>` | 把**已经存在**的工作台 MCP 25 个工具按主题打包成官方工具包，见下 |
| ③ 外部 MCP 服务器 | 关（需显式确认） | `mcp_<server>__<tool>` | 在 `config/mcp.json` 里声明 `mcpServers`（stdio/http）即可接入任意第三方工具 |

**②的三个官方工具包**（直接复用 `mcp/` 里已有的实现，不重写）：

| 工具包 | 含工具 | 用途 |
| --- | --- | --- |
| `tools-kb-admin` | `kb_constraints`、`kb_list_entries`、`kb_get_entry`、`kb_check_entries`、`kb_rename_entry`、`kb_change_kind`、`kb_delete_entry` | 命名体检、改名、改 kind、删除（写类仍走草稿确认） |
| `tools-ws-ops` | `ws_info`、`ws_tree`、`ws_list_projects`、`ws_project_detail`、`ws_create_project`、`ws_update_project`、`ws_dashboard`、`ws_activity`、`ws_index_status`、`ws_reindex`、`todo_list`、`todo_create`、`todo_update`、`kb_graph`、`lit_export_bibtex` | 项目/待办/索引/图谱/导出 |
| （未来）`tools-rag` | `kb_retrieve` | 语义检索（随 RAG 插件） |

**③的安全提示**：外部 MCP 服务器能读你的知识库，因此**默认关闭**，启用时展示它声明的能力并需一次人工确认；工具名一律加 `mcp_<server>__` 前缀避免撞名。

---

## 9. 「丢进去就能用」的 5 个前提（速查）

| # | 条件 | 不满足时 |
| --- | --- | --- |
| 1 | `plugin.json` 合法（含 `id`/`version`/`api_version`/`kind`） | `rejected` + 指明哪个字段 |
| 2 | `api_version` 与内核兼容 | `rejected` + 提示升级内核或换插件版本 |
| 3 | 依赖（前提插件）已安装并启用 | `blocked` + 列出缺哪个、要什么版本 |
| 4 | 无同 id 多版本 / 无命名空间冲突 | `conflict` + 列出候选，让你选留哪个 |
| 5 | 声明的权限都被内核支持 | `rejected` + 列出不支持的权限项 |

> 默认**不启用**（除非 `default_enabled: true`）；发现后出现在设置页「可用插件」里，一键启用。

---

## 10. 打包期的依赖审计与前置提示（约束）

**规则**：任何功能被打包成插件时，**必须先做依赖审计**；只要存在对「前提插件」的依赖，就**必须显式声明并提示**，不允许隐式共享。

打包自检 `python -m core.plugins pack <feature> --check` 扫描四类引用：

| 扫描项 | 发现什么 | 处理 |
| --- | --- | --- |
| Python import（`inprocess` 插件） | 引用了别的插件模块 / `core.*` 私有模块 | 前者 → 必须声明为前提插件依赖；后者 → 必须改走 `core_api` |
| 路由 / 工具 / 事件注册 | 注册进别的插件命名空间，或依赖对方提供的钩子 | 声明依赖 |
| 存储访问 | 读写别的插件的数据目录 / 共享 DB 表 | **禁止**：改为对方公开接口或 `core_api` |
| 前端资源 | 引用别的插件的 JS/CSS/DOM 钩子 | 声明依赖（前提插件须提供稳定的 `ctx` 接口） |

三种结论：

1. **无依赖** → 通过，产物标注「无前置依赖」；
2. **有依赖且已声明**（`requires.plugins` + 对方 `provides`）→ 通过，产物生成人可读的 `DEPENDENCIES.md`（id / 版本区间 / 缺失时的表现）；
3. **有依赖但未声明** → **打包中止**（不是警告），提示「检测到对 `X` 的依赖：请声明 `requires.plugins`，或先把 `X` 抽成前提插件」——避免把隐式依赖带给用户。

**安装 / 启用时必须提示**（同一信息两处出现）：

- 设置页：「需要前提插件 `literature-base` ≥1.0 —— 未安装〔一键安装〕/ 已装未启用〔一键启用〕」；
- CLI：`python -m core.plugins check <id>` 输出同样的依赖树与状态。

**提示分级**：

| 级别 | 含义 | 行为 |
| --- | --- | --- |
| `error` | 缺了它功能根本不可用 | 该插件 `blocked`，不允许启用 |
| `warn` | 缺了会**降级**（例：没装 RAG → 语义检索退回关键词） | 允许启用，但启用前明确告知降级后的表现 |

---

## 11. 功能提取的等价性要求（约束：原功能与效果不变）

**规则**：把已有功能「提取」成插件**不是重写**——对外可见的功能与效果必须逐项保持不变；任何有意变化都要显式声明理由，否则视为回归。

### 11.1 迁移前：冻结「行为基线」

| 契约面 | 要抓的东西 |
| --- | --- |
| HTTP | 路由全表（方法 + 路径 + 参数 + 响应形状）与状态码 |
| 工具 | MCP 工具表（`--selftest`）与内置 AI 工具表（`agent_tools.TOOL_NAMES`）的名称、参数、返回结构 |
| UI | 导航项/面板位置、DOM id 与 `window.ERW*` 钩子、快捷键、文案、空态与错误提示 |
| 存储 | 文件路径与格式（`System/Cache/*.sqlite`、`config/*.json`、`Workspace/**` 有无变化） |
| 配置 | `config/app.json` 中该功能用到的键与默认值 |

### 11.2 迁移后：逐项比对，产出《迁移等价性报告》

每项标 `一致` / `有意变化（附理由）` / `回归`；**出现「回归」必须修掉才能合并**。报告随该插件的迁移提交一起入库（放插件 `README.md` 末尾或 `docs/migrations/`）。

### 11.3 兼容与降级

- **数据兼容**：默认不改存储格式与路径；确需改动 → 插件自带 migration（幂等 + `--dry-run` + 可回滚），且**插件被禁用时核心仍能正确忽略旧数据**（不误删、不报错）。
- **禁用等价性**：插件禁用后，表现必须等于「这个功能从未存在」——不残留路由 / 工具 / 面板 / 报错，也不损坏数据。
- **体验不变**：用户不应因为「它变成插件了」而重新学习操作（按钮位置、快捷键、交互手感保持一致）。

### 11.4 验收手段（可执行）

| 手段 | 做法 |
| --- | --- |
| 契约 diff | 迁移前后各抓一次路由表 / 工具表 / 导航表，做集合 diff |
| 固定用例回放 | 同一批只读请求与操作序列比对响应（注意 P28：读也要写权限，基准测试应在服务停时跑，或用 `?mode=ro` 连接） |
| 界面对照 | `tools/shot_page.py` 迁移前后各一张 1x 裁剪图对照 |
| 人工清单 | 快捷键、拖拽、空态、错误提示逐条勾选 |

> 这四项是**每个功能插件化的准入门槛**。也正因如此，A13（取回 `tools/kb_smoke.py` 与 `tools/shot_page.py`）是整条插件化路线的前置条件。

---

## 12. 已定（原「待定两点」）

| # | 问题 | 决定 |
| --- | --- | --- |
| **P-A** | 单文件包扩展名 | ✅ **先用 `.zip`**，后续再改（将来可加 `.erwp` 别名，两种都要能识别） |
| **P-B** | 是否自动解包 | ✅ **自动解包**，但**每个功能模块一个独立文件夹、不能混用**——规则见 §2「解包规则」 |
