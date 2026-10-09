# 工程科研工作台 · 精简与插件化重构方案

> 依据：2026-10-09 对仓库代码与 `Workspace/` 真实数据的三份只读审计（87 条路由全表、前端 218 文件全表、数据契约程序化 diff + SQLite 只读实测），复现脚本留在 `.scratch/tmp/audit_*.py`。
> 每条结论附 `file:line` 或实测值；无法从代码断定的标「待确认」，不猜。
> 目标：把工作台收敛成「科研数据梳理与汇总」内核，其余功能以可增删插件形式存在，且插件不得影响内核。

---

## 0. 摘要

三件事按顺序做，每件都能独立验收：

| 步骤 | 要解决的问题 | 核心动作 | 收益 |
| --- | --- | --- | --- |
| **① 精简** | 功能面已超出「数据梳理与汇总」；前端 13 个补丁文件靠加载顺序互相覆盖 | 划内核边界，把非内核功能移出核心启动路径 | 首屏资源 8.2 MB → < 1 MB；补丁 3987 行 → 主题模块 |
| **② 契约归一** | 同一套规则 3 处实现、2 套校验、5 处版本号；已产生越界 status、越界 mark、幽灵项目节点 | 单一契约源 + 生成物 + 体检/迁移框架 | 消灭「同一数据两套规则」 |
| **③ 插件化** | 新功能只能改核心；RAG 已验证「可选组件 + 降级」可行 | 固化 manifest/扩展点/隔离不变量，以 `rag/` 为模板 | 内核零插件可跑，插件可自由增删 |

**代码体量实测**

| 层 | 文件数 | 行数 | 体积 |
| --- | --- | --- | --- |
| 根 Python（`server.py` 711 行 + `client.py` 等） | 3 | 1009 | 54 KB |
| `app/`（HTTP 后端 + 数据层） | 25 | ≈8.4k | 380 KB |
| `mcp/`（Agent 用的 stdio MCP 服务） | 8 | 2255 | 109 KB |
| `rag/`（语义检索，独立进程） | 17 | — | 98 KB |
| `tools/`（运维脚本） | 12 | 2008 | 103 KB |
| `web/` 非 vendor 代码 | 25 | ≈7.0k | 659 KB |
| — 基础 5 文件 | 5 | 2992 | 376 KB |
| — 版本化补丁 | 13 | **3987** | 266 KB |
| `web/vendor/`（92.6% 体积，本地专用） | 193 | 27888 | **8.2 MB** |
| `server.py` 路由 | — | **87 条**（36 GET /api + 42 POST + 7 DELETE + 文件服务 2） | — |

**数据现状实测**

| 项 | 值 |
| --- | --- |
| 知识条目 | **199 条**（Notes 90 / Literature 67 / Experiments 25 / Journals 6 / Ideas 4 / Summaries 4 / Milestones 3），与索引 `documents` 199 行一致；另有 1 个 md 在 `Knowledge/Exports/` 不参与索引 |
| 关系边 | `document_links` 395（可解析 393 / 不可解析 2）、`graph_edges` 1854 |
| 状态文件 | `projects.json` 4 项目、`todos.json` 3 条、`activity.jsonl` **946 行**、`AgentChats/` 102 文件（69 草稿 + 24 回收） |
| 派生数据 | `index.sqlite` 37.4 MB + WAL 22.4 MB、`rag.sqlite` 72.6 MB（12,972 块）、损坏的冲突副本 7.1 MB |
| 同步冲突残留 | 5 个（`activity`/`migration`×2/`chat`/`index` 各一） |

---

## 1. 现状 · 架构

### 1.1 运行时拓扑

```text
                    ┌─────────────────────────── 浏览器 SPA（无构建步骤）──────────────────────────┐
                    │ web/index.html  手写装配：12 个 <link>(:11-22) + 11 个 <script>(:105-115)     │
                    │   全部 defer，顺序有语义（见 §3-P14）                                        │
                    │   导航不是 HTML：index.html:51 只留空 <nav>，条目由 app.js:49-60 NAV_GROUPS 生成│
                    │   vendor 8.2 MB：mermaid 2.57 + mathjax 2.11 + pdfjs 3.36（:35-39 无条件 defer）│
                    └───────────────────────────────────┬───────────────────────────────────────┘
                                                        │ JSON HTTP（87 条路由）
                    ┌───────────────────────────────────▼───────────────────────────────────────┐
                    │ server.py · ThreadingHTTPServer（单进程，stdlib-only，711 行）              │
                    │   GET :191→handle_api_get(:259) · POST :208→handle_api_post(:400)          │
                    │   DELETE :223 内联分发（无 handle_api_delete）                              │
                    │   唯一 SSE：POST /api/agent/send（:139-173）                                │
                    │   文件服务：/workspace-file/<rel>(:637) · 静态+SPA 兜底(:619,:625) · PDF Range(:592)│
                    └───┬───────────────────┬───────────────────────┬───────────────────┬─────────┘
                        │                   │                       │                   │
              ┌─────────▼─────────┐ ┌───────▼────────┐ ┌────────────▼───────┐ ┌─────────▼─────────┐
              │ app/ 数据与业务层  │ │ app/ 派生索引层 │ │ app/ Agent 层       │ │ rag/ 语义检索      │
              │ store(1190)       │ │ indexer(9,门面) │ │ agent(1004)        │ │ 独立进程 127.0.0.1 │
              │ workspace(380)    │ │ perf_index_db   │ │ agent_tools(420)   │ │ :8770（GPU 常驻）   │
              │ config(666)       │ │  core(505)      │ │ billing(602)       │ │ 缺 rag/ 时降级     │
              │ projects(546)     │ │  query(483)     │ │                    │ │ 走 HTTP 调 8770    │
              │ literature(830)   │ │  runtime(211)   │ │                    │ │                    │
              │ todos(90) rss(166)│ │  graph(270)     │ │                    │ │                    │
              │ weather(109) ...  │ │ SQLite 9 表     │ │                    │ │                    │
              └─────────┬─────────┘ └────────┬───────┘ └────────────────────┘ └───────────────────┘
                        │                    │
                        ▼                    ▼
              Workspace/（唯一事实来源）    System/Cache/（派生，可重建）
              Markdown + frontmatter        index.sqlite 37.4 MB + WAL 22.4 MB / rag.sqlite 72.6 MB

                    ┌───────────────────────────────────────────────────────────────────────────┐
                    │ mcp/ · stdio MCP 服务（面向外部 Agent，26 个工具）                           │
                    │   bridge.py:37 惰性 import app.{activity,config,indexer,projects,search,   │
                    │   store,todos,workspace} —— 复用同一套读写，不重实现文件层（286 行门面）     │
                    │   constraints.py + naming.py —— 但**契约与校验是另写一套**（见 §3-P1/P2）    │
                    └───────────────────────────────────────────────────────────────────────────┘
```

