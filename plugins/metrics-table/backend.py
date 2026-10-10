"""指标表 · 插件后端 v1.0.0

**数据表化作为插件**：内核不加新 kind、不动契约，指标就写在**条目正文**里（KB 仍是唯一事实来源），
本插件负责约定、聚合、缺项提示与导出。

## 约定：正文里的 ```metrics 块

````markdown
```metrics
mIoU: 0.732
Pd: 91%
Fa: 3.2e-6
Params: 25.4M
```
````

- `键: 值` 一行一项（也接受 `键 = 值`）；空行与 `#` 开头的注释行忽略；
- 值可以是数字、百分比、科学计数、带单位后缀（`25.4M`、`12ms`）——统计时取数值部分，单位单独记；
- 一条条目可以有多个 `metrics` 块，**后者覆盖前者**（同名键）；
- 任何 kind 的条目都可以带（实验条目最常用；`知识-数据集-…` 这类 note 也适用）。

## 为什么不做成新 kind

kind 矩阵是**内核契约**（`core/contracts/kinds.py` 是唯一声明处）：新增 kind 要同时改存放目录、
标题前缀、状态机、正文骨架、字段契约、索引与命名校验——那是"把功能搬进内核"，与 SCOPE 的分层相反。
指标本质是**条目里的结构化内容**，用正文块表达就够：可搜索、可 diff、随条目一起进备份与报告，
而且**任何条目**都能带，不必先决定它属于哪个 kind。

## 写路径

- 读：`core_api.entries/entry`（与 `/api/docs` 同源），只读。
- 写：只通过**写工具** `p_metrics-table__record_metrics`（`spec.write = True`）——内核在 confirm 模式下
  先生成草稿，用户确认后才以 direct 模式调用本插件的 handler；handler 里走 `core_api.entry_update`
  （内核的校验写入路径）。插件**不直接改文件**，面板也不提供"直接改条目"的按钮。
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime

import core_api

DEFAULT_CONFIG = {
    "block_name": "metrics",     # 正文里的块名（```metrics）
    "kinds": ["experiment"],     # 默认只看这些 kind（可改）
    "include_undated": True,
}
MAX_ROWS = 300

_NUM = re.compile(r"^([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*([^\d\s]*)\s*$")


# ---------------------------------------------------------------- 解析

def parse_metrics(body: str, block_name: str = "metrics") -> tuple[dict[str, str], list[str]]:
    """从正文里抽 ```<block_name> 块 → ({键: 原始值}, 警告列表)。

    容错优先：块没闭合、键空、重复键都只记警告，不让整张表崩掉。
    """
    warnings: list[str] = []
    text = str(body or "")
    open_re = re.compile(r"^[ \t]*```[ \t]*" + re.escape(block_name) + r"[ \t]*$", re.MULTILINE)
    metrics: dict[str, str] = {}
    for match in open_re.finditer(text):
        rest = text[match.end():]
        end = re.search(r"^[ \t]*```[ \t]*$", rest, re.MULTILINE)
        if end is None:
            warnings.append(f"```{block_name} 块没有闭合（已忽略这一段）")
            continue
        for raw_line in rest[: end.start()].splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            parts = re.split(r"[:：=]", line, maxsplit=1)
            if len(parts) != 2:
                warnings.append(f"跳过无法解析的行：{line[:40]}")
                continue
            key, value = parts[0].strip(), parts[1].strip()
            if not key:
                warnings.append(f"跳过没有键的行：{line[:40]}")
                continue
            metrics[key] = value
    return metrics, warnings


def split_number(raw: str) -> tuple[float | None, str]:
    """把 `91%` / `3.2e-6` / `25.4M` 拆成 (数值, 单位)。非数值 → (None, 原文)。"""
    text = str(raw or "").strip().replace(",", "")
    match = _NUM.match(text)
    if not match:
        return None, text
    try:
        return float(match.group(1)), match.group(2)
    except ValueError:
        return None, text


