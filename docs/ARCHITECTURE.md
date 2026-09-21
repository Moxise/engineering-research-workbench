# Architecture · workbench-v260920.2

```text
Browser SPA
  web/index.html
  web/styles.css
  web/app.js
       │
       │ JSON HTTP
       ▼
ThreadingHTTPServer (server.py)
       │
       ├─ app/config.py       配置、环境变量密钥状态、Agent 请求预设
       ├─ app/workspace.py    Workspace / 项目目录 / 迁移
       ├─ app/store.py        Markdown、标签/项目/WikiLink 图谱、BibTeX、导出
       ├─ app/activity.py     科研活动 / 热力图
       ├─ app/todos.py        Todo
       ├─ app/search.py       全局检索
       ├─ app/agent.py        会话、图像、知识引用、OpenAI-compatible 调用
       ├─ app/rss.py          RSS/Atom、arXiv fallback、缓存与诊断
       └─ app/weather.py      Open-Meteo
```

## Markdown metadata

```yaml
---
id: note-...
kind: note
title: 示例笔记
project: 论文A
projects: [论文A, 项目B]
tags: [LLM, Agent]
status: 整理中
---
```

`project` 是向后兼容的第一主项目，`projects` 是完整多项目集合。

## Knowledge graph

节点：

- Markdown 文档节点；
- `tag:<name>` 虚拟标签节点；
- `project:<name>` 虚拟项目节点。

边：

- `wikilink`：正文 `[[WikiLink]]`；
- `tag`：文档 → 标签；
- `project`：文档 → 项目。

浏览器端先按“节点类别 + 关系来源”生成 filtered graph，2D/3D 渲染、邻域计算和 Markdown 导出都基于同一份 filtered graph，因此“当前显示什么，导出就采用什么”。

## Agent request presets

`config/app.json` 中 `llm.request_presets`：

```json
[
  {"id":"default","label":"默认","params":{}},
  {"id":"high","label":"高思考","params":{"reasoning_effort":"high"}}
]
```

前端每轮发送 `request_preset`。后端只从已配置预设中取 `params`，并合并到 API 请求体；核心字段受到保护。

## RSS resilience

arXiv 来源支持 RSS → 官方 Atom API 自动回退。若全源失败：

- 有旧缓存：返回旧内容并标记 `stale=true`；
- 无旧缓存：返回诊断但不写空缓存；
- 强制刷新始终重新发起网络请求。


## Agent 密钥边界（v260920.2）

工作台只保存 `llm.api_key_env`（环境变量名称）。真实 API Key 由 `app/agent.py` 在请求发生时从 `os.environ` 读取，不进入 Workspace、`config/app.json` 或 Agent 会话文件。