### 1.2 打包与路径边界（决定插件能放哪）

| 事实 | 证据 | 对插件化的含义 |
| --- | --- | --- |
| onefile 打包，入口 `client.py` | `build_client.bat:19` | 内核是单进程 |
| `web/` 以 data 形式**打进 exe** | `ResearchWorkbench.spec:8` | 插件前端资源**不能**放 `web/`，必须从磁盘加载 |
| `app/` 冻结进 PYZ 归档 | `spec:17` | 插件后端**不能**是冻结包内模块，必须运行期从 `plugins/` 动态载入 |
| `DATA_ROOT` = exe 同级；`ASSET_ROOT` = 解压目录 | `app/paths.py:16-23` | 插件根应挂 `DATA_ROOT` → 开发态与便携 exe 共用一套 |
| 原生外壳持有窗口状态与 WebView profile | `client.py:23,75,93,115-125,148-153` | `window-state.json` 不属前端，不经 HTTP |

**结论**：插件目录必须是 `DATA_ROOT/plugins/<id>/`，由运行期 `importlib` 从文件路径加载；任何「把插件写进 `app/` 或 `web/`」的方案在打包后都不可用。

### 1.3 功能面清单（按路由数排序，实测）

| 功能 | 路由数 | 主要代码 | 使用痕迹（2026-10-09） |
| --- | --- | --- | --- |
| 文献与 PDF 工作区 | **20** | `literature.py`(830)、`web/literature.js`(658 行)、vendor/pdfjs | 67 条文献、56 篇 PDF 入库 |
| Agent 对话 | **14** | `agent.py`(1004)、`agent_tools.py`(420)、`web/v260930-floating-agent.js`(1145 行) | `agent_chat` 66；会话 102 文件 |
| 知识条目 CRUD | 9 | `store.py`(1190)、`perf_index_query/runtime/core` | `doc_update` 707 / `doc_create` 142 行 |
| 系统维护与本地文件 | 7 | `workspace.py`、`projects.py`、`config.py` | — |
| 项目 | 6 | `projects.py`(546) | 4 个项目 |
| 工作区信息与仪表盘 | 6 | `workspace.py`、`perf_index_*` | — |
| 知识图谱 | 5 | `perf_index_graph.py`(270)、`v260922-graph-performance.js`(307 行) | 依赖 mermaid 2.57 MB |
| 计费 | 5 | `billing.py`(602)、`v261008-billing.js`(212 行) | 账本 57 行，最后写入 10-08 14:23 |
| Todo | 4 | `todos.py`(90) | 3 条待办 |
| 配置 | 3 | `config.py` | — |
| 检索 / RAG | 3 | `server.py:43-92` 代理 + `rag/` | 语料 12,972 块 |
| 天气 | 2 | `weather.py`(109) | weather.json 最后写入 **10-09 12:42（在用）** |
| RSS 资讯 | 1 | `rss.py`(166) | rss_cache 最后写入 **10-09 09:10（在用）** |
| **专注计时** | **0** | **只有前端**：`app.js:482-499` + localStorage `focusMinutes/breakMinutes` | 无模块、无路由 → 最易插件化 |

---

## 2. 现状 · 数据结构

### 2.1 知识条目（唯一事实来源）

- 位置：`Workspace/Knowledge/<KindDir>/<id>.md`，扁平存放，文件名即 `<id>.md`。
- 实测：**199 条**，与索引 `documents` 199 行一致（另有 1 个 md 在 `Knowledge/Exports/`，不参与索引）。
- 契约（`kb_constraints topic=schema`）：字段序 22 项 `id, kind, title, created, updated, status, project, projects, tags, kind_marks, record_date, due, added_date, summary_type, pinned, authors, year, venue, doi, url, cite_key`；`id/kind/created` 不可变；CREATE vs UPDATE 差集 = `{attachment}`；`attachment` **只在 UPDATE 列表、不在字段序**（契约自身不一致）。
- 写入顺序 `store.py:207-211` 与 `mcp/constraints.py:230-233` 逐项相等；**未列入的键靠 `sorted(meta.keys())` 兜底**（`store.py:213`）——`project_id`/`project_ids` 正是靠这条才没被丢。
- 七类矩阵（`topic=kinds`）：每类独立目录、标题前缀、状态机、日期字段、正文骨架。kind→目录映射在 `store.kind_dir_map()` 与 `mcp.constraints.KINDS` 间**程序比对完全相等**（但顺序不同）。
- status 词表按 kind 分（7 组）；`kind_marks` 10 个合法 id，实测分布 knowledge 85 / synthesis 7 / method 109 / question 7 / thinking 11 / architecture 15 / experiment 34 / data 19 / model 19 / principle 17。

**真实样本**（`Workspace/Knowledge/Experiments/note-20260923111042-bb9210.md:1-15`）：

```yaml
id: "note-20260923111042-bb9210"      # ← id 前缀是 note
kind: "experiment"                     # ← 声明自己是 experiment
title: "实验-GEO 单帧经典检测（1.3g）"   # ← 标题前缀是 实验-
project: "红外-可见光天基动目标识别与跟踪"
projects: ["红外-可见光天基动目标识别与跟踪"]
record_date: "2026-10-08"
project_id: "proj_a0af8ee9d4db"        # ← 契约里没有这两个字段
project_ids: ["proj_a0af8ee9d4db"]
```

