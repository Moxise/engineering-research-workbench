# workbench-v260921.1 · 工科科研工作台

这是一个独立运行、本地优先、Markdown-first 的工科科研工作台。研究资产保存在项目目录下的 `Workspace/`；前端负责仪表盘、知识图谱、全文检索、科研 Agent、里程碑时间轴和可视化。

## 启动

要求 Python 3.11+，后端仅使用 Python 标准库。

```powershell
python server.py
```

Windows 也可以直接运行 `run.bat`。默认地址：`http://127.0.0.1:8765`。

## v260921.1 本轮更新

- 修复知识图谱节点详情中的长文本溢出，项目名、标签和提示文字都会自动换行。
- 知识图谱选中节点后，会在画布与控制栏之间展开 **Markdown 预览**；真实知识条目直接渲染原 Markdown，项目/标签节点则根据当前可见关系生成只读 Markdown 预览。
- 里程碑 **3D 时间线**点击卡片后同样打开 Markdown 预览，并可从预览直接进入文档编辑。
- 知识图谱在未选中节点时支持拖动空白画布平移；3D 视图支持 `Alt/右键 + 拖动`旋转，`Ctrl/Cmd + 滚轮`缩放，并新增 **一键全览**。
- 设置中心新增 **服务与存储**：Host、Port、启动时是否自动打开浏览器、Workspace 路径、旧数据识别/复制策略都可视化配置。天气启用开关与 Agent 接口名称也已加入页面设置。
- 完整继承 v260920.2 的项目选择器、环境变量 API Key、Agent 动态思考模式、资讯回退、Ctrl/Cmd+S、标签/项目/WikiLink 图谱关系等能力。

### Agent API Key 配置

方式一（推荐）：填入本地私密文件 `config/secrets.json`。该文件已被 `.gitignore` 排除，不会上传 git：

```json
{
  "env": {
    "OPENAI_API_KEY": "你的密钥"
  }
}
```

保存后自动注入环境变量（无需重启服务）。若你在设置中填写的是其它变量名，例如 `DASHSCOPE_API_KEY`，在 `env` 中添加对应条目即可：

```json
{
  "env": {
    "DASHSCOPE_API_KEY": "你的密钥"
  }
}
```

方式二：临时环境变量（仅当前会话有效）：

```powershell
$env:OPENAI_API_KEY="你的密钥"
python server.py
```

> 工作台不会把 Key 回写到 `config/app.json` 或任何接口返回中。`config/secrets.json` 只存在于本机，请勿提交到 git。

## 本版重点

### 1. 资讯模块修复

资讯页仍以 RSS / Atom 为主，但不再把失败隐藏成“暂无资讯”。现在会显示每个来源的成功/失败状态、错误原因和实际使用的备用接口。

对于默认的 arXiv RSS，服务端会依次尝试：

1. `rss.arxiv.org` 原始 RSS；
2. arXiv 官方 Atom API；
3. Atom API 的 HTTP 兼容回退。

同一来源会短暂重试。若本次全部来源失败但本地已有历史缓存，会继续显示旧内容并明确标注“缓存内容”；全失败的空结果不再覆盖有效缓存，也不会被缓存 15 分钟，因此“强制刷新”会真正重新尝试网络请求。

### 2. Markdown 标签提示

灵感、研究日志、笔记、里程碑、工作总结和文献的新建/编辑界面，标签输入框提示统一为：

```text
标签1, 标签2, 标签3
```

不会再显示具体研究方向示例。

### 3. Agent 动态请求参数 / 思考模式

`设置 → Agent / LLM` 新增“动态请求模式（JSON）”。可自行定义不同供应商需要的请求体参数，例如：

```json
[
  {
    "id": "default",
    "label": "默认",
    "params": {}
  },
  {
    "id": "off",
    "label": "关闭思考",
    "params": {
      "enable_thinking": false
    }
  },
  {
    "id": "high",
    "label": "高思考",
    "params": {
      "reasoning_effort": "high"
    }
  }
]
```

对话输入区会自动生成“请求模式”下拉框，每一轮都可以动态切换。`params` 会安全合并进模型请求体；`model`、`messages`、`input`、`instructions` 等核心字段受到保护，不能被预设覆盖。

这个机制既可用于 `enable_thinking`，也可用于 `reasoning_effort`、`thinking`、`top_p` 等 OpenAI-compatible 服务的自定义参数。

