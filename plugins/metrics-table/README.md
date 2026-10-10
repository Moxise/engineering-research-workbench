# 指标表（`metrics-table`）

**数据表化作为插件**：把条目正文里的 ````metrics` 块聚合成**跨条目对照表**——列 = 指标键并集、
缺项显式标出、附列统计（min/max/mean）、可导出 CSV / Markdown。

## 为什么不是「新增一个 kind」

kind 矩阵是**内核契约**（`core/contracts/kinds.py` 是唯一声明处）：新增 kind 要同时改存放目录、
标题前缀、状态机、正文骨架、字段契约、索引与命名校验——那是"把功能搬进内核"，与 SCOPE 的分层方向相反。

指标本质是**条目里的结构化内容**。写成正文块就够了，而且更好：

| | 正文块 | 新 kind |
| --- | --- | --- |
| 是否可被全文检索 / 图谱 / 报告 / 备份覆盖 | ✅ 自动覆盖（它就是条目的一部分） | 要逐处适配 |
| 是否必须先决定"这条属于哪个 kind" | ❌ 不用，任何条目都能带 | ✅ 要 |
| 是否需要动内核 | ❌ 零改动 | ✅ 契约 + 索引 + 校验 + 骨架 |

## 约定：正文里的 `metrics` 块

````markdown
```metrics
mIoU: 0.732
Pd: 91%
Fa: 3.2e-6
Params: 25.4M
```
````

- `键: 值` 一行一项（也接受 `键 = 值`）；空行与 `#` 注释行忽略；
- 值可以是数字、百分比、科学计数、带单位（`25.4M`、`12ms`）——统计时取数值部分，单位单独记并在表头提示；
- 一条条目可有多个块，**同名键后者覆盖前者**；块名可在设置里改（默认 `metrics`）；
- 默认扫描 `experiment`，可在设置里改；选「全部」时也会扫其它 kind（含 `知识-数据集-…` 这类 note）。

## 写入方式（安全边界）

**插件不直接改条目文件**。写只有一条路：

- Agent 工具 `p_metrics-table__record_metrics`（`spec.write = true`）→ 内核在 confirm 模式下**先生成草稿**，
  用户确认后才以 direct 模式调用本插件 handler → handler 走 `core_api.entry_update`（内核的校验写入路径：
  字段白名单取自 `core/contracts`、原子写、记 `doc_update` 活动）。
- 面板**不提供**"直接改条目"的按钮：它只读 + 导出，并给出让 Agent 记录的提示与块格式。

`mode=merge` 合并（未提到的键保留）/ `mode=replace` 整体覆盖；正文其余部分**逐字保留**，只动那个块。

## 接口

| 路由 | 作用 |
| --- | --- |
| `GET table?project=&kind=` | 表格数据：`columns`（含 filled/missing/unit/min/max/mean）、`rows`（含每行缺项）、`warnings`、`hint` |
| `GET entry?id=` | 单条条目的指标、解析警告、正文预览 |
| `GET export?format=csv\|md&project=&kind=` | 下载（CSV 带 BOM，Excel 打开中文不乱码） |
| `GET\|POST config` | 块名、默认扫描类别 |

Agent 工具：`p_metrics-table__metrics_table`（读）、`p_metrics-table__record_metrics`（写，走草稿闸门）。

## 边界

- 只解析 `键: 值` 这种**确定性**结构；不做"从正文里猜指标"（猜错比不猜更糟）。
- 块没闭合、行无法解析、键为空 → 只记 `warnings` 并在页面顶部提示，不让整张表崩掉。
- 写入遇到已有块没闭合时**拒绝写**（`ValueError`），避免把正文改坏。
- 单次最多 300 条（`MAX_ROWS`），够覆盖一个项目的实验对照。