**关系层**：不写 `relations` 字段，正文「关联」小节的 WikiLink 决定关系类型（`依据的知识`→uses-knowledge、`用到的数据`→uses-data、`引用文献`→cites、`同系列实验`→series、`上一环节`/`下一环节`→chain-prev/chain-next、`产出与汇总`→produces，未命中记 `wikilink`）；`store.py:77-132` 与 `mcp/constraints.py:267-284` 的 8 类关系程序比对相等；物化到 `document_links`（395 行），解析策略先 id 精确后 title.casefold（`perf_index_core.py:188-198`）。

### 2.2 System 状态文件

| 文件 | 结构 | 字段 | 写入方 |
| --- | --- | --- | --- |
| `System/projects.json` | JSON 数组（4 条） | `id, name, description, status, created, updated` | `projects.py:22-34,48-49` |
| `System/todos.json` | JSON 数组（3 条） | `id,title,project,due,priority,done,created,updated`（**`project_id` 仅 1/3 条有**） | `todos.py:32-36`；`project_id` 另由 `perf_index_runtime.py:77-97` 写 |
| `System/activity.jsonl` | 追加型 JSONL，**946 行** / 228 KB，无 BOM | 全行字段并集**恰为 7 个**：`timestamp,type,ref,kind,title,project,weight`；5 类：`doc_update 707 / doc_create 142 / agent_chat 66 / doc_delete 27 / todo_create 3`；代码可发但从未出现：`knowledge_export`/`bibtex_export`/`project_create`/`todo_update`/`todo_done` | `activity.py:20-42`（唯一写入点） |
| `System/schema.json` | 对象 | `workspace_schema_version:3, index_schema_version:3, updated` | `perf_index_db.py:77-98` |
| `System/migration.json` | 对象 | `performed_at, mode, sources_found, copied_count, copied[], history[]`（留末 30，当前全 0）；另有 2 个 sync-conflict 副本 + 1 个 `migration-冲突-*.json` | `workspace.py:172-225` |
| `System/AgentChats/` | 目录（102 文件） | `chat-<hex12>.json`：`{id,title,created,updated,messages[]}`；消息字段 `id,role,content,created,refs,images,request_preset,…`——**`refs`/`images` 是字符串化 JSON**；会话级 `archived` **只读不写**（静默回退 False） | `agent.py:35-50` |
| `System/billing/` | JSON + JSONL | `prices.json`（`schema_version:1, currency, unit, fx, models{}, plans{}`）、`ledger.jsonl`（**57 行 / 19 字段**，只增不改） | `billing.py:109-130,191-220,402` |

### 2.3 派生索引（SQLite，`System/Cache/index.sqlite`）

**表族与实测行数**（DDL `perf_index_db.py:101-213`；`trigger` 数 = 0）

| 表 | 实测行 | 关键列 / 索引 |
| --- | --- | --- |
| `meta` | 5 键 | `schema_version=3`、`last_sync`、`todos_signature`、`activity_offset`、`fts_backfill_pending` |
| `documents` | **199** | 27 列；4 索引（kind+updated、status、kind+due、updated） |
| `document_projects` | **178** | `doc_id, project_name, project_id`，2 索引 |
| `document_tags` | **1178** | 1 索引 |
| `document_marks` | **325** | 1 索引 |
| `document_links` | **395** | `doc_id, token, role`；role：wikilink 222 / uses-knowledge 52 / cites 50 / series 32 / uses-data 25 / produces 7 / chain-prev 4 / chain-next 3 |
| `graph_edges` | **1854** | 无 FK；tag 1178 + wikilink 325 + project 178 + typed 边… |
| `todos_index` | 3 | 2 索引（`done,due` / `project_id,project`） |
| `activity_daily` | 30 | `PK(date,type)`，无显式索引 |
| `documents_fts` | **199** | FTS5 `(doc_id UNINDEXED, title, body, tags, projects, seg)`，`seg` 存中文 bigram，**只有 `seg` 真正参与检索** |

- **版本号散落 5 处独立演进**：`perf_index_db.py:13-14`(3/3)、`System/schema.json`(3/3)、`config.py:20`(=2)、`billing.py:31`(=1)、`rag.sqlite meta`(=1)；`schema.json` 与库内 `meta.schema_version` **互不校验**。
- **无通用迁移**：4 条迁移路径内联在 `_init_db`——① 版本号覆写；② `documents` 缺列 → `ALTER TABLE ADD COLUMN` 并触发全量重建（`:220-224`）；③ `document_links` 缺 `role` → **DROP 后重建**（`:226-236`）；④ FTS 分词器变更 → **DROP `documents_fts` 重建** + `fts_backfill_pending`（`:238-263`）。唯一「重建」是删库文件后 `initialize(force=True)`（`perf_index_core.py:430-439`）。
- **派生链三层且已落后**：`.md`（真值）→ `index.sqlite` → `rag.sqlite`；`rag meta.source_index` 指向 index.sqlite，但 `built_at=10-09T12:46` vs index `last_sync=10-09T14:03`（**落后 1h17m**）；`chunks` 12,972 行与 `documents` 199 行无 FK。
- **磁盘实测**：`index.sqlite` 37,433,344 B + `index.sqlite-wal` 22,425,192 B + `rag.sqlite` 72,552,448 B + `index-冲突-Moxise_Win11.sqlite` 7,086,080 B（**已损坏到无法打开**）。
- 物理隔离：RAG 只读 `index.sqlite`（`rag/__init__.py:14`）；`Workspace/.stignore` 仅一行 `System/Cache/`。

### 2.4 其它持久化

