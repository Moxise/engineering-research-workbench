from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import uuid
import threading
from datetime import date, datetime
from pathlib import Path
from typing import Any

from .workspace import ensure_workspace, ensure_project
from . import activity, config

BUILTIN_KIND_DIR = {
    "idea": "Knowledge/Ideas",
    "journal": "Knowledge/Journals",
    "note": "Knowledge/Notes",
    "milestone": "Knowledge/Milestones",
    "summary": "Knowledge/Summaries",
    "literature": "Knowledge/Literature",
}

BUILTIN_KIND_LABEL = {
    "idea": "灵感",
    "journal": "实验记录",
    "note": "笔记",
    "milestone": "里程碑",
    "summary": "工作总结",
    "literature": "文献",
}

BUILTIN_STATUSES = {
    "idea": ["待整理", "探索中", "已采纳", "已归档"],
    "journal": ["记录", "复盘", "已归档"],
    "note": ["草稿", "整理中", "稳定", "已归档"],
    "milestone": ["计划", "进行中", "受阻", "完成"],
    "summary": ["草稿", "已定稿", "已归档"],
    "literature": ["待阅读", "阅读中", "已精读", "已归档"],
}

_CUSTOM_KIND_RE = re.compile(r"^[a-z][a-z0-9_-]{0,47}$")

def _knowledge_cfg() -> dict[str, Any]:
    raw = config.get_app().get("knowledge_types") or {}
    return raw if isinstance(raw, dict) else {}

def custom_kind_records() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set(BUILTIN_KIND_DIR)
    for raw in (_knowledge_cfg().get("custom") or []):
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("id") or "").strip().lower()
        if not _CUSTOM_KIND_RE.fullmatch(kind) or kind in seen:
            continue
        label = str(raw.get("label") or kind).strip()[:32] or kind
        icon = str(raw.get("icon") or "◆").strip()[:4] or "◆"
        statuses = [str(x).strip()[:24] for x in (raw.get("statuses") or []) if str(x).strip()]
        if not statuses:
            statuses = ["草稿", "进行中", "完成", "已归档"]
        template = str(raw.get("template") or "").replace("\r\n", "\n")
        out.append({
            "id": kind,
            "label": label,
            "icon": icon,
            "statuses": list(dict.fromkeys(statuses))[:12],
            "template": template,
            "hidden": bool(raw.get("hidden", False)),
        })
        seen.add(kind)
    return out

def knowledge_type_registry() -> list[dict[str, Any]]:
    cfg = _knowledge_cfg()
    hidden = {str(x) for x in (cfg.get("hidden") or [])}
    custom = {x["id"]: x for x in custom_kind_records()}
    default_order = ["idea", "journal", "note", "milestone", "summary", "literature", *custom.keys()]
    order = [str(x) for x in (cfg.get("order") or []) if str(x)]
    order = list(dict.fromkeys([*order, *default_order]))
    rows: list[dict[str, Any]] = []
    builtin_icons = {"idea":"✦","journal":"▤","note":"▧","milestone":"⚑","summary":"▣","literature":"◫"}
    for kind in order:
        if kind in BUILTIN_KIND_DIR:
            rows.append({
                "id": kind, "label": BUILTIN_KIND_LABEL[kind], "icon": builtin_icons[kind],
                "statuses": list(BUILTIN_STATUSES[kind]), "builtin": True,
                "hidden": kind in hidden, "template": kind_template(kind),
                "default_template": kind_default_template(kind),
            })
        elif kind in custom:
            rows.append({**custom[kind], "builtin": False, "hidden": bool(custom[kind].get("hidden")) or kind in hidden,
                         "template": kind_template(kind), "default_template": kind_default_template(kind)})
    return rows

def kind_dir_map() -> dict[str, str]:
    out = dict(BUILTIN_KIND_DIR)
    for row in custom_kind_records():
        out[row["id"]] = f"Knowledge/Custom/{row['id']}"
    return out

def kind_label_map() -> dict[str, str]:
    out = dict(BUILTIN_KIND_LABEL)
    for row in custom_kind_records():
        out[row["id"]] = row["label"]
    return out

