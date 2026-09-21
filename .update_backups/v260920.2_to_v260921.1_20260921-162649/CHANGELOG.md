# CHANGELOG

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