### 4. Ctrl / Cmd + S 保存当前 Markdown

当 Markdown 编辑器存在且当前正在编辑文档时：

```text
Ctrl + S
Cmd + S
```

会直接调用工作台的 Markdown 保存操作，并阻止浏览器弹出“保存网页”。

### 5. 知识图谱 3D → 2D 切换修复

图谱每次重绘都会生成新的渲染 token。切换到 2D 后，之前 3D 模式的 `requestAnimationFrame` 循环会立即失效，不会继续在同一个 Canvas 上覆盖新的 2D 画面。

### 6. 选中节点高亮邻接关系

点击任意图谱节点后：

- 当前节点加粗描边并放大；
- 一阶相邻节点放大并加粗标签；
- 与当前节点直接相连的边加粗并使用强调色；
- 其它节点与边降低透明度。

2D / 3D 两种图谱均使用同一套高亮逻辑。

### 7. 图谱关系扩展：引用 + 标签 + 多项目

知识图谱现在有三类显式来源：

```text
[[WikiLink]]  → wikilink / 显式引用
Tag           → tag / 标签关系
Project       → project / 项目归属
```

Markdown 支持多个项目：

```yaml
project: "论文A"
projects: ["论文A", "项目B", "实验C"]
tags: ["LLM", "Agent", "供电恢复"]
```

`project` 保留为第一主项目以兼容旧数据，`projects` 是新的多项目列表。编辑器使用逗号分隔输入多个项目。

标签和项目都以可选虚拟节点进入图谱；图谱页面可以独立控制：

- 显示哪些节点类别；
- 显示哪些关系来源（引用 / 标签 / 项目）。

因此，如果取消显示“项目”，所有项目节点和项目边都会实时消失；如果关闭“项目归属”关系，项目节点即使可见也不会产生关联边。

## 关联 Markdown 导出与当前图谱完全一致

“整理关联 Markdown”不再从未过滤的后台图谱重新计算，而是直接基于**当前页面可见图谱**计算一阶/二阶邻域。

这意味着：

- 隐藏某种节点类别 → 导出时忽略它；
- 关闭某种关系来源 → 导出时忽略对应边；
- 选择“标签”节点 → 可以批量整理该标签关联的 Markdown；
- 选择“项目”节点 → 可以批量整理该项目关联的 Markdown；
- 多项目文档会同时出现在多个项目关系中。

生成文件会明确记录“关系索引仅包含生成时当前可见的节点类别与关系类型”。

## 核心模块

### 核心工作

- 概览：学业进度、毕业条件、科研热力图、科研节奏、项目推进、待办、近期里程碑；
- 待办；
- 专注计时；
- 科研 Agent；
- 资讯。

### 研究 · 知识

- 总览；
- 灵感；
- 研究日志；
- 笔记；
- 里程碑；
- 工作总结；
- 文献；
- 知识图谱。

### Markdown

支持：GFM、任务列表、表格、截图粘贴/拖拽、代码高亮、LaTeX、Mermaid、`[[双链]]`。图片保存在：

```text
Workspace/Knowledge/Attachments/YYYY/MM/
```

### 全局搜索

快捷键：

```text
Ctrl/Cmd + K
```

统一检索 Markdown 标题/正文/标签/项目、文献元数据、待办和 Agent 历史对话。

## Workspace

```text
Workspace/
├─ Knowledge/
│  ├─ Ideas/
│  ├─ Journals/
│  ├─ Notes/
│  ├─ Milestones/
│  ├─ Summaries/
│  ├─ Literature/
│  ├─ Attachments/
│  └─ Exports/
├─ Projects/
├─ Resources/
└─ System/
```

## 数据原则

1. Markdown 是研究知识的唯一主数据源；
2. 图谱、搜索、热力图都是派生视图；
3. 项目与标签关系不会复制文档正文；
4. API Key 只从用户指定的操作系统环境变量读取；工作台配置只保存环境变量名称，不保存 Key 本身；
5. 外部网络失败不能影响本地 Markdown CRUD；
6. 只有明确引用的 Markdown、当前消息和当前图片会发送给所配置的 LLM 服务。

## 自检

```powershell
python tools/self_check.py
```

覆盖 Markdown CRUD、多项目、标签/项目图谱、筛选导出、BibTeX、图片、Todo、Agent 动态请求参数、科研热力图、RSS 解析与 arXiv 备用策略、Python/JavaScript 语法。