def kind_statuses(kind: str) -> list[str]:
    if kind in BUILTIN_STATUSES:
        return list(BUILTIN_STATUSES[kind])
    for row in custom_kind_records():
        if row["id"] == kind:
            return list(row["statuses"])
    return []

def all_statuses() -> dict[str, list[str]]:
    return {kind: kind_statuses(kind) for kind in kind_dir_map()}

def builtin_kind_default_template(kind: str) -> str:
    if kind == "idea":
        return "# {{title}}\n\n## 想法\n\n\n## 为什么值得记录\n\n\n## 下一步\n\n- [ ] \n"
    if kind == "journal":
        return "# {{title}}\n\n## 实验目的\n\n\n## 实验配置\n\n\n## 实验结果\n\n\n## 结论\n\n"
    if kind == "note":
        return "# {{title}}\n\n## 摘要\n\n\n## 正文\n\n\n## 关联\n\n"
    if kind == "milestone":
        return "# {{title}}\n\n## 目标\n\n\n## 验收条件\n\n- [ ] \n\n## 进展记录\n\n"
    if kind == "summary":
        return "# {{title}}\n\n## 本阶段完成\n\n\n## 结果与产出\n\n\n## 问题与经验\n\n\n## 下一阶段\n\n- [ ] \n"
    if kind == "literature":
        return "# {{title}}\n\n## BibTeX\n\n```bibtex\n{{bibtex}}\n```\n\n## 核心结论\n\n\n## 方法与数据\n\n\n## 与当前研究的关系\n\n\n## 摘录与批注\n\n"
    return "# {{title}}\n\n## 要点\n\n\n## 正文\n\n\n## 关联\n\n"


def kind_default_template(kind: str) -> str:
    if kind in BUILTIN_KIND_DIR:
        return builtin_kind_default_template(kind)
    for row in custom_kind_records():
        if row["id"] == kind:
            return str(row.get("template") or "") or builtin_kind_default_template("note")
    return builtin_kind_default_template("note")


def kind_template(kind: str) -> str:
    cfg = _knowledge_cfg()
    overrides = cfg.get("templates") if isinstance(cfg.get("templates"), dict) else {}
    if kind in overrides:
        return str(overrides.get(kind) or "")
    return kind_default_template(kind)


def cleanup_deleted_mark(mark_id: str) -> dict[str, Any]:
    mark_id = str(mark_id or "").strip()
    if not mark_id:
        return {"ok": True, "updated": 0}
    updated = 0
    for kind, path in _iter_docs():
        text = path.read_text(encoding="utf-8")
        meta, body = _frontmatter_parse(text)
        marks = meta.get("kind_marks") or []
        if isinstance(marks, str):
            marks = [x.strip() for x in re.split(r"[,，]", marks) if x.strip()]
        if mark_id not in marks:
            continue
        meta["kind_marks"] = []
        meta["updated"] = _now()
        with _LOCK:
            _atomic_write(path, _frontmatter_dump(meta) + body.rstrip() + "\n")
        updated += 1
    return {"ok": True, "updated": updated, "mark_id": mark_id}

DATE_FIELDS = {
    "journal": "record_date",
    "milestone": "due",
    "summary": "record_date",
    "literature": "added_date",
}

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")
BIBTEX_BLOCK_RE = re.compile(r"```bibtex\s*\n(.*?)```", re.S | re.I)
_LOCK = threading.RLock()