| 载体 | 结构要点 | 备注 |
| --- | --- | --- |
| `config/app.json` | `app_name/subtitle/host/port/auto_open_browser/workspace`、`weather.*`(5)、`ui.*`(6)、`academic_profile.*`(5)、`workspace_migration.*`(2)、`llm.{enabled,system_prompt,vision_enabled,assist,personas[]}` | **`literature.*` 段未进 `DEFAULT_APP_CONFIG`**（`config.py:85-124`），而 `literature.py:31,49` 读 `pdf_dir`/`note_images_dir` |
| `config/secret.json` | `{schema_version:2, active_profile_id, profiles[], migrated_at}`；profile 19 字段含 `base_url/api_key/headers/timeout/...` | 遗留 `config/secrets.json` 仍被两处按不同语义读（`config.py:140-167` 注环境变量、`:19,311` 读 legacy api_key） |
| `config/rss.json` | `{sources[]×9, max_items_per_source:12}` | 契约默认仅 3 源（`config.py:126-133`） |
| `Knowledge/Literature/Index/library.json` | `{version:1, items[56]}`；item 含 `doc_id,title,…,bibtex,reading_status,categories,tags,projects,favorite,filename,sha256,page_count,last_page` | **`categories`/`tags`/`projects`/`favorite` 存的是 Python repr 字符串**（`"[]"`、`"['S 学习阶段文献',…]"`、`"False"`）；`reading_status` 词表 `未读/在读/已读` 与 frontmatter 的 `待阅读/阅读中/已精读/已归档` **是第三套词表** |
| `System/Cache/weather.json` | TTL **600 s**；`{timestamp,key,data{…}}`，`key` 里重复存了一份配置 | `weather.py:25,58,105-108` |
| `System/Cache/rss_cache.json` | `{timestamp,updated,items[72],sources,errors,stale,…}` | 失败时用 stale 覆盖但不落盘（`rss.py:161-165`） |
| `window-state.json` | `{maximized,width,height}` | **唯一生产者与消费者都是 `client.py`**（`:23,75,93,153`），不经 HTTP |

---

## 3. 结构问题清单（每条都有证据）

| # | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| **P1** | **同一套契约 3 处实现**：`store.py`（kind→目录/前缀/状态机/日期/骨架）、`mcp/constraints.py`（同矩阵文本副本）、`kb_naming.py`（**精简且过期**副本） | `store.py:26,36,46,69`；`mcp/constraints.py:25,103`；`kb_naming.py:16-23` | 任一处更新，另两处漂移 |
| **P2** | **两套命名校验且规则互相矛盾**：MCP 走 `mcp/naming.py`（T000–T022）；应用内 Agent 走 `kb_naming.py`，对 `experiment` 直接放行 | `kb_naming.py:66-68`「未知条目类型 experiment，跳过命名校验」；`kb_naming.py:26` 认「实验」类别词 vs `mcp/naming.py:194-199` 判 `T020 error` | 同一条目两层结论可能相反；Agent 可用任意标题建实验条目，且 `category_mark` 对非 note 返回空（`:126-129`）→ 缺契约强制的 `experiment` 标记 |
| **P3** | **id 前缀与 kind 脱钩且不可修**：契约称 `id={kind}-{ts}-{hex6}`，实际 25 条 experiment 的 id 全是 `note-*`；`kb_change_kind` 明确「id/created 不变」 | §2.1 样本；`mcp/bridge.py:104-108` | 以 id 前缀推断类型的一切逻辑都错 |
| **P4** | **一个项目关系存 4 个字段**：`project`/`projects`（名）+ `project_id`/`project_ids`（id），后两者不在契约；索引里另有 `documents.project/project_id/projects_json/project_ids_json` 4 列 + `document_projects` 三元组 | 样本 `:8-9,14-15`；`perf_index_db.py:125-128,144-152` | 冗余 + 同步面扩大 |
| **P5** | **Agent 建档能力缺口**：只读 `kind/title/body/tags/projects/kind_marks`，不收 `status/record_date/due/added_date`；MCP 版支持 | `agent_tools.py:205-211`、spec `:316-325` vs `mcp/README.md:132-143` | 经 Agent 建的 journal/summary/experiment/milestone/literature **缺法定日期**；spec 类别词仍含已废弃「实验」（`:317`） |
| **P6** | **派生数据散落与不可回滚**：5 处版本号；`document_links`/`documents_fts` 迁移是 DROP 重建；无 down-migration；冲突副本 7.1 MB + WAL 22.4 MB 常驻 | §2.3 各条 | 升级无单一入口；迁移不可回滚 |
| **P7** | **前端靠加载顺序互相覆盖**：13 个补丁 3987 行 > 基础 2992 行；`index.html:105-115` 手写顺序 | `web/index.html`；实测行数 | 无法按功能增删；一处顺序错就坏 |
| **P8** | **文档口径落后于代码**：`mcp/README.md:7` 写 24 工具、`:81` 写「六类条目矩阵」，实际 26 工具 / 7 类；`docs/ARCHITECTURE.md:71-174` 已是逐版功能流水 | 同上；CHANGELOG | 规范文档不再可作事实来源 |
| **P9** | **`rag/` 已是事实上的插件**：独立进程、独立 DB、独立模型目录、缺失即降级、自带 eval 与自检 | `server.py:39-92`、`mcp/tools_workspace.py:217`、`run_rag_service.bat` | 插件化不必从零发明 |
| **P10** | **临时空间无上限**：`.scratch` 已 6461 文件 / 253.7 MB（`pycache` 4284 文件、35.7 MB index 快照）；启动清理未触发（`workbench.log` 停在 10-08 16:12 → 工作台未重启） | 实测 | 需体积上限 + 目录白名单，不只按时间清理 |
| **P11** | **死代码 / 半死代码**：`app/project_bridge.py`(52 行) 全仓零引用；`app/search.py`(43 行) 只被 `mcp/bridge.py:37`、`tools/self_check.py:14` 用，**server.py 不用** | 内容级 grep | 阅读成本与误改风险 |
| **P12** | **层级倒置**：`perf_index_query.py:7` 导入期依赖整个 `agent`（LLM）模块，只为 `:460/:466` 调 `agent.list_sessions()`；并跨模块调私有函数 `store._doc_from_path`(`:135`)、`store._academic_progress`(`:411/:420`) | 同上 | 索引查询层拖进 LLM 层，无法独立裁剪/测试 |
| **P13** | **导入期副作用**：`config.py:665-666` 在模块作用域跑 `load_secrets()` + `reload_all()`，后者在迁移路径会**写盘** `secret.json`/`app.json`（`:495,:509`） | 同上 | `from app import *` 即可读写用户配置 |
| **P14** | **base 与补丁互相硬依赖**：`app.js:585` 消费 `window.ERWFabTimeline`、`app.js:1307` 消费 `window.ERWBilling`、billing 在 `app.js:59/67/169/1305-1308` 硬编码；`v260922-performance.js:24` **全局替换 `window.fetch`** 且排在 `app.js` 之前（`:105` vs `:106`）；两个 canvas 先画后弃（`app.js:693/1261` vs 补丁 `:181/:332`）；`localStorage.graphKinds/graphRelations` 由 base 与补丁各写一次 | 同上 | 计费/悬浮球/图谱**无法在不改 base 的前提下摘除** → 插件化前必须先做钩子倒置 |
| **P15** | **归属有两条互不覆盖的写入路径 → 已造成不一致**：HTTP 写全 4 字段（`server.py:467-475,550-562` → `perf_index_runtime.py:67-70`），MCP **完全不写** `project_id`（`mcp/tools_knowledge.py:205,226-227` → `store.py:596-597`） | `document_projects` 实测 2 行 name 有/id 空；`perf_index_core.py:174` 用 `key = project_id or project_name` 建图 → **同一项目在图上是两个节点** | 图谱/筛选/统计口径分裂（幽灵节点） |
| **P16** | **status 与 kind_marks 写入期零校验，已产生越界数据** | `idea.status = 进行中`（词表只有 待整理/探索中/已采纳/已归档，`store.py:40`）；`kind_marks` 出现 `术语清单`、`知识-方法`（不在 `mcp/constraints.py:163-174` 的 10 个 id 内）；写入侧无成员检查（`store.py:595,629-635`、`mcp/tools_knowledge.py:222,230-231`） | 状态机与标记表只是文档 |
| **P17** | **索引里有大量可推导数据与死列**：`graph_edges` 1854 行中 tag 1178 = `document_tags` 行数、project 178 = `document_projects` 行数，typed 边还额外插一条通用镜像边（故 wikilink 325 = 222 + 103）；`documents_fts` 的 `title/body/tags/projects` 四列**写入后无人读** | `perf_index_core.py:207-211`、`perf_index_query.py:39,175-178` | 索引体积与写放大；同一正文在 md / FTS / excerpt 存三份 |
| **P18** | **同一指标两套计数口径**：`activity_daily.doc_create=199`（按 `weight` 求和，`perf_index_core.py:301-310`）vs `activity.jsonl` 里 doc_create 只有 142 行（53 行 weight>1）；仪表盘另从 md `created` 补种并按 `(ref,day,type)` 去重（`store.py:1065-1082`） | 实测 | 报表不可核对 |
| **P19** | **`WORKSPACE_LAYOUT` 两处定义且已分叉**：`workspace.py:20-43` **22** 项 vs `mcp/constraints.py:21-39` **17** 项（后者缺 `Knowledge/Literature/{PDF,Annotations,Notes,Index,Previews}`） | 程序比对 | 同一骨架两份口径 |
| **P20** | **`System/Trash/` 与 kind 列表不匹配**：实测有 `knowledge`（**不是现役 kind**），缺 experiment/milestone/summary | 删除逻辑按 `doc["kind"]` 建目录、不校验（`store.py:717-719`） | 回收站结构漂移 |
| **P21** | **循环导入被写成「调用顺序契约」**：`config.py:666` 模块末尾直接 `reload_all()`；直接 `import app.workspace` 会经 `config→agent_tools→kb_naming/store→workspace` 回到半初始化模块并 **ImportError**（实测复现）；`billing.py:94-100` 用惰性导入绕过并注释说明 | 同上 | 插件运行期动态加载 core 模块会踩顺序炸弹（详见 §6.1） |
| **P22** | **5 个同步冲突文件常驻 Workspace**（含 7.1 MB 已损坏的 index 副本） | `activity.sync-conflict-*`、`migration.sync-conflict-*`×2、`migration-冲突-*`、`chat-*.sync-conflict-*`、`Cache/index-冲突-*` | 不进索引、无清理逻辑 |

