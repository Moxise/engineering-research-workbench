# Changelog

## v261009.4

- **设置 → 「插件」页：插件预览 + 插件设置 + 启停**（用户要求「在设置提供插件预览接口以及插件使用的相关设置」）。
  - **预览接口**：`GET /api/plugins?detail=1` —— 每个插件给出状态（含中文状态名与不可用原因/建议）、版本、来源（bundled/user）、分发类型、kind、权限（**带中文说明**）、路由清单、面板（区分导航页/槽位）、MCP 工具、依赖、目录、内核版本要求、是否有配置接口。
  - **插件设置**：读/写**插件自己的配置接口**（`/api/plugins/<id>/config`）—— 内核只做转发与展示，**不解释插件配置的内容**（所以内核仍然不认识任何具体插件）；界面上是可编辑的 JSON，保存即落盘到 `config/plugins/<id>.json`。没有配置接口的插件如实说明「它的设置在自己的界面里」（如专注/天气）。
  - **启停**：`POST /api/plugin-manager/<id>/enabled` → 写 `System/plugins.json` 后**热重载**插件集合（每次加载都在新的路由表/工具表上重跑 `register(ctx)`，插件不持有跨加载状态）。**停用不删文件、不动数据**——只改「开不开」（§1）。
  - **扩展点（通用，不是特例）**：`ERWPanels.register({id, settingsTab:{label, render}})` —— 任何模块都能往「设置」里加一个 tab；`app.js` 只负责把内置 tab 与登记的 tab 排在一起，**不加任何功能分支**。「插件」页本身由新内核模块 [`web/plugin-manager.js`](web/plugin-manager.js) 自登记。
  - **实测**（`.scratch/tmp/verify_plugin_manager.py`，30 项全通过）：设置页出现「插件」tab · 三张插件卡片（权限/路由/面板/版本/目录齐全）· 停用 rss → 清单与侧栏同步消失、**插件目录与资讯缓存都还在**、`System/plugins.json` 记下意图 · 重新启用恢复 · 改天气配置 → 落盘到 `config/plugins/weather.json` 并可读回 · 无配置接口的插件不产生 4xx 噪音 · 0 console error。
- **顺带修掉两个由本页暴露出来的问题**：
  1. 「只贡献设置页 tab」的面板曾被 `navGroups()` 当成导航面板，于是侧栏**多出一项没有页面的「插件」**；现在按能力分类挂载（有 `render` 才进导航），`ui_smoke` 也新增断言：贡献的设置页 tab **必须出现在设置页、且不得出现在侧栏**，并会点开它确认渲染非空。
  2. 插件资源 URL 现在带 `?v=<mtime>` 缓存键（内核 JS/CSS 早有 `v` 参数，插件资源此前没有，浏览器可能一直用旧面板脚本）。

## v261009.3

- **修复：「资讯源设置」点了像没反应**（用户二次报「资讯设置不可用」——上一版只解掉了「等抓取」，真正的原因是**看不见**）。
  - 根因：设置面板被渲染在**资讯列表下方**，而列表有 72 张卡片——点按钮后设置在屏幕外，视觉上完全没变化。
  - 修法：① 设置面板移到**列表上方**（点开即见）；② 展开时 `scrollIntoView({block:'nearest'})` 兜底；③ **失败卡片里也保留「资讯源设置」按钮**（接口异常时设置也不该消失）。
  - 实测（文本量测，非截图）：设置面板 `top=310px / height=523px`，在 900px 视口内且位于 `.news-grid` 之前；点开 **31 ms**、列出 9 个源、**0 次多余请求**；源筛选 345 ms 生效；强制刷新拿到「最近抓取 2026/10/10 09:14:58」。
- **修复：插件前端资源没有缓存键**，浏览器可能一直用旧面板脚本（改了插件前端、刷新却还是旧行为）。
  - 内核自己的 JS/CSS 由装配清单的 `v` 参数充当缓存键；插件资源此前**没有**。现在 `/api/plugins` 下发的面板与样式 URL 一律带 `?v=<文件 mtime>`，文件一变键就变。
  - 实测：`/plugins-file/rss/web/panel.js?v=1791594851` 返回 200 且内容为最新。

## v261009.2

- **修复：「资讯源设置 / 源筛选」点了像没反应**（用户报「资讯设置不可用」）。面板里这两个动作（以及切页面）都先 `await` 一整轮抓取才重绘——离线时 6 个源逐个超时，等于点了没反应。现在面板把**上次抓取结果与配置**留在内存里，设置展开、源筛选、切页回访都**只重绘不抓取**；只有「强制刷新」才真抓，并在按钮上显示「抓取中…」与 `disabled`，行内显示进行态。
  - 实测：点「资讯源设置」**29 ms** 出面板（9 个源），**0 个多余 feed 请求**；点源筛选 350 ms 生效、**0 个多余请求**；强制刷新期间按钮变「抓取中…」，完成后「最近抓取 2026/10/10 09:10:56」。
- **新增：网络代理兜底（`core/net.py`）——「回环代理没启动就直连」**，解决「资讯抓不到 / 天气不可用 / LLM 连不上」。
  - 判定**保守**：仅当 ①配置的代理是**回环地址**（127.0.0.1 / localhost / ::1）②该端口**没人监听**（TCP 拒绝，1/4 秒探测）③调用方明确要求直连时，本次请求才改直连；远程代理（公司网关等）永不动，超时 / DNS 失败 / 非 2xx 一律照原样抛出。
  - 落点：`core/net.py`（判定 + `read_url`）、`core_api.http_get()`（插件出网唯一推荐入口，写进 PLUGIN_SPEC §6）、两个插件（`rss` 的 `_download`、`weather` 的 `_json_get`）、`app/agent.py` 的两处代理分支（原判据 `if not getproxies().get("https")` → `net.direct_preferred("https")`）。
  - **实测（本机系统代理 127.0.0.1:7890 未启动）**：资讯 `?force=1` → **72 条、`stale:false`、6/6 源健康**；天气 → **实时**（上海市浦东新区 晴 19.6°，无降级）；LLM → **HTTP 200 + usage**（用真实 key 打通，此前是 `WinError 10061`）。
- **诊断留档**：注册表 `ProxyEnable=1 / ProxyServer=127.0.0.1:7890` 而 7890 无进程监听；`urllib` 与 `requests` 都会读注册表代理，故所有出网请求被转发到死端口得到 `WinError 10061`。旁证：显式禁用代理直连时 arXiv 200、方舟端点可达、open-meteo 可达。**这不是重构引起的**，但应用层现在能自动降级。

## v261009.1

- **修复：插件迁移漏搬旧缓存，导致断网时行为退化**（用户报「资讯获取失败、0 条」时定位到）。
  - 现象：搬出内核后插件用的是自己的缓存路径（`System/Plugins/<id>/cache.json`），而内核时代的缓存留在 `System/Cache/rss_cache.json`（72 条）与 `System/Cache/weather.json`。于是网络不通时，插件是「空缓存 + 抓取失败 = 0 条 + 全部获取失败」，而不是原来的「显示上一次成功抓到的内容」——**这是搬出时漏做的一步，属真实回归（I12）**。
  - 修法：两个插件增加**一次性认领**旧缓存（`adopt_legacy_cache`）——插件缓存不存在且旧缓存存在时复制过来，之后一律只用插件自己的路径。顺带把 `core_api` 的数据根做成**公开** `data_root()`（原先天气插件在读配置迁移时用了私有 `_data_root()`），并在文档里写明它**只正当用于一次性迁移**，插件日常应使用命名空间内的助手。
  - 实测（断网环境）：`/api/plugins/rss/feed` → **72 条 + `stale: true`**（来自 10-09 16:22 缓存）；资讯页 **72 张卡片** + 「缓存更新 2026/10/9 16:22:54」提示；顶栏天气回到「上海市浦东新区 · 晴 25.5° · 16~26.1°」并在 tooltip 标注「当前为缓存内容：网络不可达（连接被拒绝）」；0 console error。
- **诊断（非代码问题，供存档）**：本机注册表 `ProxyEnable=1 / ProxyServer=127.0.0.1:7890`，但 **7890 无进程监听**（代理未启动）。Python 的 `urllib` 与 `requests` 都会读注册表代理，因此**所有**出网请求（arXiv、Open-Meteo、方舟 LLM API，连 pypi 也一样）都被转发到死代理并得到 `WinError 10061 连接被拒绝`。**证据**：显式禁用代理直连时 `rss.arxiv.org` 200、`ark.cn-beijing.volces.com` 401（可达，仅缺 key）、`api.open-meteo.com` 503（可达，服务端繁忙）；走系统代理则 10061。**与本次重构无关**——网络路径代码未改（搬出前后同样是 `urlopen` + 同一套代理发现逻辑）。

## v261009.0

### 契约单源 + 基线对齐（底层变更，需重启生效）