def document_revision(text: str) -> str:
    """Include metadata and body, independent of timestamp precision."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class RevisionConflict(ValueError):
    def __init__(self, current: dict[str, Any]):
        super().__init__("条目已被其他客户端修改，请比较当前值后重新合并保存")
        self.current = current


def milestone_status_class(raw: Any) -> str:
    # Unknown/custom labels remain visible and count as pending/planned.
    value = str(raw or "").strip()
    if value in ("完成", "已完成"):
        return "done"
    if value in ("受阻", "阻塞"):
        return "blocked"
    return "active" if value == "进行中" else "planned"


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _today() -> str:
    return date.today().isoformat()


def _slug(text: str) -> str:
    text = re.sub(r"[^\w\u4e00-\u9fff-]+", "-", (text or "").strip(), flags=re.UNICODE)
    text = re.sub(r"-+", "-", text).strip("-")
    return text[:64] or "untitled"


def _quote_yaml(value: str) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def _frontmatter_dump(meta: dict[str, Any]) -> str:
    lines = ["---"]
    ordered = [
        "id", "kind", "title", "created", "updated", "status", "project", "projects", "tags",
        "kind_marks", "record_date", "due", "added_date", "summary_type", "pinned", "authors", "year",
        "venue", "doi", "url", "cite_key"
    ]
    seen = set()
    for key in ordered + sorted(meta.keys()):
        if key in seen or key not in meta:
            continue
        seen.add(key)
        value = meta[key]
        if value is None:
            continue
        if isinstance(value, bool):
            lines.append(f"{key}: {'true' if value else 'false'}")
        elif isinstance(value, list):
            lines.append(f"{key}: {json.dumps(value, ensure_ascii=False)}")
        elif isinstance(value, (int, float)):
            lines.append(f"{key}: {value}")
        else:
            lines.append(f"{key}: {_quote_yaml(value)}")
    lines.append("---")
    return "\n".join(lines) + "\n\n"


def _frontmatter_parse(text: str) -> tuple[dict[str, Any], str]:
    if not text.startswith("---"):
        return {}, text
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, flags=re.S)
    if not match:
        return {}, text
    meta: dict[str, Any] = {}
    for raw in match.group(1).splitlines():
        if not raw.strip() or raw.lstrip().startswith("#") or ":" not in raw:
            continue
        key, raw_value = raw.split(":", 1)
        key, raw_value = key.strip(), raw_value.strip()
        if not key:
            continue
        if raw_value.lower() in ("true", "false"):
            meta[key] = raw_value.lower() == "true"
        elif raw_value.startswith("[") and raw_value.endswith("]"):
            try:
                meta[key] = json.loads(raw_value)
            except Exception:
                meta[key] = []
        elif raw_value.startswith('"') or raw_value.startswith("'"):
            try:
                meta[key] = json.loads(raw_value) if raw_value.startswith('"') else raw_value.strip("'")
            except Exception:
                meta[key] = raw_value.strip('"\'')
        else:
            try:
                meta[key] = int(raw_value)
            except Exception:
                meta[key] = raw_value
    body = text[match.end():]
    return meta, body


def _normalize_projects(meta: dict[str, Any]) -> dict[str, Any]:
    raw = meta.get("projects")
    values: list[str] = []
    if isinstance(raw, list):
        values = [str(x).strip() for x in raw if str(x).strip()]
    elif isinstance(raw, str):
        values = [x.strip() for x in re.split(r"[,，]", raw) if x.strip()]
    legacy = str(meta.get("project") or "").strip()
    if legacy and legacy not in values:
        values.insert(0, legacy)
    # de-duplicate while preserving order
    dedup: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value not in seen:
            seen.add(value); dedup.append(value)
    meta["projects"] = dedup
    meta["project"] = dedup[0] if dedup else ""
    return meta


def _kind_path(kind: str) -> Path:
    dirs = kind_dir_map()
    if kind not in dirs:
        raise ValueError(f"Unknown kind: {kind}")
    return ensure_workspace() / dirs[kind]


def _iter_docs(kinds: list[str] | None = None):
    target_kinds = kinds or list(kind_dir_map())
    for kind in target_kinds:
        root = _kind_path(kind)
        root.mkdir(parents=True, exist_ok=True)
        for path in sorted(root.glob("*.md")):
            yield kind, path


def _doc_from_path(kind: str, path: Path, include_body: bool = True) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
    meta, body = _frontmatter_parse(text)
    meta.setdefault("id", path.stem)
    meta.setdefault("kind", kind)
    meta.setdefault("title", path.stem)
    meta.setdefault("status", (kind_statuses(kind) or ["草稿"])[0])
    meta.setdefault("project", "")
    meta.setdefault("projects", [])
    meta.setdefault("tags", [])
    if kind == "milestone":
        meta.setdefault("start_date", "")
        meta.setdefault("due", "")
        meta.setdefault("progress", None)
        if meta["progress"] is not None:
            try:
                progress = float(meta["progress"])
                meta["progress"] = progress if math.isfinite(progress) and 0 <= progress <= 100 else None
            except (TypeError, ValueError):
                meta["progress"] = None
    if isinstance(meta.get("kind_marks"), str):
        meta["kind_marks"] = [x.strip() for x in re.split(r"[,，]", meta["kind_marks"]) if x.strip()]
    if not isinstance(meta.get("kind_marks"), list):
        meta["kind_marks"] = []
    meta["kind_marks"] = [str(x).strip() for x in meta["kind_marks"] if str(x).strip()]
    _normalize_projects(meta)
    if isinstance(meta.get("tags"), str):
        meta["tags"] = [t.strip() for t in meta["tags"].split(",") if t.strip()]
    doc = dict(meta)
    doc["revision"] = document_revision(text)
    if kind == "milestone":
        doc["status_class"] = milestone_status_class(doc.get("status"))
    doc["filename"] = path.name
    doc["path"] = str(path.relative_to(ensure_workspace())).replace("\\", "/")
    doc["excerpt"] = _excerpt(body)
    if include_body:
        doc["body"] = body
    if kind == "literature":
        bib = BIBTEX_BLOCK_RE.search(body)
        doc["bibtex"] = str(meta["bibtex"] or "") if "bibtex" in meta else (bib.group(1).strip() if bib else "")
    return doc


def _excerpt(body: str, limit: int = 180) -> str:
    cleaned = re.sub(r"```.*?```", " ", body, flags=re.S)
    cleaned = re.sub(r"!\[[^\]]*\]\([^\)]*\)", " ", cleaned)
    cleaned = re.sub(r"[#>*_`\-]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:limit]


_EN_STOPWORDS = {
    "the", "a", "an", "in", "on", "of", "for", "and", "or", "to", "with", "by", "from", "as", "at",
    "is", "are", "be", "been", "was", "were", "that", "this", "it", "its", "into", "than", "then",
    "there", "here", "we", "our", "not", "can", "will", "would", "which", "when", "where", "how",
    "what", "who", "their", "them", "these", "those", "over", "under", "between", "within",
    "without", "through", "during", "before", "after", "based", "using", "via", "etc", "novel",
}  # v260930d · M5 英文虚词停用表：文献标题拆词后大量介词/冠词会误命中页面文本


def _title_terms(title: str, kind: str) -> list[str]:
    """v260930d · M5 从条目标题提取匹配候选词：知识类取名称段（去掉 知识-<类别>- 前缀），
    其他类去掉单段前缀。文献类论文原题只整题参与、不拆词——论文名单词（detection 等）
    与页面文本撞词太常见，噪声远大于信号；整题命中仅发生在"页面正来自这篇文献"时，才是真相关。"""
    t = str(title or "").strip()
    if not t:
        return []
    name = t
    if kind == "note" and t.startswith("知识-"):
        parts = t.split("-")
        if len(parts) >= 3:
            name = "-".join(parts[2:])
    else:
        for prefix in ("总结-", "灵感-", "日志-", "里程碑-", "文献-", "知识-"):
            if t.startswith(prefix):
                name = t[len(prefix):]
                break
    name = name.strip()
    if not name:
        return []
    terms = [name]
    if kind != "literature":  # 非文献类才拆词补充短词候选
        for w in re.split(r"[\s/、,，;；()（）]+", name):
            w = w.strip()
            lw = w.lower()
            if lw in _EN_STOPWORDS:
                continue
            if re.fullmatch(r"[A-Za-z]+", w) and len(w) < 4 and not w.isupper():
                continue  # 短英文介词/冠词排除；全大写缩写（SCR/CW）保留
            if len(w) >= 2 and w not in terms:
                terms.append(w)
    return terms


def _term_in_text(term: str, low_text: str) -> bool:
    """v260930i · 英文纯字母词按整词匹配（SCR 不得命中 description），容忍简单词形变化
    （filters/filtering/estimated 这类 s/es/ed/ing 后缀），中文/混合词保留子串。"""
    tl = term.lower()
    if tl.isascii() and tl.isalpha():
        stem = tl[:-1] if tl.endswith("e") else tl  # estimate → estimated/estimates/estimating
        return re.search(rf"(?<![a-z0-9]){re.escape(stem)}e?(?:s|es|ed|ing)?(?![a-z0-9])", low_text) is not None
    return tl in low_text


_RELATED_CACHE: tuple[tuple[str, int], list] | None = None


def match_related(page_text: str, limit: int = 8) -> list[dict[str, Any]]:
    """v260930d · M5 阅读中知识关联：把页面正文与全库条目的标题名称段/标签做文本匹配，
    返回本页出现过的知识条目（纯字符串匹配，不依赖 LLM）。命中按权重降序：
    整名称段命中 > 长 token > 多 token；返回 hits 供前端高亮。
    v260930i · 抗噪：英文整词匹配 + 最低相关门槛（整段命中必进；否则需 score≥4 或 ≥2 个独立命中）。"""
    text = str(page_text or "")
    if len(text.strip()) < 4:
        return []
    low = text.lower()
    from . import indexer
    global _RELATED_CACHE
    state = indexer.status()
    key = (state["path"], state["documents_version"])
    if _RELATED_CACHE is None or _RELATED_CACHE[0] != key:
        entries = []
        for doc in indexer.document_metadata():
            candidates = _title_terms(doc.get("title"), doc["kind"])
            n_title = len(candidates)
            for tag in doc.get("tags") or []:
                term = str(tag).strip()
                if len(term) >= 2 and term not in candidates:
                    candidates.append(term)
            entries.append((doc, candidates, n_title))
        _RELATED_CACHE = (key, entries)
    scored: dict[str, dict[str, Any]] = {}
    for doc, candidates, n_title in _RELATED_CACHE[1]:
        kind = doc["kind"]
        hits: list[str] = []
        score = 0
        full = False
        for i, term in enumerate(candidates):
            tl = term.lower()
            if tl and _term_in_text(term, low):
                hits.append(term)
                # v260930d · 权重：整名称段命中强加权；标题 token 按词长；tags 命中为弱信号（半权）
                if i == 0:
                    full = True
                    score += 50 + len(term) // 2
                elif i < n_title:
                    score += len(term)
                else:
                    score += max(1, len(term) // 2)
        if not hits:
            continue
        if len(hits) >= 2:
            score += 2
        if not full and score < 4 and len(hits) < 2:  # v260930i · 单个弱命中不足以构成关联
            continue
        scored[doc["id"]] = {
            "id": doc["id"], "title": doc.get("title"), "kind": kind,
            "kind_marks": doc.get("kind_marks") or [], "excerpt": doc.get("excerpt", ""),
            "hits": hits[:4], "score": score,
        }
    out = sorted(scored.values(), key=lambda x: (-x["score"], x["kind"] != "note", str(x["title"])))  # v260930d · 同分时知识条目优先（M5 场景主体是术语解释）
    for x in out:
        x.pop("score", None)
    return out[:max(1, min(int(limit or 8), 20))]


def resolve_attachment(meta: dict[str, Any]) -> Path | None:
    """v260923 · 解析文献 PDF 附件路径：绝对路径直接用，相对路径相对 Workspace。
    仅接受 .pdf 且文件真实存在，其余一律视为无附件。"""
    raw = str(meta.get("attachment") or "").strip().strip('"').strip("'")
    if not raw:
        return None
    path = Path(raw)
    if not path.is_absolute():
        path = ensure_workspace() / raw
    try:
        path = path.resolve()
    except OSError:
        return None
    if path.suffix.lower() != ".pdf" or not path.is_file():
        return None
    return path


def attachment_file(doc_id: str) -> Path | None:
    """v260923 · 取指定文献的 PDF 附件文件（不存在或配置无效时返回 None）。"""
    from . import indexer
    return resolve_attachment(indexer.get_doc(doc_id))


def _make_default_body(kind: str, title: str, payload: dict[str, Any]) -> str:
    template = kind_template(kind)
    bibtex = payload.get("bibtex") or "@article{cite_key,\n  title = {},\n  author = {},\n  year = {}\n}"
    return (
        template
        .replace("{{title}}", title)
        .replace("{{date}}", _today())
        .replace("{{bibtex}}", str(bibtex).strip())
        .rstrip() + "\n"
    )


def prepare_doc(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Build a new editor draft without files, activity events or index entries."""
    if kind not in kind_dir_map():
        raise ValueError("Invalid kind")
    title = str(payload.get("title") or f"未命名{kind_label_map().get(kind, kind)}").strip()
    doc_id = f"{kind}-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
    now = _now()
    meta: dict[str, Any] = {
        "id": doc_id,
        "kind": kind,
        "title": title,
        "created": now,
        "updated": now,
        "status": payload.get("status") or (kind_statuses(kind) or ["草稿"])[0],
        "project": payload.get("project") or "",
        "projects": payload.get("projects") or [],
        "project_id": payload.get("project_id") or "",
        "project_ids": payload.get("project_ids") or [],
        "tags": payload.get("tags") or [],
        "kind_marks": payload.get("kind_marks") or [],
        "pinned": bool(payload.get("pinned", False)),
    }
    date_field = DATE_FIELDS.get(kind)
    if date_field:
        meta[date_field] = payload.get(date_field) or _today()
    if kind == "milestone":
        meta.update(normalize_milestone_schedule({"due": _today(), **payload}))
    if kind == "summary":
        meta["summary_type"] = payload.get("summary_type") or "阶段总结"
    if kind == "literature":
        for key in ("authors", "year", "venue", "doi", "url", "cite_key", "attachment"):
            meta[key] = payload.get(key) or ""
        if not meta["cite_key"]:
            meta["cite_key"] = _slug(title).replace("-", "_")[:48]
    _normalize_projects(meta)
    body = str(payload["body"]) if payload.get("body") is not None else _make_default_body(kind, title, payload)
    bibtex = BIBTEX_BLOCK_RE.search(body) if kind == "literature" else None
    citation = str(payload["bibtex"] or "") if "bibtex" in payload else (bibtex.group(1).strip() if bibtex else "")
    return {**meta, "body": body, "path": "", "draft": True,
            "bibtex": citation}