---

## 4. 精简方案

### 4.1 判据

一个功能算内核，当且仅当满足**全部**三条：

1. 直接读写「科研数据结构」本身（条目 / 项目 / 待办 / 活动 / 索引 / 关系）；
2. 去掉它数据会失去一致性或不可恢复（校验、原子写、回收站、导出）；
3. 是「录入 → 组织 → 检索 → 汇总/导出」闭环的必经环节。

只满足「有用」而不满足三条的，一律下沉为插件。

### 4.2 三层分类（推荐）

| 层 | 内容 | 理由 |
| --- | --- | --- |
| **内核 Core**（零插件完整可跑） | 条目 CRUD + 原子写 + 回收站；命名/存放/字段契约与校验；SQLite 索引 + 中文 FTS + 关系图谱**数据**；项目 + 待办 + 活动；界面壳（导航/列表/详情/编辑器）；全局关键词搜索；BibTeX 与汇总导出 | 对应判据 1-3 |
| **可选内核**（随包发布、设置里可关） | 文献与 PDF 工作区（20 路由）；知识图谱可视化；里程碑与 3D 时间线；语义检索 RAG；AI 写工具 + 草稿确认流 | 体量大/依赖重，但属科研主线 |
| **插件**（可自由增删） | 专注计时（**纯前端 0 路由，最易**）；天气（2）；RSS（1）；用量计费（5）※；悬浮球助手 ※；术语建档流水线（人设）；mermaid/mathjax 按需加载 | 与数据结构无强耦合，或纯展示/观测 |
| **待定**（§8-D1） | 知识图谱、PDF 工作区、Agent 本体 | 三者都重且都在用 |

> ※ 计费与悬浮球有**前置条件**：见 P14，须先把 `app.js` 的硬依赖倒置成钩子，否则摘除即坏页面。

### 4.3 精简动作清单（按收益排序）