- **基线对齐（关键修复）**：把 `23a83f7`「知识库结构升级：实验独立成类 + 类型化关系层」摘到本分支（零冲突）。此前本分支的 `app/store.py`、`app/workspace.py`、`app/perf_index_*`、`web/app.js` 都停在升级前（6 类，没有 experiment），而 `Workspace/Knowledge/Experiments/` 里的 25 条实验、索引中 25 行 `documents(kind=experiment)` 以及 `mcp/` 层都已按七类写就——**下一次索引同步会把 25 条实验从索引与关系图中删除**（md 本体无损，但界面看不到实验）。复现证据：`.scratch/tmp/audit_kind_gap.py`（基线看得到 174 个 md，索引里 199 条，25 条会被删）。
- **补齐「改动后必跑」的验证工具（A13）**：随上一条取回 `tools/kb_smoke.py`、`tools/kb_tree.py`、`tools/kb_migrate_experiments.py`；另从 `ba77ddc` 单独取回只读的 `tools/shot_page.py`、`tools/shot_prep.py`（截图 + 像素预算），使 `AGENTS.md` 指定的验收流程在本分支可用。
- **契约单源（P0）**：新增 `core/contracts/kinds.py` —— 七类矩阵、标记表、字段契约、`WORKSPACE_LAYOUT`、关段关系映射、正文骨架的**唯一声明处**；新增 `core/contracts/naming.py` —— 标题校验的**唯一实现**（规则码 T000–T022、标记推导、建议标题）。`app/store.py`、`app/workspace.py`、`app/agent_tools.py` 改为消费契约；`mcp/constraints.py` 与 `mcp/naming.py` 退化为再导出门面（调用点零改动）；**删除**过期的第二套校验 `app/kb_naming.py`。
- **校验合并（P1/P2）**：同一标题在 HTTP（应用内 Agent）与 MCP 两条写入路径上现在得到同一结论；`experiment` 不再被 Agent 侧放行（原先「未知条目类型 experiment，跳过命名校验」）。
- **Agent 建档缺口（P5）**：`kb_create_entry` 开始接受 `status` / `record_date` / `due` / `added_date` / `summary_type`；`_KIND_ENUM` 改由契约派生（Agent 首次能看到 `experiment`，此前靠字面量硬编码六类）。
- **幽灵常量修正**：`WORKBENCH_VERSION_EXPECTED` 改为直接读 `VERSION`，不再抄一份写死的 `v260924.1`。
- **工作区骨架归一（P19）**：`WORKSPACE_LAYOUT` 由两处（`app/workspace.py` 22 项、`mcp/constraints.py` 17 项）合并为一处 22 项，`knowledge/constraints` 的 storage 主题不再漏掉 `Knowledge/Literature/{PDF,Annotations,Notes,Index,Previews}`。
- **验证**：`python tools/kb_smoke.py` 全绿（199 条 / 关系边 1854）；`python -m mcp.server --selftest` 的 `problems` 为空；新增等价性核对 `.scratch/tmp/verify_contract_equiv.py` —— 七类正文骨架与旧实现**逐字一致**，kind→目录/标签/状态机/日期字段/关系映射四张表**逐项一致**。
- **导入期副作用清零 + 顺序炸弹拆除（P13/P21）**：`app/config.py` 尾部的 `load_secrets()` / `reload_all()` 移除，改为显式 `config.init()`，由 `server.build_server()` 与 `mcp.bridge.Workbench` 调用；其余访问器保留 `if not _cache: reload_all()` 惰性兜底。收益：`import app.config` 不再读写用户配置（迁移路径原先会落盘 `app.json`/`secret.json`），且 `config → agent_tools → store → workspace → config` 的循环导入死结解开——实测 `app.config` / `app.store` / `app.workspace` / `app.agent_tools` / `app.agent` / `app.literature` / `app.perf_index_query` / `app.projects` **每一个都可作为入口直接 import**（此前 `import app.agent_tools` 直接 `AttributeError: partially initialized module`），`python -c "import server"` 前后 `config/` 目录 mtime 不变。
- **层级解耦（P12）**：`app/perf_index_query.py` 不再在导入期 `import agent`（会话搜索改为函数内惰性导入），实测导入查询层/索引层后 `app.agent` 不在 `sys.modules`；跨模块私有调用改走新公开入口 `store.doc_from_path()` / `store.academic_progress()`。
- **死代码清理（P11）**：删除全仓零引用的 `app/project_bridge.py`（52 行）。`app/search.py` 仍被 `mcp/bridge.py` 与 `tools/self_check.py` 使用，暂留待并入内核检索时再处置。
- **端到端复核**：在备用端口 8799 以新代码起了一个实例，`/api/dashboard` 返回 `experiment:25 / 199 条`，`/api/docs?kind=experiment` 列出 25 条，索引 `document_links.role` 八类分布与 1854 条 `graph_edges` 全部保留——**「重启即丢 25 条实验」的风险已消除**（验证后退掉该实例）。
- **vendor 按需加载（A1，前端首屏）**：`mathjax-tex-svg.js`(2.11 MB) 与 `mermaid.min.js`(2.57 MB) 原先在 `index.html` 里**无条件 defer**，首屏就要下载。新增 `web/vendor-lazy.js` 提供 `window.erwVendor.load('mathjax'|'mermaid')`（共享 Promise、只加载一次、失败回退 CDN、可重试）与 `hasMath()` 判断；四处调用点改为真正用到时才 `await`：`app.js` 的 Markdown 预览与 Mermaid 渲染、`v260922-graph-performance.js` 的图谱节点预览、`v260930-floating-agent.js` 的对话气泡。**首屏 5.23 MB → 0.77 MB（−4.46 MB / −85%）**，`/vendor/mathjax-tex-svg.js` 与 `/vendor/mermaid.min.js` 已不在首屏引用列表内（核对脚本 `.scratch/tmp/a1_payload_compare.py`）。纯文本预览不会拉 MathJax；离线时 MathJax 静默降级、Mermaid 保留原有「渲染库暂未加载」提示。
- **A2 第一刀：装配清单化 + 前端静态体检闸门 + 连续补丁合并**：
  - **装配清单**：新增 `web/manifest.json` 与 `tools/web_manifest.py`（`--write` / `--check`）。`index.html` 原先手写 11 个 `<link>` + 15 个 `<script>`，顺序有语义（`v260922-performance.js` 包装 `window.fetch`，必须排在 `app.js` 之前）却无处校验；现在三段引用块由清单生成，顺序只有一处声明，`--check` 可在提交前拦住漂移。
  - **静态体检闸门**：新增 `tools/web_check.py`（只读）——① 语法（全部业务 JS 过 `node --check`、CSS 花括号配平）；② 清单↔`index.html` 一致；③ 清单↔磁盘双向缺失（新增前端模块不登记即报错）；④ **接缝完整性**：任何 `window.ERW*` 的消费方必须有定义方、任何自定义事件的监听方必须有派发方；⑤ 加载顺序约束。这条闸门正对 `17682ce`（一个补丁的语法错误直接打掉整个 PDF 工作区）那类事故——现在提交前就能拦住。
  - **连续补丁合并**：`v260922-projects.js`、`overview-editor-tools`、`graph-performance`、`overview-graph`、`agent-profiles` 五个**在加载顺序上连续**的 IIFE 补丁合并为 `web/v260922-research-pages.js`，业务 JS **11 → 7 个**。合并前提经程序复核：5 个文件都是 `(() => {…})();` 且**顶层声明为 0**、彼此只经 `window`/事件/DOM 通信，且合并后放回第一个补丁的位置 → 全局顺序与文件内顺序都不变。复核脚本比对 git 中源文件：**payload 与按序拼接逐字一致（80,995 B），5 个 IIFE 原样**。
  - **未做 CSS 主题合并（有意）**：11 个 CSS 在加载顺序上不构成连续的主题分组（`styles.css` 之后各补丁互相覆盖），合并会改变层叠顺序，收益（少几次请求）不抵风险；留待与 A9 钩子倒置一并处理。
  - 顺带：`.gitignore` 放行 `web/**/*.json`（清单需入库）；本机 `AGENTS.md`（**当前不在版本库内**，见文末待决项）补「动 `web/` 必跑 `web_check.py`」「引用块不要手改」两条，并更正两处过期描述（`mcp/` 早已入白名单、新增 `core/` 契约层）。
- **P3 首件：`python -m core.doctor` 只读体检**：新增 `core/doctor.py`，把「契约 / 磁盘 / 派生索引」三者一致性从人眼检查变成一条可重复的命令。22 个检查项：契约自洽（字段序 vs 创建/更新字段）、磁盘条目数与索引逐类对照、`id` 前缀与 kind 漂移、**status 越界**、**kind_marks 越界与缺契约强制标记**、**缺法定日期**、title≠首个 H1、标题不合命名规范、未声明字段、**项目归属幽灵行**、**不可解析的关联链接**、回收站目录漂移、同步冲突残留、索引体积与 WAL、派生库归属与冲突副本、`schema.json` 与代码版本一致。支持 `--json`（机器可读）与 `--strict`（有 error 级发现时非零退出）。
  - **首次实测（2026-10-09，199 条）**：`error` 级 2 项 —— `idea-20260924104458-90ee1b` 的 `status=进行中` 越界（该类型状态机只有 待整理/探索中/已采纳/已归档）、`note-20260930121751-769a43` 的 `kind_marks` 含 `知识-方法` 与 `术语清单`（不在 10 个合法标记内）；`warn` 级 8 项 —— 25 条 `note-*` 前缀的 experiment（§5.3 已明确 id 不承载类型语义）、2 行幽灵归属（`document_projects` 有 name 无 id）、2 条不可解析链接（`DUST-实验方案`/`DUST-数据集说明`）、`System/Trash/knowledge` 非现役 kind、4 个同步冲突文件、`index-冲突-Moxise_Win11.sqlite` 6.8 MB、WAL 21.4 MB（超过库体量 60%）。**均为只读发现，本轮未改动任何用户数据。**
- **P1 补齐：写入期字段校验（P16 根因修复）**：新增 `core/contracts/validate.py` —— status 必须落在该类型状态机内（`F002`）、`kind_marks` 必须是合法标记 id（`F003`）、更新时**显式**漏掉契约强制标记则拒写（`F004`，建档路径仍自动补齐）、日期必须 `YYYY-MM-DD` 且只用于该类型的日期字段（`F005`/`F006`）、未声明字段告警（`F007`）。
  - `app/store.py` 的 `create_doc`/`update_doc` 与 `mcp/tools_knowledge.py` 的 `kb_create_entry`/`kb_update_entry` 现在消费**同一份**校验器：越界 status/标记在两条路径上都被拒（此前写入期零校验，正是 doctor 那 2 个 error 的来源）。`create_doc` 同时按契约补齐标记——此前只有 MCP 侧补、HTTP 侧不补，属两条路径行为不一致。
  - `update_doc` 的可写字段白名单改由契约 `UPDATE_FIELDS` 派生（原先在 store 里手抄 18 项，又是一处会漂移的副本）。
  - `tools/kb_smoke.py` 新增第 7 组共 14 条断言（越界 status/标记被拒、合法值放行、强制标记语义、日期格式、未声明字段、两条写入路径结论一致），**全绿**；并复核冒烟仍严格只读（`activity.jsonl` 945 行、`Knowledge` 200 个 md 前后不变）。
  - 注：本轮**未修**库里已有的 1 条越界 status 与 2 条越界标记——按 AGENTS.md「`Workspace/` 是用户数据」，修数据需确认后走 `kb_*` 工具，不手改文件。
- **P3 第二件：索引结构迁移框架（§5.5.2）**：
  - 新增 `core/index/migrations/` —— `m0001_documents_attachment`（v1→v2）、`m0002_document_links_role`（v2→v3），每个迁移声明 `ID / TITLE / FROM_VERSION / TO_VERSION` 与 `apply(conn)->bool`（是否真改动）、`verify(conn)->(ok, detail)`、`rollback(conn)->bool`；`core/index/migrate.py` 负责编排：读当前版本 → 列待执行 → **默认 dry-run** → 备份 → 执行 → 验证，CLI 为 `python -m core.index.migrate [--apply | --rollback --to N] [--db] [--json]`。
  - **替换**原先内联在 `app/perf_index_db._init_db()` 里的四段 if（没有声明、没有验证、没有回滚、没有备份，出问题只能删库重建）。
  - **版本单一入口**：`app/perf_index_db.SCHEMA_VERSION` 改为读 `core.index.migrate.TARGET_VERSION`（= 迁移清单里的最大目标版本），不再写死数字——§5.5.1 点名的「5 处版本号各自演进」少了一处。
  - **新增硬护栏**：磁盘库版本**高于**代码版本时拒绝写入并给出可执行提示（防旧 exe 打开新 Workspace 把结构改坏）；`core.doctor` 新增「索引·结构迁移状态」一并报出该状态与待执行迁移。
  - 备份走 SQLite 自己的 backup API（WAL 下也得到一致快照），落在 `Workspace/System/Backups/<时间戳>-pre-v<N>.sqlite`。
  - **验收**（`.scratch/tmp/verify_migrations.py`，24 项全通过）：在合成的 v1 旧库上 —— dry-run 后结构与版本**逐字节不变**；apply 补出 `attachment`/`role` 两列并升版到 3、`documents` 数据保留、`document_links` 按设计重建（纯派生数据，由索引器回填）；二次执行为 no-op 且 verify 仍通过；`rollback` 可逆回 v1（两列移除、版本回落）；**全新库**走 DDL 后迁移为 no-op、标记需全量建索引；`_init_db` 对版本 99 的库抛 `MigrationError`。CLI 端到端（dry-run → apply → 再 apply → rollback）实跑通过。真实库只读 dry-run 确认 `v3 → v3 已是最新`；服务侧 `indexer.initialize()` 实跑后索引仍为 **199 条 / 1854 边**、八类 `document_links.role` 分布不变。
- **A3 派生数据治理：索引维护工具 + 关库 checkpoint + 实测瘦身 ≈49.9 MB**：
  - 新增 `core/index/maintain.py`：`python -m core.index.maintain [--checkpoint] [--vacuum] [--json]`（默认只读统计）。checkpoint 走 `PRAGMA wal_checkpoint(TRUNCATE)`；VACUUM 前自动备份到 `System/Backups/`；VACUUM 需要独占访问，工作台运行时会被锁挡住并给出提示。
  - **实测发现（更正方案 §5.5.3 的假设）**：索引库文件 35.70 MB，而 `dbstat` 逐对象求和只有 **7.19 MB 活数据** —— `PRAGMA freelist_count` 显示 **7299/9139 页是空闲页（80%，28.51 MB）**，另有 **21.39 MB** 的 `-wal` 未 checkpoint。因此「索引瘦身」的真正收益在**维护**，不在原先假设的「删可推导边 / 砍 FTS 列」：`tag`+`project` 边 1356 行 ≈ 0.25 MB、FTS 的 `title/body/tags/projects` 四列 ≈ 0.8 MB，两项合计不到 1 MB。
  - **已执行**（执行前备份 `Workspace/System/Backups/20261009-155909-pre-vacuum.sqlite`，37.4 MB）：WAL 21.39 MB → 0，库文件 35.70 MB → **7.14 MB**，合计回收 **≈49.9 MB**。**语义中性已程序证明**：原库 vs 处理后副本逐项比对 10 组查询（条目总数、按 kind 计数、八类 `document_links.role`、`graph_edges` 关系分布、tags/marks/projects 行数、两组 FTS 关键词命中、标题样本）与 38 个 schema 对象**完全一致**；处理后 `kb_smoke` 全绿（199 条 / 1854 边）、`doctor` 结果不变、运行中的实例仍返回正确计数。
  - **防止复发**：新增 `app/perf_index_db.checkpoint()` 与 `indexer.checkpoint` 门面；`server.py` 退出与 `client.py` 窗口关闭时自动 `wal_checkpoint(TRUNCATE)`；`core.doctor` 新增「索引·体积与空闲页」检查（空闲页 >30% 或 WAL >30% 库体量时告警并给出维护命令，已用合成膨胀库正向验证）。
