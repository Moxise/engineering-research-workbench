# Agent 系统：技能、持久化任务与科研记忆

本分支在原有科研聊天工具循环上增加完整的本地 Agent 运行层。入口是 Agent 页面、悬浮助手里的 **Agent 系统**，以及设置页中的 **任务、记忆、技能与执行设置**。

## 数据设计与 CortexDB 的对应关系

参考仓库：[liliang-cn/cortexdb](https://github.com/liliang-cn/cortexdb)，研究基线提交 `5965a15cf2c0a3c5c6a26e010209e8322976c45f`。重点参考 `pkg/cortexdb/knowledge_memory_types.go` 中的作用域、来源、有效期、替代关系，以及 Recall 的 ContextPack 数据契约。

本实现使用 Python 标准库 SQLite，未复制 CortexDB 源码，也不要求安装 Go 或运行 CortexDB 服务。它借鉴数据组织和检索设计，不声称与 CortexDB 文件格式或 API 兼容。CortexDB 的 RDF/SPARQL、OWL、HNSW 索引和分布式共享脑不在本实现范围内。

| CortexDB 思路 | 工作台实现 |
| --- | --- |
| 单 SQLite 记忆与关系存储 | `Workspace/System/Agent/brain.sqlite`，WAL、外键、事务与在线备份 |
| Scoped memory | `global/user/project/session`，namespace 与 scope_id 联合隔离 |
| 记忆类型 | fact/preference/procedure/decision/episode |
| 来源与生命周期 | source、importance、TTL、active/superseded/forgotten |
| 稳定标识更新 | 同作用域相同 memory_key 的新内容替代旧记忆，保留历史 |
| 无 Embedding 可工作 | FTS5，中文双字索引，实体关联扩展 |
| 混合检索 | 可提交已有的 memory embedding/query_embedding，余弦相似度与词法结果做 RRF 融合 |
| ContextPack | 带 `[MEM id]`、来源、条数与字符预算的召回结果包 |

向量模式是有界精确扫描，目前最多读取 10,000 条有向量记忆；未配置外部 Embedding 自动生成服务。没有向量时明确使用 `lexical_graph`，不会把词法检索伪称为语义检索。

数据库保存会话、消息、任务、检查点、事件、工具调用、记忆、关系和草稿投影。研究 Markdown、PDF 仍保存在原有目录中。草稿 JSON 是现有界面的审批接口载体。

旧 `System/AgentChats/chat-*.json` 首次访问时幂等导入。消息按稳定 id 合并，删除标记防止旧文件重新导入。会话写入后仍生成 JSON 投影，继续兼容已有会话同步和备份机制。原始工具参数与返回值会随会话证据投影保存。

**不要通过文件同步直接复制运行中的 SQLite/WAL。** 现有同步继续同步会话 JSON；长期记忆、任务和运行状态目前保留在本机数据库。跨机器转移完整脑数据使用系统界面的“备份记忆库”，该操作调用 SQLite 在线备份；恢复时先停止服务，再用备份替换 `brain.sqlite`，清除旧的同名 WAL/SHM 后启动。不能同时运行两个服务实例写同一个 Agent 工作区。

## Skill

内置技能：`literature-review`、`knowledge-curation`、`research-analysis`。

用户技能目录：

```text
Workspace/System/Agent/Skills/my-skill/
├── SKILL.md
├── references/         # 可选，文本参考
├── assets/             # 可选，模板与输入
└── scripts/            # 可选，Python 脚本
```

```markdown
---
name: my-skill
description: 描述技能用途和适用任务。
allowed-tools: kb_search kb_read
---

具体工作流程、验收标准和来源要求。
```

启动只加载技能名称、描述与兼容性；模型用 `skill_read` 按需读取指令和资源。输入 `$my-skill` 可显式激活。用户同名技能优先于内置技能。资源路径经过解析后必须仍处于该技能目录中。

`allowed-tools` 是技能的说明性元数据，不是授权来源。实际执行始终受人设工具白名单、运行设置和写入审批限制。Frontmatter 支持字符串字段及缩进的描述块；复杂 YAML 对象不是运行配置。界面可安装文本技能，带资源的完整技能目录可由用户复制到上述目录。安装不会执行脚本。

## 任务执行与上下文

普通 `/api/agent/send` 仍输出兼容的 SSE 事件，但实际执行已转为后台任务。新增 `run` 事件提供任务 id；浏览器断线不取消任务。停止按钮向任务发送取消信号；任务中心支持暂停、继续和失败重试。

每个会话最多一个 queued/running/pausing 任务。写入前记录工具执行预留，执行后记录完整结果。进程重启把遗留任务标为 interrupted；用户继续时从检查点恢复。已成功的调用按 call_id 复用结果；预留后进程中断而结果未知的调用返回 uncertain，要求读取核对，不会自动重放副作用。

审批流程：模型生成草稿 → 状态 waiting_approval → 用户检查正文并确认或拒绝 → 点击“继续” → 将真实审批结果交还模型继续执行。确认操作先持久化 executing 状态，并串行执行，防止重复点击造成重复写入；若进程在写入期间退出，executing 草稿需人工核对目标内容，不能直接重复确认。

默认每次执行 48 轮、900 秒软预算。达到预算会暂停并保留检查点；继续后获得新的执行预算。取消在模型流片段和工具边界检查，不能撤销已经完成的写入，也不能强行中断正在等待的非流式网络请求；它会在请求返回后停止下一步。

历史保留工具调用及原始返回，不再只保留聊天文字。上下文预算使用本地字符启发式估算，未宣称与供应商 tokenizer 完全一致。超预算时以消息组为单位进行摘录式压缩，保持 assistant/tool 配对；完整证据通过 `evidence_read(run_id, call_id, offset)` 重读。超出预算的单次输入会明确报错。此版本没有额外调用模型生成语义摘要。

自动召回仅使用当前会话、当前项目及用户/全局记忆。Agent 保存长期记忆使用 `memory_remember`，遵循写入模式；不把每段对话自动当成事实。记忆正文会过滤 `<private>` 和常见凭证格式，原始聊天和工具事件仍是本地执行记录，不能当作脱敏日志对外发布。

## 科研工具与写入保护

- `kb_search/kb_read`：索引检索、分页读取，返回正文哈希版本。
- `kb_create_entry/kb_update_entry/kb_rollback`：命名与查重、更新草稿、版本冲突检测、修订回退。整体覆盖必须带 `expected_version`；追加可读取最新版本后执行。
- `lit_context/lit_note_write/pdf_read`：元数据、文献笔记、按页读取 PDF，最多五页，扫描件可能需要 OCR。
- `workspace_list/workspace_read`：只允许 Knowledge/Projects/Resources 中的研究文件，拒绝越界与链接逃逸。
- `web_search/web_fetch`：通过 Crossref 检索论文元数据，读取公开网页。网页工具拒绝本地/私有地址，重定向重新检查，大小与等待时间有上限；网页内容始终作为参考数据。
- `memory_recall/memory_remember/plan_update/evidence_read`：来源记忆、任务计划和完整工具证据。
- `python_run/skill_run`：Docker 隔离 Python 运行与产物保存。

Python 运行默认关闭。使用前安装并启动 Docker，事先拉取运行设置中指定的镜像（默认 `python:3.12-slim`），再启用隔离代码执行。容器无网络、只读根文件系统、非 root 用户、去除 Linux capabilities，限制 CPU、内存、进程数和时间。仅复制显式选择的研究输入；结果写入专用 `/output` 挂载。日志/产物大小由运行器轮询限制，输出目录不是容器磁盘配额。宿主机不直接执行模型代码。打包 exe 也通过 Docker 中的 Python 运行，不依赖 exe 自身充当解释器。

PDF 工具需要 `pip install -r requirements.txt`。桌面构建会包含 pypdf 和内置技能目录。

## MCP 连接

实现 Streamable HTTP JSON-RPC（JSON/SSE 响应，协议版本 `2025-03-26`），不支持 stdio、OAuth 交互登录或旧版 HTTP+SSE 双端点传输。配置示例：

```json
[
  {
    "name": "papers",
    "url": "http://127.0.0.1:9000/mcp",
    "enabled": true,
    "tools": ["search", "save_note"],
    "read_only_tools": ["search"],
    "headers_env": {"Authorization": "PAPERS_MCP_AUTH"}
  }
]
```

环境变量保存完整请求头值，例如 `Bearer …`。配置中不填写凭证本身。保存后刷新连接，检查诊断，然后到人设编辑器勾选所需远端工具。只有显式 tools 白名单中的工具会被注册；未列入 read_only_tools 的工具默认按写操作审批。新任务可重新发现已配置工具。

## API

| 操作 | 接口 |
| --- | --- |
| 系统与设置 | `GET /api/agent/system`，`POST /api/agent/settings` |
| 后台任务 | `POST /api/agent/runs`，`GET /api/agent/runs?session_id=...` |
| 任务详情/游标事件 | `GET /api/agent/runs/<id>`，`GET /api/agent/runs/<id>/events?after=<seq>` |
| 任务控制 | `POST /api/agent/runs/<id>/pause|cancel|resume|retry` |
| 记忆 | `GET /api/agent/memories?session_id=...&project_id=...`，`POST /api/agent/memory/remember|recall|forget` |
| 关系 | `GET /api/agent/memory/graph?session_id=...&project_id=...` |
| 技能 | `GET /api/agent/skills`，`POST /api/agent/skills/install|read` |
| MCP | `POST /api/agent/mcp/refresh` |
| 一致性备份 | `POST /api/agent/backup` |

运行设置只存本机 `System/Agent/runtime.json`。模型 API Key 继续由现有配置层管理，不写入任务请求或运行检查点。

## 验证

`python -m unittest discover -s tools -p test_agent_system.py -v` 在一次性工作区使用脚本化模型验证：迁移、作用域隔离、中文/关系/向量检索、替代与 TTL、Skill 加载、真实工具证据跨轮回放、审批后续跑、文本协议、轮数暂停、重启恢复、停止信号、写入防重复、冲突和修订回退、MCP 白名单、HTTP 后台任务及 SSE 断线继续。

`node tools/agent_system_ui_check.js` 使用 Playwright 和本地 API fixture 验证桌面/移动界面、任务审批续跑、记忆增删、技能安装、设置、MCP 诊断、备份和键盘关闭。需让 NODE_PATH 指向可用 Playwright 安装。

这些测试验证执行与数据契约，不代表任意模型的科研结论正确率；真实模型任务质量需要使用具体研究数据和验收标准评估。