| 动作 | 现状 → 目标 | 证据/收益 |
| --- | --- | --- |
| A1 vendor 按需加载 | 5 个库在 `index.html:35-39` 无条件 defer（8.2 MB）→ mermaid/mathjax 只在 Markdown 预览需要（`app.js:1114,1131`、补丁 `:270`）、pdfjs 只在文献视图需要（`literature.js:9-24`） | 首屏 < 1 MB |
| A2 前端补丁合并 | 13 个补丁 → 按主题合并为 6~8 个模块，装配改由 manifest 驱动 | 消除顺序依赖（P7/P14） |
| A3 派生数据治理 | 删 5 个冲突副本（含损坏的 7.1 MB）、关库 `wal_checkpoint(TRUNCATE)`、明确「Cache 全可删」+ 一键重建 | P6/P22，直接省 ≈30 MB |
| A4 会话/草稿治理 | 69 草稿 + 24 回收无 TTL → 加过期策略（与 `.scratch` 同口径） | 防单调增长 |
| A5 `.scratch` 加限额 | 时间清理 → 时间 + 体积双阈值 + 目录白名单（禁 pycache / 浏览器 profile） | P10，已 253 MB |
| A6 删死代码 | 删 `project_bridge.py`；`search.py` 决定并入内核检索还是删除 | P11 |
| A7 层级解耦 | `perf_index_query` 不再 import `agent`；私有跨模块调用改公开 API | P12 |
| A8 导入期副作用清零 | `config` 的 `load_secrets/reload_all` 移入显式 `init()`，由 `build_server()` 调用；解开顺序炸弹 | P13/P21，插件隔离的前提 |
| A9 前端接缝改契约 | 15 个 `window.ERW*` + 5 个自定义事件 + 6 个 MutationObserver → 统一注册表 + `ctx` 契约 | §6.3 |
| A10 消除双实现 | 删 canvas 先画后弃；`window.fetch` 包装改为显式分页 API | P14 |

---

## 5. 数据结构重构方案

### 5.1 单一契约源（先做，其它都依赖它）

新增 `core/contracts/kinds.py`（或 `kinds.json` + 加载器），把 3 处声明合并为一份**机器可读**契约：

```python
KINDS = {
  "experiment": KindSpec(
      id_prefix="experiment", dir="Knowledge/Experiments", title_prefix="实验-",
      statuses=("计划","进行中","完成","受阻","已归档"),
      date_field="record_date", required_marks=("experiment",),
      body_skeleton=(("摘要",""),("目标与假设",""),("配置与参数",""),("数据与口径",""),
                     ("结果",""),("结论与失效模式",""),("留档路径",""),("关联","")),
      fields=("attachment",), plugin=None,
  ), ...
}
```

由它**生成**（不再手抄）：`kb_constraints` 的 kinds/schema/marks/storage 文本（`mcp/constraints.py` 改为渲染器）；标题校验器与规则码（`mcp/naming.py` 与 `kb_naming.py` **合并为一份**）；正文骨架（`store.create_doc`）；前端表单选项（或由 `/api/contract` 下发）；kind→目录与 `WORKSPACE_LAYOUT`（`store.py`、`workspace.py`、`perf_index_*`、`mcp/bridge.py`、`mcp/constraints.py` 全部消费同一份）。

**完成判据**：`grep -r "Knowledge/Experiments"` 只剩契约文件与生成物；`experiment` 在两条写入路径上得到同一校验结果；`WORKSPACE_LAYOUT` 只有一处定义。

### 5.2 条目模型：信封 + 类型扩展

| 段 | 字段 | 规则 |
| --- | --- | --- |
| 信封（共有） | `id, kind, title, created, updated, status, tags, kind_marks, pinned` | 强校验 |
| 组织关系 | `project_ids[]`（**唯一主键**）+ `projects[]`（显示派生）、按 kind 唯一的日期字段 | 见 §5.4 |
| 类型扩展 | `summary_type, authors, year, venue, doi, url, cite_key, attachment` | 由 `KindSpec.fields` 声明，未声明字段写入即报错 |
| 插件扩展 | `x-<plugin_id>-*` 或 `extensions: {<plugin_id>: {...}}` | 内核透传不解释 |

配套：① 契约补上 `project_id/project_ids`、`attachment`（数据有、契约无）；② **`status` 与 `kind_marks` 改枚举校验**（现已出现 `idea.status=进行中` 与 2 个越界 mark）；③ 每 kind 的**法定日期缺失即 error**（P5）；④ 未声明字段写入 → warn 并进体检清单。

### 5.3 id 与 kind 漂移的处置

不改 id 格式（199 条数据 + 全库引用都靠它），改为：契约明确 **id 是不可变标识、不承载类型语义**（修正文档说法）；`doctor` 增加 `id_prefix_mismatch`（已知 25 条）；可选 `--fix-ids`（生成新 id + 改文件名 + 重写引用 + 追加事件），**必须 dry-run 先行、可回滚**，默认不执行。

### 5.4 关系层与项目引用（含现存不一致的修复）

- **统一归属写入路径**：以 `project_ids` 为唯一主键，`projects[]` 为显示派生；**HTTP 与 MCP 必须走同一个写入函数**（现在 MCP 根本不写 id → P15）。修复后重建索引，验证 `document_projects` 中 `project_id=''` 的行数 = 0。
- 图节点 key 一律用 `project_id`（若缺失则**跳过并记警告**，而不是退化成 name 造出幽灵节点，`perf_index_core.py:174`）。
- 关系继续「正文 WikiLink + 小节语义」为事实来源（现状合理），增加：双向一致性校验；`document_links` 增 `relation_type / resolved_by(id|title) / broken` 三列，支持断链清单（现有 2 条不可解析）。
- 条目改名与项目改名走同一套 dry-run 影响面报告（`projects.py:345,348,381` 已有雏形）。

### 5.5 派生索引与迁移框架