- **A13 收尾：恢复「页面能不能点开」的自动闸门**（P29，前几轮唯一缺失的验证能力）：
  - 新增 `tools/ui_smoke.py` —— 真浏览器逐路由走查，**只读 DOM/控制台/网络，不截图**（文本优先）。断言：首屏无 console error / 无失败请求；`web/app.js` 里 `NAV_GROUPS` 声明的**每个路由**都点得开且渲染出内容（期望路由从 `app.js` 解析，不另抄清单）；首屏**不请求** mathjax/mermaid（A1 的按需加载是硬约束）；`window.erwVendor` 与补丁接缝（`ERWLiterature`/`ERWBilling`/`ERWFabTimeline`/`ERWNav`）齐备。支持 `--base-url` / `--json` / `--strict`。
  - **不要求下载浏览器**：脚本复用机器上已有的 Chrome / Edge / `ms-playwright` 里的 chromium（也可用 `ERW_BROWSER` 指定），只依赖 `playwright` 这个 Python 包。
  - **实测结果**：对**用当前代码新起的实例**（备用端口 8799）走查 —— 页面标题「概览 · 科研工作台」，**17 个路由全部可渲染**、console error **0**、失败请求 **0**、首屏重型库请求 **0**；实验页标题「实验」并渲染出真实实验内容（基线对齐在真实 UI 中生效）。同一脚本对 8765 上的旧实例同样全绿。
  - 顺带核实 `tools/shot_page.py` 在本机可直接用（它自己探测 Windows/macOS/Linux 的 Chrome/Edge 路径，不依赖 playwright）：实拍一张裁剪图，`1000x700 ≈428 tokens → 521x576 ≈243 tokens`。
- **A10：拆掉全局 `window.fetch` 猴子补丁，改为运行期接缝**：
  - 原先 `v260922-performance.js` 在**求值期**执行 `window.fetch = ...`：给 `/api/docs` 加分页参数并把分页信封**拆回数组**、给 `/api/graph` 加限流并改写 `/api/graph/overview`、给 `/api/search` 挂可取消的 AbortController，同时派发 `workbench:docs-page` / `workbench:graph-meta`。这正是 P14 点名的「补丁无法摘除 + 假加载顺序依赖」。
  - 现在改为提供 `window.erwFetch` 显式接缝，各模块的 `api()` 用 `(window.erwFetch || fetch)` **运行期解析**：`app.js`、`literature.js`、`v260930-floating-agent.js`、`v261008-billing.js`、`v260922-research-pages.js`（3 处 `api()` + 2 处直连 `/api/docs`、`/api/graph/overview`）。
  - **行为等价经真浏览器验证**（`.scratch/tmp/verify_a10.py`）：`window.fetch` 已恢复原生（`function fetch() { [native code] }`）；分页器「1/2 页 · 共 90 条」、请求带 `paged=1&page=1&page_size=50`、点「下一页」→「2/2 页」且列表内容变化；图谱状态条「当前加载 199 / 199 个知识节点」（`graphMeta` 事件仍通）；全局搜索返回结果；全程无 console error。
  - **不变量改为静态可查**（`tools/web_check.py`）：① 任何模块**不得**给 `window.fetch` 赋值（P14 红线）；② `window.erwFetch` 提供方有且只有一个；③ 每个自带 `api()` 的模块必须走接缝（否则会静默丢分页/限流/取消）。扫描前先剥注释，负向用例已验证（代码违规能抓到、注释里提及不误报、消费方不被误计为提供方）。`tools/ui_smoke.py` 同步在运行期断言接缝存在且 `window.fetch` 未被替换。
  - 「必须排在 `app.js` 之前」的旧约束随之作废（`app.js` 的引导挂在 `load` 事件上，任何请求都晚于全部 defer 脚本求值）；清单说明改为「非强制，但保持最先加载更稳」。
- **A9/§6.3：前端面板注册表 —— 内核不再硬编码具体功能**：
  - 新增 `window.ERWPanels`（`register` / `list` / `get`）：功能模块自行登记**导航项 + 页头元数据 + 渲染函数**；`app.js` 的 `navGroups()` 合并登记项（支持 `before` 保持既有顺序），`setHeader()` 与 `navigate()` 增加面板分支（内核路由优先级仍高于面板）。
  - **用量计费整体搬出内核**：删掉 `app.js` 里的导航项 `['billing','用量','▩']`、`PAGE_META.billing`、`navigate()` 的 billing 分支与 `renderBillingPage()`；改由 `v261008-billing.js` 自己 `ERWPanels.register`。这正是 P14 与 §6.7 红线 5「内核功能依赖某个补丁才能工作」——现在删掉计费模块**只会少一个导航项，不会白屏**。
  - **等价性经真浏览器验证**（`.scratch/tmp/verify_panels.py`，9 项全通过）：侧栏导航项与顺序**与改造前逐项一致**（用量仍在设置之前）、billing 是面板登记项且出现在侧栏、`#billing` 渲染出内容、页头「SYSTEM / 用量统计」由面板元数据提供、全程 0 console error；静态复核 `app.js` 实现里已无任何 billing 痕迹。
  - **不变量进闸门**：`web_check` 新增「**app.js（内核）不得调用 `ERWPanels.register`**」（面板应由功能模块自行登记）并列出面板自登记模块；`ui_smoke` 断言注册表存在、**每个登记面板都真的出现在侧栏导航里**，并把这些面板路由一并走查 —— 期望路由 = `app.js` 声明 ∪ 运行期面板，不另抄清单。
  - **「内核零插件可跑」已实测**（`.scratch/tmp/drop_billing.py`）：把 `v261008-billing.js` 从 `web/manifest.json` 摘掉并重新生成 `index.html` 后起实例，`ui_smoke` 报 **16 个路由全部可渲染、0 console error、0 失败请求、装配接缝缺失 0 个、面板登记 0 个** —— 即「删掉计费 = 少一个导航项」，不再是白屏。实验后已还原清单与 `index.html`（`--check` 一致）。
  - 顺带修掉 `ui_smoke` 自身的一处**过期硬编码**：原先把 `ERWBilling` 等写死在「必备接缝」里，导致上述实验被误判失败。现改为**从装配清单推导**——只检查「已装配模块消费的接缝是否都由已装配模块提供」（装配自洽性），并区分状态型接缝（如 `ERWCurrentDoc` 仅在打开条目后赋值，首屏为空是正常的）。
- **§6/P5 首件：插件运行时（内核侧：发现 / 校验 / 依赖解析）**：
  - 新增 `core/plugins/manifest.py` —— `plugin.json` 契约的唯一实现（PLUGIN_SPEC §3/§4/§7）：规则码 `P000–P018`，覆盖 id 合法性与**目录名必须等于 id**、语义化版本、`api_version` 匹配（I7）、`core_min`、`kind`/`distribution`、`entry` 文件存在、**未支持权限拒载**、**路由必须是相对路径**（不得写裸 `/api/...`）、**MCP 工具名不得自带前缀**（前缀由内核加）、`settings_schema` 形状、依赖项自依赖/重复、**`storage.derived_db` 只允许 `System/Cache/<id>.sqlite`**、`nav.mount` 文件存在。所有 `error` 级问题都带可执行的修复建议。
  - 新增 `core/plugins/registry.py` —— 两个来源（`ASSET_ROOT/plugins` 随包优先，`DATA_ROOT/plugins` 用户库）的发现、**状态机**（`available` / `blocked` / `rejected` / `conflict`）、**拓扑排序与环检测**（§4.2.1 检测到环整环拒载）、缺失前提插件 → `blocked` + 「缺什么、怎么补」（§4.2.3）、同 id 多来源按 §1 规则 ASSET 优先并给出提示、`System/plugins.json` 的安装意图读取。
  - 新增 `core/plugins/__main__.py` —— CLI `list` / `check <id>` / `verify`（PLUGIN_SPEC §5），把权限用人话列出、把路由挂载点与工具前缀提前说明；有 `rejected`/`blocked`/`conflict` 时非零退出，可直接当闸门。
  - 新增 `tools/plugin_check.py` —— 隔离体检：**I2**（`core/**`、`app/**`、`server.py` 都不得 import 插件实现）、**core 不得 import app**、**空插件集是合法状态**；`--assert-core-only` 额外跑 `kb_smoke` 作为「零插件下核心完整可跑」的代理（I1）。
  - 新增 `plugins/README.md` —— 丢进去就能用的约定速查（目录名=id、相对路由、裸工具名、派生库路径、权限集合、不得 import 私有模块、核心不依赖插件）。
  - **诚实边界**：本阶段**不含执行层**（`register(ctx)`、路由/工具/面板的挂载与卸载、I3/I4/I8/I10 的运行期校验），状态因此只报「已校验、可加载」而**不谎报 `enabled`**；这些随第一个真插件一并落地（前端面板接缝 `window.ERWPanels` 已在 `498d994` 就位）。
  - **验收**：21 项夹具断言全通过（`.scratch/tmp/verify_plugins.py`）—— 合法插件 available、依赖满足 available、**8 类违规各自被拒**（id 非法 / api_version=99 / 裸 `/api` 路由 / 自带前缀工具名 / 未支持权限 / 派生库路径 / `core_min` 过高 / entry 缺文件）、依赖缺失 → `blocked`、**依赖成环 → 整环 blocked**、同 id 双来源 ASSET 优先（保留 1.2.0）、加载顺序把前提插件排在依赖者之前、被拒/被阻的插件不进加载顺序。CLI 对夹具库实跑通过。
  - **顺带修掉一个真问题**：`tools/plugin_check.py` 的新不变量当场抓出 `core/doctor.py` 在 import `app`（第二轮为比对 schema 版本引入）。已改为从 `core.index.migrate.TARGET_VERSION` 取代码侧版本 —— `core/` 重新做到零 `app` 依赖。