def upsert_metrics_block(body: str, metrics: dict, mode: str = "merge",
                         block_name: str = "metrics") -> str:
    """把指标写进正文的 ```<block_name> 块：**merge** 合并 / **replace** 整体替换。

    正文其余部分**逐字保留**（只动那个块），块不存在就追加到末尾。
    """
    text = str(body or "")
    incoming = {str(k).strip(): str(v).strip() for k, v in (metrics or {}).items() if str(k).strip()}
    if not incoming:
        raise ValueError("metrics 为空，没什么可写")

    open_re = re.compile(r"^[ \t]*```[ \t]*" + re.escape(block_name) + r"[ \t]*$", re.MULTILINE)
    match = open_re.search(text)
    existing: dict[str, str] = {}
    if match is not None:
        rest = text[match.end():]
        end = re.search(r"^[ \t]*```[ \t]*$", rest, re.MULTILINE)
        if end is None:
            raise ValueError(f"正文里已有的 ```{block_name} 块没有闭合，请先手工修好再写")
        for raw_line in rest[: end.start()].splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            parts = re.split(r"[:：=]", line, maxsplit=1)
            if len(parts) == 2 and parts[0].strip():
                existing[parts[0].strip()] = parts[1].strip()
        merged = dict(existing)
        merged.update(incoming)
        if mode == "replace":
            merged = dict(incoming)
        block = "```" + block_name + "\n" + "\n".join(f"{k}: {v}" for k, v in merged.items()) + "\n```"
        # 注意偏移基准：`end` 是在 `rest`（开围栏之后）里匹配到的，要加回 `match.end()` 才是正文里的绝对位置
        head, tail = text[: match.start()], text[match.end() + end.end():]
        return head + block + tail

    if mode == "replace":
        pass                      # 没有旧块，replace 与 merge 等价
    block = "```" + block_name + "\n" + "\n".join(f"{k}: {v}" for k, v in incoming.items()) + "\n```"
    base = text.rstrip()
    return (base + "\n\n" + block + "\n") if base else (block + "\n")


# ---------------------------------------------------------------- 聚合

def _entry_meta(row: dict) -> dict:
    return {
        "id": row.get("id"), "kind": row.get("kind"),
        "title": row.get("title"), "status": row.get("status"),
        "projects": row.get("projects") or [],
        "date": row.get("record_date") or str(row.get("updated") or row.get("created") or "")[:10],
    }


def build_table(rows: list[dict], *, block_name: str, with_body: bool = True) -> dict:
    """把条目列表聚合成表格：列 = 指标键的并集（按出现频次与首次出现排序）。"""
    records: list[dict] = []
    warnings: list[str] = []
    for row in rows:
        body = ""
        if with_body:
            try:
                body = str(core_api.entry(str(row.get("id"))).get("body") or "")
            except FileNotFoundError:
                continue
        metrics, warn = parse_metrics(body, block_name)
        warnings.extend(f"{row.get('title')}：{w}" for w in warn)
        if metrics:
            records.append({**_entry_meta(row), "metrics": metrics})

    order: list[str] = []
    for record in records:
        for key in record["metrics"]:
            if key not in order:
                order.append(key)

    columns = []
    for key in order:
        values: list[float] = []
        units: dict[str, int] = {}
        filled = 0
        for record in records:
            if key not in record["metrics"]:
                continue
            filled += 1
            number, unit = split_number(record["metrics"][key])
            if unit:
                units[unit] = units.get(unit, 0) + 1
            if number is not None:
                values.append(number)
        columns.append({
            "key": key, "filled": filled, "missing": len(records) - filled,
            "numeric": len(values), "unit": max(units, key=units.get) if units else "",
            "min": min(values) if values else None, "max": max(values) if values else None,
            "mean": (sum(values) / len(values)) if values else None,
        })

    for record in records:
        record["missing"] = [c["key"] for c in columns if c["key"] not in record["metrics"]]
    return {"rows": records, "columns": columns, "warnings": warnings[:20]}


def to_csv(table: dict) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    keys = [c["key"] for c in table["columns"]]
    writer.writerow(["id", "kind", "title", "status", "date"] + keys)
    for row in table["rows"]:
        writer.writerow([row["id"], row["kind"], row["title"], row.get("status") or "", row.get("date") or ""]
                        + [row["metrics"].get(k, "") for k in keys])
    return "\ufeff" + buf.getvalue()      # 带 BOM：Excel 打开中文才不乱码