1. **版本单一入口**：以 `System/schema.json` 为唯一记录；`perf_index_db.py:13-14`、`config.py:20`、`billing.py:31` 改为读它；磁盘版本 > 代码版本时**拒绝写入**并提示（防旧 exe 污染新数据）。
2. **迁移框架**：`core/index/migrations/NNNN_*.py`，声明 `from/to/apply/verify/rollback`；执行前自动备份到 `System/Backups/<ts>/`；幂等；`--dry-run` 打印影响面。**替换**现在 `document_links`/`documents_fts` 的 DROP 重建式迁移。
3. **索引瘦身**：`graph_edges` 不再重复物化 tag/project 边（可由 `document_tags`/`document_projects` 连接得到），去掉 typed 边的通用镜像边；`documents_fts` 只保留 `doc_id + seg`（其余四列无人读），正文真值只在 md。
4. **体检 `python -m core.doctor`**：磁盘 md 数 vs `documents` 行数；`id_prefix_mismatch`；缺法定日期；**status/kind_marks 越界**；未声明字段；title ≠ 首个 H1；断链/单向关系；`document_projects` 幽灵行；`System/Trash/` 目录 vs kind 列表；同步冲突文件（`*-冲突-*`、`*.sync-conflict-*`）；Cache 体积与 WAL；`rag.sqlite` 落后时长。
   - 注：旧 TODO 曾记「25 条实验不在索引」，实测**已修复**（`documents.experiment=25`），该项可关闭（`todos.json` 内容已过期却仍是权威真值，见 P18 同类问题）。
5. **缓存协议归一**：现在有 5 种自研有效性协议（`documents.(mtime_ns,size)`、`todos_signature`、`activity_offset` 字节偏移、weather 的 `key+timestamp`、rss 的 `timestamp`），统一为「源指纹 + 生成时间」两字段抽象。
6. **JSON 序列化归一**：`library.json` 的 `categories/tags/projects/favorite`、`AgentChats` 的 `refs/images` 都是**字符串化 JSON/repr**，迁移为真 JSON（含一次性修复脚本 + dry-run）。

### 5.6 System 状态文件规范化

| 文件 | 改动 |
| --- | --- |
| `todos.json` | 统一 `project_id`（现在 1/3 有）；补 `schema_version` |
| `projects.json` | 补 `schema_version`；`name` 唯一性校验（重名行为当前未定义） |
| `activity.jsonl` | 事件统一 `{schema_version, ts, type, actor, ref, payload}`；**统一计数口径**（weight 求和 vs 行数二选一，P18）；旧 5 类兼容，只追加不改历史 |
| 各 JSON | 统一 envelope `{schema_version, data}`，或保留裸结构 + 中央版本表（§8-D3 二选一） |

---

## 6. 插件化方案

### 6.1 设计约束（先钉死）

| 约束 | 来源 | 设计后果 |
| --- | --- | --- |
| 内核单进程 stdlib-only | `server.py` 现状、`rag/README` 自述 | 插件默认**同进程**加载；重型/带依赖的走**独立进程 + HTTP**（RAG 模式） |
| `web/` 与 `app/` 都进 exe，只读 | `spec:8`、`build_client.bat:19` | 插件一切资源在 `DATA_ROOT/plugins/<id>/`，运行期加载 |
| Markdown 是唯一事实来源 | `paths.py`、AGENTS.md | 插件**不得**另建事实来源；自有数据必须可重建或明确标注 |
| 导入期会读写 config，且模块间存在顺序炸弹 | `config.py:665-666`；实测 `import app.workspace` 直接 ImportError（P21）；`billing.py:94-100` 惰性导入绕过 | 插件加载 core 必须经**单一 `init()` 入口**，禁止在 import 期触碰 `app.*` 子模块 |
| Agent 侧还有一条 MCP 通道 | `mcp/` | 插件后端能力需**同一份实现**同时暴露给 HTTP 与 MCP，不能两写 |

### 6.2 插件形态

```text
plugins/<plugin_id>/
├─ plugin.json          # manifest（唯一必需文件）
├─ backend.py           # 可选：register(ctx)
├─ web/{panel.js,panel.css}
├─ migrations/
└─ README.md
```

```json
{
  "id": "weather", "name": "天气", "version": "1.0.0",
  "api_version": 1, "core_min": "v261010", "kind": "inprocess",
  "entry": "backend.py",
  "permissions": ["net:http", "storage:own", "config:own"],
  "nav": [{"id": "weather", "label": "天气", "mount": "web/panel.js"}],
  "routes": [{"method": "GET", "path": "forecast"}],
  "mcp_tools": ["weather_now"],
  "settings_schema": {"type": "object", "properties": {"city": {"type": "string"}}},
  "jobs": [{"id": "refresh", "interval_min": 30}],
  "events": ["doc.updated"]
}
```

### 6.3 扩展点与命名空间

| 扩展点 | 注册方式 | 命名空间约束 |
| --- | --- | --- |
| HTTP 路由 | `ctx.routes.get("forecast", handler)` | 前缀固定 `/api/plugins/<id>/`；**禁止**注册裸 `/api/*` |
| MCP 工具 | `ctx.mcp.tool("weather_now", spec, handler)` | 对外名 `p_<id>__<tool>`；内置 Agent 工具同理 |
| 知识 kind | `ctx.kinds.register(KindSpec(...))` | 仅允许 `x-<id>-<kind>`；内核必须容忍未知 kind（不进内核导航、不阻断索引） |
| 前端面板 | manifest `nav[]` + `mount(ctx)` | 内核按 manifest 渲染导航与挂载点；插件**不得**改内核 DOM |
| 设置 | manifest `settings_schema` | 内核渲染表单，值落 `config/plugins/<id>.json` |
| 事件 | `ctx.events.on("doc.updated", cb)` | 只读载荷；回调内禁止同步长耗时 |
| 后台任务 | `ctx.jobs.add(...)` | 内核负责调度/超时/日志 |
| 存储 | `ctx.storage` | `Workspace/Plugins/<id>/`、`System/Plugins/<id>/`、`System/Cache/<id>.sqlite` |

### 6.4 隔离不变量（「插件不得影响精简版」的可验证定义）