- **§6/P5：插件前端管线 + 首个真插件「专注计时」**：
  - 内核侧新增 `GET /api/plugins`（只下发「已校验可用 且 生效启用」的插件与其面板入口）与 `GET /plugins-file/<id>/<rel>`（提供插件自带静态资源，**只允许插件目录内的文件**）。「开不开」的判定落在 `core.plugins.registry.effective_enabled`：`System/plugins.json` 有记录用记录，没有记录用 manifest 的 `default_enabled`（随包附属默认开、可选默认关）。实测：无记录 → 出现；显式 `enabled:false` → 消失；`enabled:true` → 出现。
  - 新增 `web/plugin-host.js`：按清单加载面板脚本，面板在 eval 期自登记 `window.ERWPanels`；`app.js` 在建侧栏前 `await ERWPluginHost.ready`（否则插件导航项要等下一次渲染才出现）。**单插件失败不影响内核与其它插件**（I4），失败原因明示并附排查命令（I11）。
  - **首个真插件 [`plugins/focus/`](plugins/focus/plugin.json)**：把专注计时从 `app.js` **原样搬出**（逻辑与标记未改写，只把内核内部的 `$`/`$$`/`toast` 换成等价的本地实现），localStorage 键沿用 `focusMinutes`/`breakMinutes`（老用户设置不丢）。`app.js` 删掉导航项、`PAGE_META.focus`、路由分支、`renderFocus` 簇、`state.focus` 与两处 localStorage 读取 —— 内核不再认识「专注」。
  - **端到端验收**（`.scratch/tmp/verify_focus_plugin.py`，真浏览器）：`/api/plugins` 下发 focus、面板脚本确实被请求、`ERWPluginHost.loaded=['focus']` 且 failures 为空、**侧栏 17 项与顺序逐项不变**（专注仍在「待办」与「Agent」之间）、`#focus` 由插件面板渲染出计时器、点「开始」倒计时真的在走（25:00 → 24:58，按钮变「暂停」）、暂停/重置可用、改时长写回 `focusMinutes=45`/`breakMinutes=10`、**全程 0 console error**、内核源码已无任何专注痕迹。
  - **路径安全**（`.scratch/tmp/verify_plugin_assets.py`，用**未归一化**的原始请求行，避免客户端先把 `..` 归一化掉）：10 例全通过 —— 正常面板 200、插件自身文件 200、编码 `../` 与多次穿越 403、未知插件 404、缺 id/子路径 400，且无源码泄漏。
  - `plugin_check` 新增**面板契约**不变量：声明了 `nav` 的插件，其 mount 脚本必须自登记 `ERWPanels` —— 否则脚本会「正常加载但什么都不做」，属静默失败。
  - **顺带修掉一个真 bug，并让闸门变确定**：`/api/weather` 在离线时 `URLError` 冒泡成 **500 + 浏览器 console error**，既让「天气」卡片报错，也让 `ui_smoke` 的「无 console error」断言随天气缓存 TTL 时好时坏（**不确定的闸门比没有闸门更糟**）。现改为：先退回**陈旧缓存**（带 `stale:true` 与可读原因），无缓存则返回显式的 `unavailable` 载荷；`geocode` 同样不再抛异常。实测离线返回陈旧数据 +「网络不可达（连接被拒绝）」，`/api/weather` 恢复 200，失败请求归零。
- **§6/P5：插件后端执行层（`register(ctx)` / 路由分发 / 命名空间隔离）**：
  - 新增 [`core_api.py`](core_api.py)（仓库根）：插件**唯一允许** import 的内核门面 —— `log` / `plugin_dir` / `cache_db` / `workspace_dir` / `system_dir` / `config_path` / `read_config` / `write_config`。保持最小面，要加是有意的动作（须同步 PLUGIN_SPEC §6）。
  - 新增 [`core/plugins/context.py`](core/plugins/context.py)：`ctx`（`PluginContext`）—— `routes.get/post/put/patch/delete`（**声明期**就强制相对路径、拒裸 `/api/*`、拒重复，错误信息直接给出正确挂载点）、`mcp.tool(name, spec, handler)`（只收裸名，对外名内核加 `p_<id>__`）、`storage`（只给插件自己命名空间内的路径，I5）、`config_read/config_write`、`log`。**未实现的不假装有**：`jobs` / `events` / `search.addSection` 明确列为待做。
  - 新增 [`core/plugins/loader.py`](core/plugins/loader.py)：按拓扑顺序执行 `register(ctx)`；**每插件独立 `try/except`**（I4）——注册失败记为 `failed` + 可读原因并继续跑其它插件；路由冲突按条拒绝并记原因；`dispatch()` 按 `(METHOD, 完整路径)` 查表，handler 抛异常**只影响该次请求**（500 且带插件 id）。
  - `server.py`：`build_server()` 启动时加载插件（按拓扑顺序打印、失败打到 stderr）；`/api/plugins/<id>/<rel>` 在 **GET/POST/DELETE** 三个入口统一分发；`ERW_PLUGINS_ROOTS`（`|` 分隔）可覆盖扫描根，便于测试与便携安装。
  - `plugin_check` 新增 **I3 静态检查**：插件后端只允许 import 标准库与 `core_api`；`core.*` / `app.*` / `mcp.*` / `server` 一律拦下（负向用例 6 例验证：注释里的 import 不误报）。
  - **验收**（`.scratch/tmp/verify_plugin_api.py`，19 项全通过，起真服务）：GET 路由拿到 query、POST 路由拿到 body、挂载点确为 `/api/plugins/<id>/<rel>`、`ctx.storage` 落在 `Workspace/Plugins/<id>` 与 `System/Plugins/<id>`、配置写 `config/plugins/<id>.json`、MCP 工具暴露为 `p_hello__hello_now`；**`register` 抛异常的插件记为 failed 且内核与其它插件不受影响**；**裸 `/api/docs` 路由在声明期被拒**并给出挂载点提示；未注册路径 404、handler 抛异常 500（带插件 id）、内核路由与 `/api/plugins` 清单均不受影响。（夹具运行期产物已清理，未留在 `config/` 与 `Workspace/`。）
  - **顺带修正我自己的一个 bug**：加载器最初把 `/api/plugins` 当「内核保留前缀」，导致**所有**插件路由被拒 —— 正是上面这套验收当场抓出来的；插件路由天然带命名空间前缀，与内核路由不可能撞，现在只保留插件之间的冲突检查。
  - **诚实边界**：后端执行层已可用但**尚无真功能消费者** —— 首个插件 `focus` 是纯前端，`register(ctx)` 要等把某个带后端的功能（天气/RSS）搬成插件时才有实战检验。
- **§6/P6 首件：把「资讯（RSS）」整体搬成插件**（后端执行层的第一个真消费者）：
  - 新增 [`plugins/rss/`](plugins/rss/plugin.json)：`plugin.json`（路由 `feed` / `config`、面板 + 自带样式、权限 `net:http`/`storage:own`/`config:own`/`ui:panel`）、`backend.py`、`web/panel.js`、`web/panel.css`。
  - **后端**：`app/rss.py`（166 行）原样搬入 `backend.py`（解析/抓取/去重/陈旧回退逻辑未改写），三处适配 —— 配置来源改为插件自己的 `config/plugins/rss.json`、缓存改为 `Workspace/System/Plugins/rss/cache.json`（只碰自己命名空间，I5）、入口由 `fetch()` 改为 `register(ctx)` 注册三条路由。**首次运行自动把内核 `config/rss.json` 的 9 个源迁移过来**（实测已迁移，老用户配置不丢，PLUGIN_SPEC §11.3）。
  - **前端**：`app.js` 的 `renderNews`（资讯列表 + 源筛选 + 刷新 + 诊断）搬入面板并自登记 `ERWPanels`；资讯源编辑（原设置页的一个 tab）改为**面板内联**；样式按 §2 从 `styles.css` 搬入 `web/panel.css` 并统一加 `[data-plugin="rss"]` 作用域（宿主新增 `nav.style` 支持）。
  - **内核删除**：`app/rss.py`、`/api/rss`、`/api/config/rss`、`config.py` 的 `DEFAULT_RSS_CONFIG`/`get_rss`/`save_rss` 与 `get_all()` 里的 `rss`、`app.js` 的导航项/`PAGE_META.news`/路由分支/`renderNews`/设置页资讯源 tab/`sourceRow`+`wireSourceRows`、`styles.css` 的 news-*/rss-*/source-row 规则、`server.py` 的 rss 导入与 `clear_cache` 调用。`tools/self_check.py` 的 RSS 解析测试改为按路径加载插件后端（覆盖不丢）。
  - **端到端验收**（`.scratch/tmp/verify_rss_plugin.py`，17 项全通过）：`/api/plugins` 同时下发 focus 与 rss（含面板与样式 URL）· 面板脚本与插件样式均被请求 · 宿主 `loaded=['focus','rss']` 且 failures 为空 · **侧栏 17 项与顺序逐项不变**（资讯仍在 Agent 之后）· `#news` 由插件渲染且**插件样式生效**（`.news-grid` computed `display:grid`）· 资讯源设置内联可用且**9 个源已迁移** · 插件路由 `feed`/`config` 可用（离线也 200 + 源状态）· **内核 `/api/rss` 已 404** · 内核 Python 已无任何 rss 痕迹 · 全程 0 console error / 0 失败请求。
  - **有意变化（PLUGIN_SPEC §11.2 显式声明）**：资讯源设置从「设置页的一个 tab」移到「资讯页内联」——插件拥有自己的 UI，内核不再知道「资讯源」这个概念；接口从 `/api/rss`、`/api/config/rss` 变为 `/api/plugins/rss/*`。
- **§8 ②：插件 MCP 工具接入内置 Agent**（此前 `ctx.mcp` 注册的工具只在加载结果里收集，从未进入 Agent 工具面）：
  - 新增 [`core/plugins/runtime.py`](core/plugins/runtime.py)：进程级持有当前 `LoadResult`，外部只读 `current()` / `tools()` / `tool_specs()` / `route_map()` / `summary()`；唯一写入点是 `loader.load()`（避免各处持副本或反向依赖 `server.py`）。
  - `loader.load()` 结束时登记到 runtime；**声明 `write: true` 的插件工具被明确拒绝注册**并给出原因 —— 插件写工具要走内核的草稿确认流，那条链路还没有插件分支，**不半接**以免留下「绕过确认直接落盘」的口子。
  - `app/agent_tools.py` 的工具面全面动态化：新增 `plugin_tool_meta` / `all_tool_meta` / `all_tool_names`，`openai_specs` / `text_protocol_prompt` / `is_write_tool` / `list_tool_meta` 改为读统一视图；`execute()` 未命中内核工具时查插件工具（`handler(args, ctx)`），异常只影响该次调用，返回值带 `plugin` 字段，人设白名单同样生效。`app/agent.py` 与 `app/config.py` 的白名单过滤改用 `all_tool_names()`（人设可勾选插件工具）。`server.py` 的插件路由分发改读 `runtime.current()`（与工具面同一份状态）。
  - `plugin_check` 新增不变量：**manifest 声明的 `mcp_tools` 必须真的在入口里注册**（声明了却不可用 = I10 反例）。
  - **验收**（`.scratch/tmp/verify_plugin_tools.py`，17 项全通过）：未加载时插件工具不存在且调用返回「未知工具」· 加载后读工具进入 `all_tool_names`/`openai_specs`/文本协议/`list_tool_meta`（带 description 与 plugin）· `execute` 调用成功且带 `plugin` · handler 抛异常只影响该次调用 · 人设白名单可限制 · **`write:true` 工具被拒且原因可读** · HTTP 面 `/api/agent/tools` 含插件工具、不含被拒的写工具 · **无插件时工具面与改造前完全一致**（6 个内核工具）。
- **A9 收尾：7 处文档级 `MutationObserver` 收敛为 1 个共享接缝**：
  - 新增 [`web/dom-seam.js`](web/dom-seam.js)：`window.ERWDom.onChildList(cb, {root, ignore})` —— **一个** MutationObserver 观察 `documentElement` 后按订阅方分发，提供 ① `root` 作用域（保持各补丁原有的观察范围）② `ignore` 过滤（浮球面板 / PDF 阅读区的高频增删）③ **按帧合并**（一帧内多次变更只回调一次）④ **回调隔离**（某订阅方抛异常不影响其它订阅方与内核）。
  - 7 处改写：`v260922-performance.js`（带 ignore 过滤）、`v260922-research-pages.js` 的 5 处（projects / overview-editor-tools / overview-graph / graph-performance / agent-profiles，各自保留 `root` 作用域）、`v260922-layout-bugfixes.js`。**保留** `layout-bugfixes.js` 中那个只观察单卡片行内样式的**属性观察**（语义不同，不属于本轮范围）。
  - **不变量进闸门**：`web_check` 禁止在 `dom-seam.js` 之外自建「配置含 `childList`」的 MutationObserver（负向用例 5 例已验证：自建能抓到、属性观察与注释里的提及不误报）；`ui_smoke` 在运行期断言 observer 实例 == 1、订阅方 ≥ 5。装配清单新增 `dom-seam.js` 并置于所有补丁之前（补丁在求值期就要注册）。
  - **验收**（`.scratch/tmp/verify_dom_seam.py`，8 项全通过，真浏览器）：observer 恰好 **1** 个、订阅方 **7** 个（7 处全部接上）· **作用域生效**（改侧栏不唤醒 `#main` 作用域的订阅方）· **按帧合并**（一帧 3 次变更 → 1 次回调）· **隔离生效**（故意抛异常的订阅方不影响其它，且不泄漏 console error）· **装饰等价** —— 文档分页器「1/2 页 · 共 90 条」与图谱状态条「当前加载 199 / 199」仍由接缝驱动出现。`ui_smoke` 17/17、A10 行为验证、RSS/focus 插件 E2E 全部回归通过。