def normalize_milestone_schedule(payload: dict[str, Any]) -> dict[str, Any]:
    """An optional start makes a milestone a planned phase; never infer dates/progress."""
    result: dict[str, Any] = {}
    for key, label in (("start_date", "开始日期"), ("due", "截止日期")):
        raw = str(payload.get(key) or "").strip()
        try:
            if raw and (not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw) or date.fromisoformat(raw).isoformat() != raw):
                raise ValueError
        except ValueError:
            raise ValueError(f"{label}须为有效的 YYYY-MM-DD 日期") from None
        result[key] = raw
    if result["start_date"] and result["due"] and result["start_date"] > result["due"]:
        raise ValueError("截止日期不能早于开始日期")
    progress = payload.get("progress")
    if progress is None or progress == "":
        result["progress"] = None
    else:
        try:
            number = float(progress)
            if isinstance(progress, bool) or not math.isfinite(number) or not 0 <= number <= 100:
                raise ValueError
        except (TypeError, ValueError):
            raise ValueError("完成进度须为 0–100 的数字，或留空") from None
        result["progress"] = round(number, 1)
    return result


def create_doc(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    draft = prepare_doc(kind, payload)
    body = draft.pop("body")
    draft.pop("path")
    draft.pop("draft")
    if kind != "literature":
        draft.pop("bibtex")
    meta = draft
    doc_id, title = meta["id"], meta["title"]
    for project_name in meta.get("projects", []):
        ensure_project(project_name)
    path = _kind_path(kind) / f"{doc_id}.md"
    with _LOCK:
        _atomic_write(path, _frontmatter_dump(meta) + body.rstrip() + "\n")
    activity.record("doc_create", ref=doc_id, kind=kind, title=title, project=str(meta.get("project") or ""))
    return _doc_from_path(kind, path, include_body=True)


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def save_asset(data_url: str, original_name: str = "image.png") -> dict[str, Any]:
    match = re.match(r"^data:([\w.+-]+/[\w.+-]+);base64,(.+)$", data_url, flags=re.S)
    if not match:
        raise ValueError("Invalid data URL")
    mime, raw = match.groups()
    allowed = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}
    if mime not in allowed:
        raise ValueError("仅支持 PNG / JPEG / WebP / GIF 图片")
    blob = base64.b64decode(raw, validate=True)
    if len(blob) > 15 * 1024 * 1024:
        raise ValueError("Image exceeds 15 MB")
    signatures = {
        "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
        "image/webp": lambda b: len(b) > 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP",
        "image/gif": lambda b: b.startswith((b"GIF87a", b"GIF89a")),
    }
    if not signatures[mime](blob):
        raise ValueError("图片内容与 MIME 类型不匹配")
    ext = allowed[mime]
    date_dir = datetime.now().strftime("%Y/%m")
    root = ensure_workspace() / "Knowledge" / "Attachments" / date_dir
    root.mkdir(parents=True, exist_ok=True)
    filename = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}{ext}"
    path = root / filename
    with _LOCK:
        path.write_bytes(blob)
    rel = str(path.relative_to(ensure_workspace())).replace("\\", "/")
    # Documents live directly under Knowledge/<Kind>, so this is portable in Obsidian/VS Code.
    markdown_rel = "../Attachments/" + "/".join(rel.split("/")[2:])
    return {
        "ok": True,
        "path": rel,
        "url": "/workspace-file/" + rel,
        "markdown": f"![{Path(original_name).stem}]({markdown_rel})",
        "size": len(blob),
    }