| # | 不变量 | 如何自动验证 |
| --- | --- | --- |
| I1 | 内核零插件可完整启动与使用 | `tools/plugin_check.py --assert-core-only`：`plugins/` 置空 + `--no-plugins` 启动后跑 `tools/kb_smoke.py` 全绿 |
| I2 | 依赖方向单向：内核不得 import 插件 | 静态检查 `core/**`、`server.py` 无 `plugins.` / `import_module("plugins…")` |
| I3 | 插件只依赖稳定门面 `core_api` | 插件只 `from core_api import …`；直接 import `core.model.store` 等私有模块 → 拒绝加载 |
| I4 | 单插件失败不影响内核 | 每个 hook 包 `try/except + 超时`；连续失败自动停用并在健康面板可见；**内核请求路径永不抛插件异常** |
| I5 | 存储互不越界 | 插件只拿到自己命名空间的路径对象；内核校验解析后绝对路径前缀 |
| I6 | 前端不得覆盖内核 | 插件 JS 以 module 挂载；lint 禁 `window.<name> =` 重定义与全局选择器样式（现有 13 个补丁正是反例） |
| I7 | 版本门控 | `api_version` 不匹配 → 拒绝加载并提示，内核继续运行 |
| I8 | 资源可控 | 每插件存储配额 + 调用耗时统计；超配额只禁该插件写 |
| I9 | 加载顺序无关 | 每个插件在独立 `try` 中注册；`core_api.init()` 之后才允许触碰 core 子模块（P21） |

### 6.5 生命周期

发现（扫 `plugins/*/plugin.json`）→ 校验（manifest/版本/权限）→ 注册（只登记不执行）→ 启用 → 运行 → 禁用（注销路由与面板，保留数据）→ 卸载（移入 `System/Trash/plugins/<id>/`，数据默认保留并提示）。
后端变更需**重启**才生效（与 AGENTS.md「长驻进程改代码必须重启」一致）；前端面板刷新后热注册。

### 6.6 参考实现：把 `rag/` 收编为第一个插件

`rag/` 已具备全部要素，改造量最小，用它验证契约：

1. 加 `plugins/rag/plugin.json`：`kind: "process"`、`routes: [search, status]`、`mcp_tools: [kb_retrieve]`、`settings_schema: {auto_start, use_vector, topk}`。
2. `server.py:39-92` 的 `_rag_client/_rag_http/_rag_retrieve/_rag_status` 抽成 `ctx.process` 门面（保留「缺 `rag/` 包即降级 HTTP」的现行为）。
3. `mcp/tools_workspace.py:210-240` 的 `kb_retrieve` 改为按注册表装配（插件未启用 → 工具不出现，而非报错）。
4. `web/v261009-rag.css` + 搜索弹窗 RAG 分区改为 manifest 声明的面板贡献（内核搜索框提供 `ctx.search.addSection()`）。
5. 验收：禁用插件后 `/api/rag/*` 返回 404、UI 无 RAG 分区、`kb_retrieve` 不在工具表，而 `tools/kb_smoke.py` 仍全绿。

### 6.7 反模式（红线）

1. 插件在 import 期执行副作用（内核启动即被拖慢/拖崩）。
2. 插件直接改 `config/app.json` 或写 `Workspace/Knowledge/`（必须走 `ctx`）。
3. 插件注册裸 `/api/*` 路由或覆盖内核 CSS 选择器。
4. 插件把内核模块当内部 API 用。
5. 内核功能依赖某个插件才能工作（含「默认插件」也不行；可关闭的只能进 `core_plugins/`）。

---

## 7. 实施顺序与验收

| 阶段 | 内容 | 交付 | 验收命令（必须全绿） |
| --- | --- | --- | --- |
| **P0** | 契约源抽取（不改行为） | `core/contracts/` + 3 处改为消费 | `python tools/kb_smoke.py`、`python -m mcp.server --selftest` |
| **P1** | 校验合并 + 补齐缺口（P2/P5/P16） | 一份校验器；status/mark 枚举校验；Agent 可写日期/状态 | 同上 + 新增「Agent 建 experiment 违规标题被拒」「越界 status 被拒」用例 |
| **P2** | 死代码清理 + 层级解耦 + 导入期副作用清零（P11/P12/P13/P21） | `indexer` 不再 import `agent`；`config.init()`；顺序炸弹拆除 | `python -c "import server"` 不写盘（比对 config 目录 mtime）；`import app.workspace` 二进制度可复现 |
| **P3** | Doctor + 迁移框架 + 索引瘦身（P3/P4/P6/P15/P17/P19/P20/P22） | `python -m core.doctor`；项目归属单一写入路径 | 问题清单含已知项（25 条 id 漂移、2 行幽灵归属、5 个冲突文件），`--dry-run` 不落盘；修复后幽灵归属 = 0 |
| **P4** | 前端模块化 + vendor 按需 + 钩子倒置（A1/A2/A9/A10） | 首屏 < 1 MB；manifest 装配；base 不再直接调补丁 | `node --check web/*.js`、`tools/shot_page.py` 截图冒烟 |
| **P5** | 插件运行时 + 首个插件（§6.6） | `plugins/` 空集可启动；`rag` 插件化 | `tools/plugin_check.py --assert-core-only` |
| **P6** | 迁移非内核功能：专注计时 → 天气 → RSS → 计费 → 悬浮球 | 每个都能单独禁用 | 每迁一个跑 `kb_smoke` + 插件自检 |

顺序原则：**先契约、再解耦、后搬运**。契约不归一就插件化，等于把分叉复制到更多地方。

---

## 8. 需要你拍板的决策点

| # | 问题 | 选项 | 我的建议 |
| --- | --- | --- | --- |
| **D1** | Agent / PDF 工作区 / 知识图谱，谁是内核？ | ① 都在内核 ② 全下沉可选内核 ③ 只留 Agent | ③：Agent 是日常入口（66 次对话）；PDF(20 路由) 与图谱属可选内核 |
| **D2** | 插件能否注册新 kind？ | ① 允许（`x-<id>-*`）② 不允许，只能展示/分析 | ① 但受契约约束；否则「数据集/协议」这类扩展永远要改内核 |
| **D3** | 数据重构激进程度 | ① 只加契约源 + doctor，不动 199 条数据 ② 补字段/统一 project_id/修幽灵归属 ③ 连 id 一起迁移 | ①→② 分两步（②含修 P15 这类**已发生**的不一致）；id 迁移单独作为可选操作 |
| **D4** | 插件运行形态 | ① 默认同进程 ② 默认独立进程（像 RAG） | ① + 重型插件（模型/GPU 类）走 ② |
| **D5** | 精简力度 | ① 只移出内核 + 按需加载 ② 直接删天气/RSS/专注计时 | ①：RSS 与天气**今天仍在写入**，先移出、观察一个版本再谈删 |