- **§6/P6 第二件：把「天气」整体搬成插件，并新增顶栏槽位扩展点**：
  - **新扩展点（槽位面板）**：`ERWPanels.register({id, slot:'topbar', renderSlot(container)})` —— 内核在顶栏提供挂载点 `#topbar-slot[data-erw-slot="topbar"]`，并给容器加 `data-plugin="<id>"`，插件只在这个容器里画东西（**不去改内核 DOM**），样式按 §2 作用域。已知槽位在 `core/plugins/manifest.KNOWN_SLOTS`（新增 `P019` 校验）与 `app.js` 的 `ERWPanels.SLOTS` 两处对齐。
  - 新增 [`plugins/weather/`](plugins/weather/plugin.json)：`backend.py`（`app/weather.py` **原样搬入**：天气码表 / 缓存 TTL / 地名解析 / 离线降级）、`web/panel.js`（顶栏卡片 + 设置模态）、`web/panel.css`（天气专有样式）。**配置迁移**：首次运行把内核 `config/app.json` 的 `weather` 段搬进 `config/plugins/weather.json`（实测迁移到用户真实地点「上海市浦东新区」）；缓存改到 `System/Plugins/weather/`。
  - **内核删除**：`app/weather.py`、`GET /api/weather`、`GET /api/weather/geocode`、`config.py` 的 `weather` 默认段、`app.js` 的 `loadWeather` + 设置页天气 tab + 顶栏卡片、`styles.css` 的 `.status-dot` 与窄屏隐藏规则。
  - **顺带修掉一个真 bug（被闸门当场抓出）**：槽位面板曾被 `navGroups()` 一并塞进侧栏导航，于是冒出一个没有页面的 `#weather` 路由，并在 `navigate()` 抛 `render is not a function`。现在 `navGroups()` 跳过槽位面板、`navigate()` 用 `?.render` 守卫。
  - **闸门同步**：`ui_smoke` 区分**导航面板**（须出现在侧栏、须可走查）与**槽位面板**（须真的挂到对应槽位）；`plugin_check` 的面板契约检查覆盖全部插件；`manifest.py` 新增 `P019`（`nav.slot` 必须是已知槽位）。
  - **验收**（`.scratch/tmp/verify_weather_plugin.py`，16 项全通过）：插件清单含 weather（面板 + 样式 URL）· 配置路由可用且已迁移真实地点 · 内核 `/api/weather` 已 404 · **顶栏槽位容器存在且插件把自己的卡片画了进去** · 卡片文本已填充（离线降级显示「天气不可用」）· **插件样式生效**（status-dot 7px 圆点）· 点卡片弹出**插件自己的设置模态**（地点/经纬度/时区/启用 + 搜索坐标 + 保存并刷新）· 保存落盘到插件配置 · 内核 Python 零 weather 痕迹 · `index.html` 只剩槽位 · 全程 0 console error / 0 失败请求。
- **§8 ② 收尾：插件写工具接入草稿确认流**（此前是**明确拒绝注册**，因为写路径会绕过确认）：
  - `core/plugins/loader.py`：写工具不再被拒，改为正常注册并记录「调用时由内核走草稿确认流」。
  - `app/agent_tools.execute()`：插件写工具在 `write_mode != 'direct'` 时**先生成草稿**（返回 `pending` + `draft_id` + 插件归属），**完全不调用插件 handler**；用户确认后 `confirm_draft` 以 direct 模式再进来执行；`reject_draft` 则不动。
  - **为什么闸门必须在内核侧**：插件拿不到 `save_draft`（那是 `app.agent_tools` 的内部能力，也不在 `core_api` 门面里），所以「写工具必须经用户确认」这条**不能指望插件自觉**——由内核统一拦截，插件 handler 只在 direct 模式下真正落盘。
  - **验收**（`.scratch/tmp/verify_plugin_tools.py`，19 项全通过）：读/写工具都进入工具面且写工具带 `write: true` · 读工具直接执行、handler 异常隔离、人设白名单生效 · **confirm 模式只出草稿、插件 handler 未被调用** · `confirm_draft` 真正执行 · `reject_draft` 不执行 · `direct` 模式直接执行 · HTTP 面 `/api/agent/tools` 含读写工具与 `write` 标记 · 未加载插件时工具不存在。
- **本轮收尾：21 套闸门全部通过**。可复跑的验收基线（都在仓库里，只读）：
  - `python tools/kb_smoke.py` —— 数据/关系层冒烟（199 条 / 1854 边）
  - `python tools/web_check.py` —— 前端静态：语法 / 装配清单 / 接缝 / 不变量（含「不得全局替换 `window.fetch`」「文档级 observer 必须走 `ERWDom`」「内核不得调用 `ERWPanels.register`」）
  - `python tools/ui_smoke.py` —— 真浏览器逐路由走查（17 路由 + 导航面板在侧栏 + 槽位面板已挂载 + 首屏不拉重型库 + 0 console error）
  - `python tools/web_manifest.py --check` —— 装配清单与 `index.html` 一致
  - `python tools/plugin_check.py --assert-core-only` —— 插件隔离（I2 依赖方向、core 不依赖 app、零插件合法）+ 面板契约 + `mcp_tools` 声明即注册
  - `python -m core.plugins list|check <id>|verify` —— 插件清单/依赖/冲突
  - `python -m core.doctor` —— 知识库与索引只读体检（当前 2 errors / 7 warnings，均为已知数据问题）
  - `python -m core.index.migrate` / `python -m core.index.maintain` —— 索引结构迁移（默认 dry-run）与维护（默认只读统计）
  - `python -m mcp.server --selftest` —— MCP 工具面自检（problems 为空）
  - `.scratch/tmp/` 下的 12 个夹具套件：插件执行层(19) / 插件工具与写工具草稿闸门(19) / manifest 契约(21) / 路径安全(10) / 三个插件 E2E(16+17+11) / DOM 接缝(8) / A10(6) / 面板注册表(9) / 迁移框架(24) / doctor 护栏与膨胀(各 1) / 规则负向(5+6)
- **未做（留给后续）**：MCP stdio 服务侧的插件工具、`settings_schema` 通用表单（插件目前自带设置 UI）、`ctx.jobs` / `ctx.events`、`A2 剩余`（把补丁并入主题模块、两处 canvas 先画后弃）、`doctor --fix-*`。`index-冲突-Moxise_Win11.sqlite`（6.8 MB 冲突副本）**未删**——删文件需你确认。
- **待决（发布边界）**：`AGENTS.md` 与 `.trae/rules/知识库条目命名规范.md` **均未被 git 跟踪**（白名单 `*` 未放行），而后者正是命名规范的权威文档、上文多处引用它——与 P25「整目录不受版本保护」同类。是否放行入库需要拍板（涉及把本机作业约定与规范文档推到 origin）。
- 注意：`ResearchWorkbench.exe` **未重新打包**；工作台与 MCP 是长驻进程，需**重启**后才加载新契约。

## v261008.2

### 知识库数据结构升级：实验独立成类 + 类型化关系层（底层变更，需重启生效）

- **实验升格为第七类 `experiment`**（`app/store.py`、`app/workspace.py`、`mcp/constraints.py`、`mcp/naming.py`、`mcp/tools_knowledge.py`、`web/app.js`）：目录 `Knowledge/Experiments`、前缀 `实验-`、状态机 计划/进行中/完成/受阻/已归档、日期字段 `record_date`、实验专用正文骨架（摘要/目标与假设/配置与参数/数据与口径/结果/结论与失效模式/留档路径/关联）。原先作为 `note` 类别词的「实验」**废弃**：`mcp/naming.py` 新增 **T020 error** 并在提示里给出迁移出路，T017 编号校验改按 `kind == "experiment"` 判定。前端新增「实验」导航/路由/状态机，图谱节点类别、`KIND_ROUTE`/`routeByKind`/`PAGE_META` 同步。
- **新增 `kb_change_kind` 工具与 `store.change_kind()`**（结构性迁移的唯一合法途径）：`id`/`created` 不变，目录随动、标题前缀改写、首个 H1 同步、状态映射、`kind_marks` 补齐，可选重写全库交叉引用；默认返回迁移计划，`dry_run=false` 才落盘。通用 `kb_update_entry` 仍然拒绝改 `kind`（`IMMUTABLE_FIELDS` 未变）。
- **关系层：关联段小标题 → 类型化边**（`app/store.py` 的 `RELATION_SECTIONS` / `RELATION_LABELS` / `iter_body_links()`，`app/perf_index_core.py`）。关系类型：`uses-knowledge`（依据的知识）、`uses-data`（用到的数据）、`cites`（引用文献）、`series`（同系列实验）、`chain-prev`/`chain-next`（上一/下一环节）、`produces`（产出与汇总），未命中一律退化为通用 `wikilink`。**不新增 frontmatter 字段**；历史条目沿用行内标签写法（`- 方法条目：[[…]]`）即被识别，存量内容无需改写。`graph_edges` 对类型化边**双写**通用 `wikilink` 边，保证只认旧类型的消费方（含前端默认筛选）不受影响。
- **索引结构变更**（`app/perf_index_db.py`）：`SCHEMA_VERSION` 2 → **3**；`document_links` 主键由 `(doc_id, token)` 扩为 `(doc_id, token, role)`，旧库检测缺列后整表重建（纯派生数据）并强制全量重索引；`_rebuild_graph_edges()` 按 role 建边。同步修掉一处**静默失败**：`sync()` 原先把 `OSError`/`UnicodeError` 直接 `continue`，条目会"凭空消失"而无任何提示，现在返回结果带 `skipped` 列表。
- **通用基础知识归属**（`app/perf_index_query.py`、`mcp/bridge.py`、`mcp/tools_knowledge.py`、`server.py`、`web/app.js`）：`kb_list_entries` 与 `GET /api/docs` 新增 `tag`（标签精确筛选，此前只能靠全文搜索命中）与 `unowned`（只看未归属项目）两个过滤维；列表页新增标签筛选项、「未归属项目（通用基础）」与「仅未归属」。约定：跨项目通用知识 `projects` 留空 + 标签 `通用基础`，不建伪项目（避免污染项目仪表盘/里程碑/待办）。
- **新增 `tools/kb_tree.py`**：只读派生索引生成四张视图 —— 知识树（按类别词分层、按"被几个实验交叉使用"分档）、交叉使用清单（同一知识被 ≥N 个实验共用）、实验依赖视图（依据知识/用到的数据/同系列/环节链/产出）、通用基础清单、实验链条与系列；支持 `--section` / `--min-shared` / `--out`，默认输出到 `Workspace/Knowledge/Exports/KnowledgeTree/`。
- **新增 `tools/kb_migrate_experiments.py` 并已执行迁移**：25 条 `知识-实验-…`（note）→ `实验-…`（kind=experiment），`id` 不变、状态按 稳定→完成 / 草稿→计划 / 整理中→进行中 映射、补 ⚗ 标记，全库**改写 139 处**按旧标题写的 WikiLink；并给 DUST 在轨链路（4.5–4.8b，5 条）与 GEO 多对一制导（4 条）两条实验线补 `### 同系列实验` 互指关系。复核：194 条（note 85 / experiment 25 / literature 67 / journal 6 / idea 4 / summary 4 / milestone 3），命名体检零 error。
- **关系实测**（迁移+重建后）：`uses-knowledge` 47、`produces` 6、`chain-prev` 4、`chain-next` 3、`series` 两条系列、`wikilink` 236（保底）、`tag` 1140、`project` 195；`知识-方法-WCS 星图定姿与坏帧判据` 被 7 个实验交叉使用，`知识-方法-受控归因诊断`/`帧间稳像与链式配准` 各 4 个 —— 即"哪些实验交叉使用同一知识"已可直接查出。
- **关系层内容补录（同批次，证据驱动，不发明引用）**：① 建 5 条数据集条目（`知识-数据集-DUST 在轨实测（SET 1 / SET 2）`/`NUAA-SIRST`/`IRSTD-1K`/`NUDT-SIRST`/`SIRST-v2（已退出评测口径）`），把实验反复点名却从未建档的数据集变成可引用对象（未确证的数字不写，标"待补"）；② 按"该实验正文自己点名了某数据集"补 `### 用到的数据` → `uses-data` 25 条边（DUST 10 / NUAA-SIRST 7 / IRSTD-1K 3 / NUDT-SIRST 3 / SIRST-v2 2）；③ 把正文里**以纯文本形式完整出现**的文献题名补成 `### 引用文献` 链接 → `cites` 50 条边、26 个条目获得引用小节；④ 17 条教科书级通用方法（亚像素质心五法、Top-Hat/LCM/SR/IPI、CKF/SCKF/EIF/IF、LQDG/Stackelberg/Minimax）清空项目归属并打 `通用基础` 标签。补录后：199 条（note 90 / experiment 25 / literature 67 / journal 6 / idea 4 / summary 4 / milestone 3），关系边 `uses-knowledge` 52 / `uses-data` 25 / `cites` 50 / `series` 32 / `produces` 7 / `chain-prev` 4 / `chain-next` 3 / `wikilink` 325（保底），未归属条目 23 条。补录脚本一处教训：同批次多次改同一个「关联」段时必须**改前重读磁盘正文**，否则后一步会用旧快照覆盖前一步（本批次踩到并已修正重放）。
- **修复 `_normalize_projects()` 的幽灵归属**（`app/store.py`）：该函数原先只同步 `projects`/`project`，清空归属时残留的 `project_id`/`project_ids` 会让索引（`document_projects` 同时看名字与 id）仍按项目计入——即"清不掉的归属"。现改为名字清空时同步清 id。
- **新增 `tools/kb_smoke.py` 冒烟测试**（只读、可重复）：覆盖关系解析（小标题/行内标签/小节继承/兜底类型）、命名规则（experiment 前缀与编号、旧类别词 T020、缺编号 T017）、归属归一化、关系边与 `document_links.role`、无幽灵归属、七类条目齐备、通用基础标签与未归属可查、`kb_tree` 五张视图可生成、约束主题渲染、实验迁移幂等。当前 **全部通过**。
- **文档**：新增 `docs/KNOWLEDGE_RELATIONS.md`（对象层 / 关系层 / 索引与接口变更 / 迁移记录 / 内容补录 / 通用知识口径 / 论文引用层预留 / 已知陷阱）；`README.md` 增加「知识库结构（七类条目 + 关系层）」小节并更新开发目录；`kb_constraints` 新增 `topic=relations`，`kinds` 主题变七类矩阵，`schema`/`marks`/`playbook` 文案同步（`实验-` 建档、通用基础归属、`kb_change_kind` 红线）。
- 注意：本次只改源码，`ResearchWorkbench.exe` **未重新打包**；`VERSION` 升至 `v261008.2`。工作台 exe 与 MCP 服务是长驻进程，需**重启**后才加载新结构与新工具；重启前旧进程若刷新索引会按旧口径重建（派生数据，重启后自动恢复）。