def _bundle_body(body: str) -> str:
    # A knowledge bundle is stored two levels below Knowledge/. Make image links portable.
    body = re.sub(r"\(/workspace-file/Knowledge/Attachments/([^\)]+)\)", r"(../../Attachments/\1)", body)
    body = body.replace("(../Attachments/", "(../../Attachments/")
    return body.strip()

def save_bundle(filename: str, content: str) -> dict:
    root = ensure_workspace() / "Knowledge" / "Exports" / "KnowledgeBundles"
    root.mkdir(parents=True, exist_ok=True)
    name = _slug(Path(filename or "knowledge-bundle").stem) + ".md"
    path = root / name
    if path.exists():
        path = root / f"{path.stem}-{datetime.now().strftime('%H%M%S')}.md"
    with _LOCK:
        _atomic_write(path, content)
    activity.record("knowledge_export", ref=path.name, kind="bundle", title=path.stem)
    return {"ok": True, "path": str(path.relative_to(ensure_workspace())).replace("\\", "/")}


def _date_only(value: Any) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except Exception:
        try:
            return date.fromisoformat(raw[:10])
        except Exception:
            return None


def _academic_progress(profile: dict[str, Any], today: date) -> dict[str, Any]:
    start = _date_only(profile.get("start_date"))
    end = _date_only(profile.get("expected_end_date"))
    data: dict[str, Any] = {
        "degree_name": str(profile.get("degree_name") or "学业进度"),
        "start_date": start.isoformat() if start else "",
        "expected_end_date": end.isoformat() if end else "",
        "configured": bool(start and end and end > start),
        "percent": 0.0,
        "elapsed_days": 0,
        "remaining_days": 0,
        "weekly_goal_days": max(1, min(7, int(profile.get("weekly_goal_days") or 5))),
    }
    if data["configured"]:
        total = max(1, (end - start).days)
        elapsed = (today - start).days
        data["elapsed_days"] = max(0, elapsed)
        data["remaining_days"] = max(0, (end - today).days)
        data["percent"] = round(max(0.0, min(100.0, elapsed / total * 100.0)), 1)
    conditions = []
    for item in profile.get("graduation_conditions") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "未命名条件").strip()
        try:
            current = float(item.get("current") or 0)
            target = float(item.get("target") or 0)
        except Exception:
            current, target = 0.0, 0.0
        conditions.append({
            "label": label,
            "current": current,
            "target": target,
            "unit": str(item.get("unit") or ""),
            "percent": round(max(0.0, min(100.0, current / target * 100.0)), 1) if target > 0 else 0.0,
            "done": bool(target > 0 and current >= target),
        })
    data["graduation_conditions"] = conditions
    data["conditions_done"] = sum(1 for x in conditions if x["done"])
    data["conditions_total"] = len(conditions)
    return data