def to_markdown(table: dict) -> str:
    keys = [c["key"] for c in table["columns"]]
    if not keys:
        return "# 指标表\n\n（没有条目带指标块）\n"
    head = ["条目", "类别", "状态", "日期"] + keys
    lines = ["| " + " | ".join(head) + " |", "| " + " | ".join(["---"] * len(head)) + " |"]
    for row in table["rows"]:
        cells = [str(row.get("title") or ""), str(row.get("kind") or ""),
                 str(row.get("status") or ""), str(row.get("date") or "")]
        cells += [row["metrics"].get(k, "—") for k in keys]
        lines.append("| " + " | ".join(cells) + " |")
    return "# 指标表\n\n" + "\n".join(lines) + "\n"


# ---------------------------------------------------------------- 对外接口

def register(ctx):
    ctx.storage.ensure()

    def config() -> dict:
        cfg = dict(DEFAULT_CONFIG)
        saved = ctx.config_read({})
        if isinstance(saved, dict):
            cfg.update({k: v for k, v in saved.items() if k in DEFAULT_CONFIG})
        cfg["block_name"] = str(cfg.get("block_name") or "metrics").strip() or "metrics"
        kinds = cfg.get("kinds")
        cfg["kinds"] = [str(k) for k in kinds] if isinstance(kinds, list) else list(DEFAULT_CONFIG["kinds"])
        return cfg

    def _scope(request) -> tuple[str, str]:
        query = request["query"]
        project = str((query.get("project") or [""])[0])
        kind = str((query.get("kind") or [""])[0])
        return project, kind

    def _rows(project: str, kind: str, cfg: dict) -> list[dict]:
        if kind:
            return core_api.entries(kind, project=project, limit=MAX_ROWS)
        out: list[dict] = []
        for k in (cfg["kinds"] or ["experiment"]):
            out.extend(core_api.entries(k, project=project, limit=MAX_ROWS))
        # 其它 kind 也可能带指标块：按 kind 过滤时看不到，这里只在「全部」范围里补上
        if not project:
            seen = {r["id"] for r in out}
            for k in core_api.kind_order():
                if k in (cfg["kinds"] or []) or k == "literature":
                    continue
                for row in core_api.entries(k, limit=MAX_ROWS):
                    if row["id"] not in seen:
                        out.append(row)
                        seen.add(row["id"])
        return out[:MAX_ROWS]

    def route_table(request):
        cfg = config()
        project, kind = _scope(request)
        rows = _rows(project, kind, cfg)
        table = build_table(rows, block_name=cfg["block_name"])
        table["scope"] = {"project": project, "kind": kind}
        table["config"] = cfg
        table["scanned"] = len(rows)
        table["with_metrics"] = len(table["rows"])
        table["hint"] = ("" if table["rows"] else
                         f"没有条目带 ```{cfg['block_name']} 块。在条目正文里加一段即可被收录，例如："
                         f"```{cfg['block_name']}\\nmIoU: 0.732\\nPd: 91%\\n```")
        return table

    def route_entry(request):
        doc_id = str((request["query"].get("id") or [""])[0])
        if not doc_id:
            return {"ok": False, "error": "缺少 id"}
        try:
            entry = core_api.entry(doc_id)
        except FileNotFoundError:
            return {"ok": False, "error": f"条目不存在：{doc_id}"}
        cfg = config()
        metrics, warnings = parse_metrics(str(entry.get("body") or ""), cfg["block_name"])
        return {"ok": True, **_entry_meta(entry), "metrics": metrics, "warnings": warnings,
                "has_block": bool(metrics), "block_name": cfg["block_name"],
                "preview": str(entry.get("body") or "")[:600]}

    def route_export(request):
        cfg = config()
        project, kind = _scope(request)
        fmt = str((request["query"].get("format") or ["csv"])[0]).lower()
        table = build_table(_rows(project, kind, cfg), block_name=cfg["block_name"])
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        base = f"metrics-{project or kind or 'all'}-{stamp}".replace(" ", "-")
        if fmt == "md":
            return ctx.raw(to_markdown(table), content_type="text/markdown; charset=utf-8",
                           filename=f"{base}.md")
        return ctx.raw(to_csv(table), content_type="text/csv; charset=utf-8", filename=f"{base}.csv")

    def route_config_get(request):
        return config()

    def route_config_post(request):
        body = request.get("body") or {}
        cfg = config()
        for key in DEFAULT_CONFIG:
            if key in body:
                cfg[key] = body[key]
        ctx.config_write({**DEFAULT_CONFIG, **cfg})
        return config()

    ctx.routes.get("table", route_table)
    ctx.routes.get("entry", route_entry)
    ctx.routes.get("export", route_export)
    ctx.routes.get("config", route_config_get)
    ctx.routes.post("config", route_config_post)

    # ---------------------------------------------------------------- Agent 工具

    def tool_table(args, call_ctx=None):
        args = args or {}
        cfg = config()
        project = str(args.get("project") or "")
        kind = str(args.get("kind") or "")
        table = build_table(_rows(project, kind, cfg), block_name=cfg["block_name"])
        return {
            "columns": [{k: c[k] for k in ("key", "filled", "missing", "unit", "min", "max", "mean")}
                        for c in table["columns"]],
            "rows": [{**{k: r[k] for k in ("id", "title", "status", "date")}, "metrics": r["metrics"],
                      "missing": r["missing"]} for r in table["rows"]],
            "warnings": table["warnings"],
            "hint": f"指标写在条目正文的 ```{cfg['block_name']} 块里（键: 值 一行一项）；"
                    f"没有条目带指标块时先让 Agent 用 record_metrics 记录",
        }

    def tool_record(args, call_ctx=None):
        args = args or {}
        doc_id = str(args.get("entry_id") or "").strip()
        metrics = args.get("metrics")
        mode = str(args.get("mode") or "merge")
        if not doc_id:
            raise ValueError("entry_id 不能为空")
        if not isinstance(metrics, dict) or not metrics:
            raise ValueError('metrics 必须是非空对象，如 {"mIoU": "0.732", "Pd": "91%"}')
        if mode not in ("merge", "replace"):
            raise ValueError("mode 只能是 merge 或 replace")
        entry = core_api.entry(doc_id)                      # 条目不存在会抛 FileNotFoundError
        new_body = upsert_metrics_block(str(entry.get("body") or ""), metrics, mode,
                                        config()["block_name"])
        updated = core_api.entry_update(doc_id, body=new_body)
        ctx.log(f"已把 {len(metrics)} 项指标写入 {doc_id}（{mode}）")
        return {"ok": True, "entry_id": doc_id, "title": updated.get("title"), "mode": mode,
                "written": {str(k): str(v) for k, v in metrics.items()}}

    ctx.mcp.tool("metrics_table", {
        "description": "读跨条目的指标对照表（列 = 指标键并集，含列统计与缺项）。范围可用 project/kind 收窄。",
        "parameters": {
            "type": "object",
            "properties": {
                "project": {"type": "string", "description": "只看某个项目（留空 = 全部）"},
                "kind": {"type": "string", "description": "只看某一类条目（留空 = 配置里的类别，默认 experiment）"},
            },
        },
    }, tool_table)

    ctx.mcp.tool("record_metrics", {
        "description": ("把指标写进某条条目正文的 ```metrics 块（mode=merge 合并 / replace 覆盖）。"
                        "这是**写操作**：内核会先生成草稿，用户确认后才落盘。"),
        "write": True,
        "parameters": {
            "type": "object",
            "properties": {
                "entry_id": {"type": "string", "description": "条目 id（如 experiment-…）"},
                "metrics": {"type": "object", "description": "指标键值对，如 {\"mIoU\": \"0.732\", \"Pd\": \"91%\"}"},
                "mode": {"type": "string", "enum": ["merge", "replace"], "description": "默认 merge"},
            },
            "required": ["entry_id", "metrics"],
        },
    }, tool_record)

    ctx.log("指标表插件已注册（/api/plugins/metrics-table/{table,entry,export,config}；"
            "写工具 p_metrics-table__record_metrics 走内核草稿闸门）")