## v261008.1

### Agent 接入 OpenCode Go（代理 / 直连）与火山方舟 Agent Plan

- 新增三套 Agent API 配置（`config/secret.json` 的 `profiles`）：`profile-opencode-go`（本机 `127.0.0.1:9355` 上的 opencode-go 反代理，`base_url=http://127.0.0.1:9355/zen/go/v1`）、`profile-opencode-go-direct`（**不经任何本地进程**，`base_url=https://opencode.ai/zen/go/v1`）与 `profile-ark-agent-plan`（`base_url=https://ark.cn-beijing.volces.com/api/plan/v3`，方舟 **Agent Plan 专属网关**）。接入本身不改变激活项；切换用 Agent 页顶部「API 配置」下拉或设置页「设为当前配置」。
- **新增档案级自定义请求头**（`profiles[].headers`）：opencode.ai 直连强制要求 `x-opencode-session`（缺它 400 `Request is missing x-opencode-session and cannot be routed efficiently`），工作台原先只发 4 个固定头，故 `app/config.py` 加 `_clean_headers()` 白名单化（头名须 RFC 7230 token、值禁 CR/LF、单值 ≤512 字符、最多 20 条），`app/agent.py` `_api_headers(api_key, extra)` 把它合并进**全部**请求路径（普通补全、SSE 流式、`/models` 探针、对话探针）；`Content-Type` / `Authorization` 由工作台接管不可覆盖，`User-Agent` 允许改写。实测只有 session 是硬要求，`x-opencode-request/client/project` 可省（保留以与官方 CLI 同形）。设置页「Agent API 配置」同步加「自定义请求头（JSON）」输入框（`web/v260922-agent-profiles.js`）。
- 请求模式：每套先给 6 个，默认 `deepseek-v4.1-flash`，另含「· 无思考」（`{"thinking":{"type":"disabled"}}`）、`deepseek-v4-pro`、`glm-5.3`、`doubao-seed-2.1-pro`、`kimi-k3`、`qwen3.8-flash`、`deepseek-v4-flash-vision-exp` 等，均按服务商实际可得模型逐个实测返回 200；超时给到 300s（推理模型长回答 + 阅读区 AI 助手非流式路径）。
- `app/agent.py` `test_connection()` 修复「能用但测不通」：方舟 Agent Plan 不提供 `GET /models`（404），新增回退分支——仅当 /models 报 404/405/501 时，用默认请求模式的模型发一次 16-token 对话探针，返回 `choices` 即判定连通（响应 `probe=chat_completions`、`message` 说明已改用探针）；401/429/5xx 仍原样抛错保留诊断信息。
- 接入验证走工作台自身代码路径（非另写探针）：`test_connection()` + `assist()` 真实补全 + `_post_chat(on_delta=…)` SSE 流式 + `_run_with_tools()` 原生 function calling 工具循环，四套配置全绿（含直连一套：`/models` 直连返回列表、流式 9 个 delta、工具循环命中知识库）；三家的 `reasoning_content` 均能回传并进入「模型思考过程」。
- 踩坑记录三则：①方舟 Agent Plan 网关是 `/api/plan/v3`，误用通用网关 `/api/v3` 或 Coding Plan 网关 `/api/coding/v3` 一律 401；②opencode.ai 侧按 UA 拦访问，`Python-urllib/*` 默认 UA 触发 Cloudflare 1010，工作台自带的 `Workbench/260922.3` 直连与经代理均放行——日后改 `_api_headers` 的 UA 需重新实测；③**旧版 exe 不认识 `headers`**，在旧版设置页点「保存全部配置」会把直连档案的请求头静默抹掉，直连配置需搭配 v261008.1 及以后的 exe（或开发模式）。
- 架构与实测结论记入 `docs/ARCHITECTURE.md`「Agent Provider 接入（v261008）」；`VERSION` 升至 `v261008.1`，`ResearchWorkbench.exe` 已重新打包（2026-10-08 12:11），并用归档解析核对产物内含 `pf-headers` / `_MODELS_UNSUPPORTED_RE` / `extra_headers` / `_clean_headers` 与内嵌 `VERSION=v261008.1`。
- 工具轨迹改为**时间条视图**（v261008b）：`app/agent.py` 的 `_run_with_tools` 为每轮 LLM 调用与每次工具调用记录 `t0/t1`（相对本轮起点毫秒），返回第 5 项 `timing`（总耗时 / 思考累计 / 工具累计 / 轮数 / `timeline` 段列表）并挂到 assistant 消息（SSE `done` 随 `assistant` 回传），`tool_trace` 条目同步补 `t0/t1`。前端把原来的逐条 chip 流水账换成「一行汇总（⏱ 总耗时 · 轮数 · 思考合计 · 工具合计与次数）+ 一条与耗时成比例的堆叠时间条 + 图例（色块 ↔ 工具名，带 ×次数与累计耗时，失败另标 ✗N）+ 可折叠过程明细（逐段名称与耗时，工具名前带同色圆点，草稿的已确认/已拒绝仍保留）」；**思考段用浅灰，每个工具按本消息内首次出现顺序取 8 色调色板中的一色（保证同一条消息里各工具颜色互不相同），失败段固定红色（语义优先于配色）**，悬停任一段显示「名称 · 耗时」。生成中另有一条实时时间条随 `round`/`tool` 事件推进，取色顺序与最终结果一致。渲染器经 `window.ERWFabTimeline` 暴露，Agent 页（`web/app.js`）复用同一套类名与样式（`web/v260930-floating-agent.css`）。旧会话没有 `timing` 时按 `tool_trace` 的 `ms` 顺序兜底成条，并标「旧记录」，不谎报 0 轮 / 0ms 思考。
- 草稿确认卡片紧凑化（v261008b）：待确认从「一张四行卡片」改为**紧凑行**（工具徽标 + 标题同行、确认/拒绝按钮右对齐；≥2 篇仍给「✓ 全部确认 / ✗ 全部拒绝」整批操作条），已处理（已确认/已拒绝）折成**一行汇总**「✓ 已确认 N ✗ 已拒绝 M · 共 X 篇 · 点击展开明细」，明细收进 `<details>` 默认收起（每篇一行：状态徽标 + 工具 + 标题 + 落盘 `doc_id`）。11 篇批量建档的场景由约 11 张卡片（≈900px）压到一行（≈40px）。`data-draft-confirm` / `-reject` / `-confirm-all` / `-reject-all` 四个钩子原样保留，单条与整批确认/拒绝的既有接线（含 `querySelectorAll("[data-draft-confirm]")` 收集 id）不变；旧 `.fab-draft*` 样式保留备回退。渲染器经 `window.ERWFabTimeline.drafts(msg, states)` 暴露，便于离线预览与复用。
- 悬浮球面板**自适应窗口**（v261008b）：内容不再撑破面板。①`.fab-messages` 补 `overflow-x:hidden`，flex 子项统一 `min-width:0`（默认 `min-width:auto` 不肯收缩，是溢出的根因）；②长串断行（`overflow-wrap:anywhere`），宽表格在 `mdRender` 渲染后套 `.fab-tbl` 滚动容器——表格保持自身布局、超宽时在气泡内横滚，Agent 页 `renderMarkdownInto` 同步处理（先试过 `table{display:block}`，实测会把表格压成逐字换行「lite rat ure」，已弃用）；③已处理草稿行改为「徽标 + 标题一行、`doc_id` 另起一行」（实测 298px 可用宽度下徽标 138px + id 171px 已超，标题曾被挤成 0 宽）；④面板尺寸/位置此前只在「恢复」与「拖拽」时钳制，窗口变小后不重算，新增 `reflowPanel()` 在 `resize` 时按当前视口重新钳制面板与悬浮球，尺寸上下限改为随视口推导（`fabMaxW/H`、`fabMinW/H`），避免窄窗口下「下限大于上限」把面板顶出视口。无头浏览器实测：360px 窄面板内塞入 5 列宽表 + 长英文题名 + 长 `doc_id`，8 项断言全 PASS（消息区 358/358 无横向溢出，表格在 276px 容器内滚动 947px）；预置 900×900 尺寸与 (800,700) 位置后缩小窗口，面板被钳制为 456×357@(32,102)，7 项断言全 PASS。
- 修复 Agent 页（`web/app.js`）与 SSE 后端的协议错位：`/api/agent/send` 自 v260930k 改为 SSE，v260930m 又把 `done` 负载瘦身成只回 `assistant`，而 Agent 页仍按旧 JSON 契约读 `r.session.id`（`api()` 对流式响应 `res.json()` 抛错后返回 `{}`），表现为发消息即报 `Cannot read properties of undefined (reading 'id')`。新增 `streamAgentSend()` 消费 `round|delta|tool|done|error` 事件（delta 增量就地渲染进思考气泡、round 显示工具循环轮次），`done` 后回读 `GET /api/agent/sessions/<id>` 补齐会话对象，故其后的既有渲染逻辑一行未改；悬浮球（`web/v260930-floating-agent.js`）本就是 SSE 版，不受影响。已用 Node 同构脚本对着运行中的服务实测 round→delta→done→会话回读全通。
- 消息元信息去重（v261008b）：悬浮球与 Agent 页的元信息行原本并排显示 `model` 与「请求模式标签」，而标签通常自带模型名（`deepseek-v4.1-flash` + `DeepSeek V4.1 Flash（默认）`），同一件事报两遍。新增 `metaParts()`——归一化（去空格/点/连字符/括号）后标签已含模型名则只留标签，标签确实不同才两者都留，人设名始终保留；悬浮球经 `window.ERWFabTimeline.metaParts` 暴露给 Agent 页复用。自检五例：`术语建档员 · DeepSeek V4.1 Flash（默认）`、`DeepSeek V4.1 Flash · 无思考`、`qwen3.8-flash · 默认（不附加参数）`、`glm-5.3`、空（旧消息只剩时间）。
- 用量计费口径升级（v261008b，`app/billing.py` + `web/v261008-billing.js` + `web/v261008-billing.css`；该模块本身为 v261008 新增，此处一并补记）：①**按档案区分计费方式**——`prices.json` 新增 `plans` 段（`mode=token|subscription|free`），订阅套餐（OpenCode Go · 直连/代理、火山方舟 Agent Plan）只统计用量、金额项不适用，不再被算成「缺单价」；②**单价键支持档案限定**，优先级 `档案id/模型名` → `档案id`（该档案兜底价）→ `模型名`（含 `*` 通配），解决同一模型在不同 Provider 价格不同的问题；③**缓存命中率**进入总览卡片与按会话/按模型表（命中部分按 `cache_hit`、未命中输入按 `input` 计），长上下文 Agent 的最大成本变量终于可见；④**缺单价闭环**：总览新增「缺单价」清单（按 档案+模型 聚合并给出建议键）与「加入单价表」按钮，一键生成待填条目并跳到编辑框；⑤**usage 缺失也落账**（`usage_missing`），调用次数与实际一致；⑥老账本（无 `billing_mode` 字段）在**读取时按当前 plans 推导**归位，账本文件仍只增不改。实测：47 条历史调用由「未计价 47 / 请补全单价表」变为「订阅内 47 · 缺单价 0」，命中率 72.5%（输入 1,078,568 中命中 781,952，计费输入 296,616）；真跑一次对话后新记录带 `billing_mode=subscription`、`priced=true`、`plan_label`。另修 `billing.py` 顶层 `from .workspace import ...` 在「billing 作为首个 app 模块」时的循环导入（改为延迟导入、先初始化 config）。
- 订阅制**按官方定价换算等价标价**（v261008b，续上条）：①单价条目新增可选 `currency`（直接粘贴官方人民币标价即写 `"currency":"CNY"`），价格表顶层新增 `fx` 参考汇率（语义 1 USD = N 该币种，预置 `{"CNY":7.1}`，可在单价表里改），新增 `convert_cost()` 统一折算，缺汇率的条目标 `fx_missing`（等价记 0，不猜数）；②订阅/免费档案除 `cost_usd`（实付口径，订阅记 0）外另记 `equiv_usd`（等价标价），token 模式两者相同；③`summary()` 给出 `equiv_usd` / `subscription_equiv_usd`，页面新增「等价标价合计」卡片、订阅档案表与按模型表的「等价标价」列（明示为参考、非实付）；④老账本读取时用**当前单价表**补算等价标价（仍是视图层：不改账本文件，也不改 token 模式写入时冻结的实付金额）；⑤价格表预置 DeepSeek 官方标价（`deepseek-v4.1-flash` 与官方名 `deepseek-flash`：空闲时段 输入 1 元、缓存命中 0.02 元、输出 4 元 / 百万 tokens，高峰时段为该值 2 倍），来源 [api-docs.deepseek.com「模型 & 价格」](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)（2026-10-08 核对，与七牛云同模型页标价一致）。实测你那 48 次调用按此折算 ≈ **$0.0831**（≈0.59 元），其中 OpenCode Go·直连 Zen 47 次 ≈$0.0829、方舟 Agent Plan 1 次 ≈$0.00015——订阅制"省下多少"终于可见。计费纯函数自检 17/17 通过（含档案限定键优先、通配、计费口径、人民币折算、缺汇率处理、老账本归位与实付冻结、`fx`/`currency` 归一化）。
- Agent 对话页排版优化（v261008c，`web/styles.css` + `web/v260922-agent-profiles.js`）：①原 `.agent-message` 锁死 `max-width:920px` 且助手气泡左对齐，1828px 宽屏下右侧空出 600+px——改为整条会话（消息列 + 引用条 + 输入框）共用一条**居中阅读列**（`--agent-col:1180px`，以 `padding-inline:max(6px,calc((100% - var(--agent-col))/2))` 实现），助手气泡放宽到 1080px、用户气泡 900px，≤1100px 自动回退通栏；②`.agent-message-body` 的 `overflow-wrap:anywhere` 会把表格单元格里的英文逐字断开（实测 `literature` → `literat/ure`、表头「中 1」竖排），改为 `break-word`，并补齐消息内表格样式（`width:max-content` 保持自身列宽 + 表头 `nowrap` + 渲染时已套的 `.fab-tbl` 容器内横滚，与悬浮球同一套做法），正文 12→13px；③输入区「API 配置」旁的徽标原本把下拉框已选中的配置名重复显示一遍，改为显示**接口地址主机**（`opencode.ai` / `127.0.0.1:9355` / `ark.cn-beijing.volces.com`，悬停看完整 base_url）——直连还是走本地反代理一眼可辨；④输入区与引用条套用同一条阅读列，与消息对齐。无头浏览器按用户截图同尺寸（1828×1109）与窄屏（980×860）各验一次：宽屏会话列居中、表格列宽正常且超宽在气泡内横滚，窄屏回退通栏、输入区自动换行。**v261008d · 对齐与秩序**：原 `.agent-message.user{align-self:flex-end}` 会把「YOU 头像 + 气泡」整体推到右边，YOU 与 AI 的开头相差数百像素（用户反馈「两个对话开头不对齐」）；改为**统一栅格 + 全部左对齐**——两角色的 `article` 同宽同起点、头像固定占第一列（`--agent-gutter:36px`），**AI 与 YOU 的气泡一律从「头像右侧」同一条线起笔**（YOU 气泡 `width:fit-content` 贴合文字，短消息不被拉成一条空框；角色靠头像与底色区分），并让聊天头 / 消息列 / 引用条 / 输入框共用同一条列宽 `--agent-col-inner:1080px`——整页只剩一条对齐轴。已用真实短会话（两轮问答，截图后删除）在 1828×1000 核对：四个头像落在同一竖线、四个气泡左缘同为 x≈697；用户真实长会话（含 5 列表格与耗时时间条）复核无回归。

## v260929.1

### 文献 PDF 工作区合并（四阶段方案落地）

- 并入上游 `feature/literature-pdf-workspace` 40 个提交：PDF 上传与流式阅读、三栏文献工作区、矩形/手绘/文字批注、区域截图预览、批注笔记，合并后按方案分四阶段与既有文献条目体系融合。
- **阶段 1 · 共存接入**：移除对 `kind='literature'` 页面的整体接管，文献列表/编辑器（BibTeX 双向同步、自动 cite_key、元数据表单）原样保留；工作区改由列表页头部「PDF 阅读工作区」按钮进入，工作区内提供「← 返回文献列表」按钮。
- **阶段 2 · 数据互认**：上传 PDF 即同步创建 literature md 条目（`attachment` 指向 `Knowledge/Literature/PDF/`，cite_key 自动生成），`doc_id` 双向关联写入 `library.json`；删除文献时联动清理 md 条目（均入 Trash）；列表「⧉ 附件」徽章优先跳转工作区阅读，未登记附件退回新窗口直开。
- **阶段 3 · 真值归一**：元数据以 md 条目为唯一真值——工作区列表/详情 join 回读 md（编辑器改题名/作者/DOI 即时生效于检索与展示），工作区侧改元数据经 `indexer.update_doc` 回写 md 并刷新索引；新增「重建关联」按钮与 `POST /api/literature/rebuild`（幂等：补 doc_id 关联、旧附件 PDF 复制入库登记、孤儿条目补建 md）；修复上游遗留的 `/api/literature/export-bibtex` 路由错位（误置于 GET 分发致 POST 落入泛匹配 404）。
- **阶段 4 · 自动填写**：文献编辑器新增「自动填写」行——粘贴 DOI（CrossRef）或 arXiv 编号（arXiv API）联网抓取回填，粘贴 BibTeX 文本则前端本地解析回填；cite_key 按第一作者姓氏 + 年份生成；回填仅覆盖空字段并提示核对。
- **附件入口统一与存放空间合并**：列表「⧉ 附件」徽章点击一律跳转 PDF 阅读区（原浏览器新窗口直开并入工作区）；未登记的附件自动单条登记（`rebuild` 支持 `doc_id`）后重试打开；附件 PDF 统一存放于 `Knowledge/Literature/PDF/`——Workspace 内的旧附件（如 `Knowledge/Attachments/`）原地移动迁入不留双份，Workspace 外绝对路径仅复制不破坏外部文件。
- 打包提醒：`web/` 与 `VERSION` 均为构建期注入，改动后须重跑 `build_client.bat` 才对 exe 生效；开发模式重启服务即生效。

## v260924.1

### 分类标记

- 内置分类标记新增 `model`（⬡ 模型）与 `principle`（∑ 原理），候选由 8 个扩展到 10 个。
- `模型` 用于可建模对象：物理动力学模型、参数化抽象、可训练网络；`原理` 用于记录某个方法的具体原理与公式：机理推导、口径与度量定义、判据式。
- 标记与条目命名规范的类别词对齐：`架构`→`architecture`、`方法`→`method`、`模型`→`model`、`原理`→`principle`、`实验`→`experiment`、`数据集`→`data`。`.trae/rules/知识库条目命名规范.md` 中原「类别词不新增 `kind_marks` 取值、`模型` 类条目沿用 `method` 标记」条款同步修订为「类别词与 `kind_marks` 一一对应」。
- 标记仍为前端固定常量，保存写入 frontmatter `kind_marks`；后端存储、索引与 `/api/docs?mark=` 过滤均按字符串处理，无 schema 变更、无需数据库迁移。
- 按新映射对存量 `知识-` 笔记批量重标记（2026-09-24 10:16，经 `store.update_doc` 写入并自动记录 `doc_update`）：65 篇中 25 篇标记与新规范不一致，已全部对齐 —— `模型` 16 篇由 `method` 改为 `model`，`原理` 4 篇由 `data` / `architecture` / `thinking` 等代用标记改为 `principle`，`方法` 4 篇去除 `synthesis` / `thinking` / `experiment` 代用标记，`架构` 1 篇去除其中 `method`；其余 40 篇（`方法` 20、`实验` 16、`架构` 3、`数据集` 1）原本合规未动。重标记后 `知识-` 笔记标记分布（篇）：`knowledge` + `method` 24、`knowledge` + `model` 16、`knowledge` + `experiment`（含叠加 `method` / `data`）16、`knowledge` + `architecture` 4、`knowledge` + `principle` 4、`knowledge` + `data` 1。

### 条目拆分

- 按《知识库条目命名规范》§四.4「禁止「A 与 B」式跨族合写标题（一篇只讲一个知识点或一个族）」拆分 2 篇「一篇多实验」条目为 9 篇单实验条目（2026-09-24 10:55，经 `store.create_doc` / `delete_doc` 写入并自动记录 `doc_create` / `doc_update` / `doc_delete`）：`知识-实验-传统单帧检测方法对比与失效机理（1.1/1.2）`（含 1.1/1.1b/1.2/1.2b/1.2c/1.2d/1.2e 七项实验）拆为 7 篇，`知识-实验-数据集难度分级与深度学习批量基线（2.0/2.1）` 拆为 2 篇。
- 新条目：`知识-实验-小区域滤波单帧检测基线（1.1）`、`知识-实验-小区域滤波虚警改进（1.1b）`、`知识-实验-传统单帧经典方法对比（1.2）`、`知识-实验-LCM 失效根因诊断（1.2b）`、`知识-实验-四方法增强域受控归因（1.2c）`、`知识-实验-IPI 强云层帧虚警根因（1.2d）`、`知识-实验-四方法环境适用性分层（1.2e）`、`知识-实验-数据集结构实测与难度分级（2.0）`、`知识-实验-深度学习批量基线（2.1）`；`kind_marks` 沿用原主题标记（阶段 1 七篇叠 `method`，阶段 2 两篇叠 `data`），`project_id` 经 `apply_doc_project_ids` 补写。
- 原 2 篇经 `delete_doc` 移入 `Workspace/System/Trash/note/`（可回滚）；全库互引同步：`知识-实验-GEO单帧经典检测（1.3g）` 中指向原条目的管线来源行改指新的 1.1b / 1.2 两篇，扫描确认无其余残留引用。
- 全库同类问题排查：其余 63 篇标题均为「单类别词 + 单一对象」，`知识-方法-传统红外小目标检测` 为声明的「同目标多方法归类」篇、三篇制导实验条目以括号补充侧面而非跨族合写，均不属此问题。

### 打包

- `ResearchWorkbench.exe` 由 PyInstaller onefile 打包，`web/` 与 `VERSION` 在构建时写入包内（`--add-data "web;web" --add-data "VERSION;."`）；冻结运行时 `ASSET_ROOT = sys._MEIPASS`，**修改 `web/` 或 `VERSION` 后必须重新执行 `build_client.bat`**，改动才对 exe 生效，直接跑开发模式（`python server.py` / `run.bat`）读的是仓库目录。
- 本版本已重新打包（2026-09-24 10:11），确认 exe 内 `/app.js` 含 `model` / `principle`，`/api/health` 返回 `v260924.1`。

## v260922.3

### 性能优化

- 新增 SQLite 可重建索引，Markdown 仍作为唯一真实数据源。
- 文档、项目、标签、待办、活动和知识关系改为索引查询，减少大规模 Workspace 下的重复扫描。
- 文档列表支持服务端分页，全文搜索接入 FTS5。
- Workspace 文件树改为按需加载。
- Dashboard、项目统计和科研活动改为聚合查询。
- 新增索引状态、手动重建接口及性能测试脚本。

### 知识图谱优化

- 知识图谱改用 Force-Directed Layout，并加入社区辅助布局。
- 新增 Semantic Zoom、标签 LOD、标签碰撞检测和 Edge LOD。
- 新增节点搜索、实时联想、最近编辑、自动定位和 Camera 聚焦。
- 新增一阶 / 二阶 `Focus + Context` 关系浏览。
- 建立邻接表、布局缓存、投影缓存、Viewport Culling 和 `requestAnimationFrame` 合帧。
- 2D / 3D 共用统一的搜索、选择和 Focus 逻辑。
- 修复搜索框、Canvas、预览区等 UI 层级覆盖问题。
- 「研究 · 知识总览」中的知识关系预览同步升级为新版绘图方式。

### 界面

- 新增类似 ChatGPT Web 的左侧栏收起 / 展开功能。
- 侧栏状态自动保存，收起后主区域自适应扩展。

### Agent / LLM

- Agent 配置升级为多套 API Profile，可独立保存并快速切换。
- API Key 改为直接保存在本地 `config/secret.json`，不再依赖环境变量。
- 每套 Profile 独立支持：
  - Base URL；
  - API Key；
  - 超时时间；
    -最大输出 Token；
  - Temperature；
  - 是否显示思考；
  - 多套 Request Mode。
- Request Mode 支持独立配置模型、Temperature 和扩展 `params`。
- Agent 设置页改为结构化配置管理界面，不再手动编辑整段 Preset JSON。
- Agent 对话页支持选择当前 API Profile 和 Request Mode。
- 模型调用统一使用 OpenAI-compatible Chat Completions。

### 配置迁移

- 首次升级时自动读取旧版 Agent 配置并生成「未命名配置」。
- 兼容旧 `app.json`、`secrets.json` 和 `api_key_env`。
- 原有 Base URL、模型、请求模式、超时和思考设置等会尽量自动迁移。
- 新版密钥配置保存在 Git 忽略的 `config/secret.json` 中。

## v260922.2

* 优化「核心工作 → 概览」页面布局，整体调整为更紧凑的科研仪表盘结构，提高桌面端信息密度并减少纵向空白。
* 重构概览页模块排列：科研热力图与学业进度 / 毕业条件组成顶部区域，「今日科研桌面」与「快速记录」作为左侧组合，并与右侧科研节奏、当前任务和近期节点统一对齐。
* 调整「今日科研桌面」与「快速记录」的高度分配，减少今日概览卡片无效留白，同时为快速记录提供更充足的操作空间。
* 「当前任务」与「近期节点」统一限制为最多显示 3 条记录；无记录或记录较少时仍保持合理的卡片最小高度，避免概览布局塌缩。
* 调整「项目推进」与「最近研究活动」布局，使两组内容顶部对齐；最近灵感、最近笔记和最近工作总结分别支持最多展示 10 条近期记录。
* 优化项目推进、统计卡片、列表项、导航栏、顶部栏及卡片间距，使整体界面在保持可读性的同时更加紧凑。
* Markdown 编辑界面新增独立缩放控制，支持分别调整编辑区和预览区显示比例，范围为 10%–200%，100% 对应原始显示大小。
* 编辑区与预览区缩放比例分别保存到本地浏览器，页面刷新或重新进入编辑界面后自动恢复上次设置。

## v260922.1

* 新增「核心工作 → 项目」管理模块，支持项目新建、编辑、重命名、状态修改和删除，并展示描述、最近编辑及关联内容统计。
* 项目改用稳定 `project_id` 作为唯一索引；旧 Workspace 启动时自动为历史项目补充 ID，并迁移笔记、灵感、里程碑和待办等项目关联。
* 项目重命名后保持原 ID 和知识关联不变；删除项目时解除关联，并将项目工程目录移入 Workspace 回收目录。
* 修复知识图谱 Markdown 预览中的本地图片路径解析，支持正常显示 Workspace 附件图片。
* 修复「研究 · 知识总览」近期里程碑，仅显示计划中节点的问题；现在默认展示当前日前后约半年的全部状态里程碑。
* 里程碑普通时间轴与 3D 时间轴新增状态筛选，支持计划、进行中、受阻、完成等状态，并在视图切换时保留筛选条件。

## v260921.1

- 修复知识图谱右侧长文本不换行。
- 新增知识图谱节点 Markdown 预览抽屉；支持真实文档和项目/标签虚拟节点。
- 里程碑 3D 时间线新增 Markdown 预览抽屉与“打开编辑”。
- 知识图谱新增空白画布拖动、Ctrl/Cmd+滚轮缩放、3D Alt/右键旋转与一键全览。
- 设置中心新增“服务与存储”页，暴露 Host、Port、自动打开浏览器、Workspace、迁移策略；天气启用开关和 LLM provider_label 也可视化。

## workbench-v260921 · 2026-09-21

### 本轮新增

- 文档新增「分类标记」：每条 Markdown 可挂载多个标记（知识 ◈ / 归类 ◎ / 方法 ⚒ / 问题 ？），编辑器元信息区以 chip 多选，保存写入 frontmatter `kind_marks` 字段。
- 列表条目显示彩色标记胶囊；文档筛选栏新增标记下拉，后端 `/api/docs` 支持 `mark` 参数按标记过滤。
- 标记候选为前端固定常量（图标与颜色内置），与配置解耦，不再依赖 `custom_kinds`。
- 新增本地私密配置 `config/secrets.json`：在 `env` 对象中填入 `"环境变量名": "密钥值"`，服务运行中保存后自动注入进程环境变量（修改时间检测热重载，无需重启），`run.bat` 启动无需每次手动设置 API Key。该文件已被 `.gitignore` 排除，不会上传 git；Key 依旧不进入 `config/app.json` 与接口返回。

### 本轮修复与调整

- 修复笔记分屏/预览模式下 Markdown 界面无法使用滚轮阅读的问题。
- 笔记编辑器顶部表单区紧凑化；项目选择弹窗修复项目名竖排折行，选择框高度与其它控件统一，备注输入移至选择框下方。

### 本轮移除

- 移除自定义笔记类型机制（`custom_kinds`）：侧栏入口、`kind-` 路由、设置页「笔记类型」管理、后端 `custom_kinds()` 配置读取与 `Knowledge/Custom` 目录；原四类图标与颜色由分类标记固定候选继承。

## workbench-v260920.2 · 2026-09-20

### 本轮新增

- 概览「项目推进」新增“＋ 新建项目”，无需先进入资源页面。
- 研究条目的项目字段改为已有项目选择器：默认空白、支持多项目、支持移除，不再手动输入项目名称；待办项目也限制为已有项目。
- Agent API Key 机制改为环境变量：新增 `api_key_env`，默认 `OPENAI_API_KEY`；服务运行时从 `os.environ` 读取，不再创建或更新 `config/secrets.json`。
- Agent 默认请求模式增加三套：默认、Qwen 低思考（`enable_thinking=true` + `thinking_budget=1024`）、Qwen 无思考（`enable_thinking=false`）。
- Agent 输入改为乐观渲染：发送后用户消息立即出现在对话区，模型调用期间显示思考状态与耗时。
- Agent 支持从兼容接口提取 `reasoning_content` / `reasoning` / `thinking` / `analysis`，并通过设置项控制是否展示。
- Agent 用户消息在外部模型调用前写入会话历史；即使模型请求失败，也尽可能保留本轮用户输入。
- 知识图谱点击空白处可清除当前选中节点与邻接高亮。
- 更新自检：覆盖环境变量密钥、无本地 secrets 文件、模型 reasoning 提取、项目选择器与图谱取消高亮。

### 上一轮整合内容

本版本延续 workbench 独立工程，并整合此前图谱、资讯、Agent 与 Markdown 能力：

- 修复资讯模块：arXiv RSS 增加官方 Atom API 回退与短重试；全部抓取失败时不再覆盖有效缓存，也不缓存空失败结果；资讯页显示每个源的实际状态与详细诊断。
- Markdown 标签 placeholder 改为 `标签1, 标签2, 标签3`。
- Agent 增加 JSON 请求模式配置，可把供应商自定义请求参数动态合并到 Chat Completions / Responses API 请求；对话页可逐轮选择请求模式。
- Markdown 编辑时 `Ctrl/Cmd + S` 改为保存当前文档并阻止浏览器“保存网页”。
- 修复知识图谱从 3D 切换 2D 后旧动画循环继续绘制的问题。
- 选中图谱节点时，高亮当前节点、一阶相邻节点和相关边，并弱化其它图元。
- 图谱新增标签节点和标签关系；项目关系升级为多项目；Markdown 支持 `projects: []`，同时保留 `project` 兼容字段。
- 图谱筛选增加“关系来源”：显式引用 / 标签关联 / 项目归属。
- 关联 Markdown 导出改为继承当前图谱可见节点与关系，不再使用未过滤图谱；支持直接以标签或项目虚拟节点作为导出核心。
- 自检覆盖多项目、标签图谱、筛选导出、动态 Agent 请求参数和 RSS arXiv 回退。
