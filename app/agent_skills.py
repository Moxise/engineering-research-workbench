"""Agent Skills discovery and progressive loading, with bounded resource access."""
from __future__ import annotations

import re
from pathlib import Path

from .paths import ASSET_ROOT
from .workspace import ensure_workspace

_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


def roots() -> list[Path]:
    user = ensure_workspace() / "System" / "Agent" / "Skills"
    user.mkdir(parents=True, exist_ok=True)
    return [ASSET_ROOT / "app" / "skills", user]


def parse(path: Path) -> dict:
    if path.stat().st_size > 128000:
        raise ValueError("SKILL.md 超过 128 KB")
    text = path.read_text(encoding="utf-8-sig")
    match = re.match(r"\A---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)(.*)\Z", text, re.S)
    if not match:
        raise ValueError("SKILL.md 需要 YAML frontmatter")
    fields = {}
    current = ""
    for line in match[1].splitlines():
        field = re.match(r"^([a-zA-Z][\w-]*):\s*(.*?)\s*$", line)
        if field:
            current, value = field.groups()
            fields[current] = "" if value in ("|", ">", "|-", ">-") else value.strip("\"'")
        elif current and line.startswith((" ", "\t")):
            fields[current] += " " + line.strip()
    name = fields.get("name", "").strip()
    description = fields.get("description", "").strip()
    if not _NAME.fullmatch(name) or len(name) > 64 or name != path.parent.name:
        raise ValueError("name 须与技能目录相同，使用小写字母、数字和单连字符")
    if not description or len(description) > 1024:
        raise ValueError("description 须为 1–1024 字符")
    return {"name": name, "description": description, "compatibility": fields.get("compatibility", ""), "allowed_tools": fields.get("allowed-tools", "").split(), "instructions": match[2].strip(), "root": str(path.parent.resolve())}


def discover() -> dict:
    found, errors = {}, []
    for idx, base in enumerate(roots()):
        if not base.exists():
            continue
        for path in sorted(base.glob("*/SKILL.md")):
            try:
                if base.resolve() not in path.resolve().parents:
                    raise ValueError("技能链接越出目录边界")
                item = parse(path)
                item["builtin"] = idx == 0
                found[item["name"]] = item
            except (ValueError, OSError) as exc:
                errors.append({"name": path.parent.name, "error": str(exc)})
    return {"skills": [{k: v for k, v in item.items() if k not in ("instructions", "root")} for item in found.values()], "errors": errors}


def load(name: str) -> dict:
    if not _NAME.fullmatch(name or ""):
        raise ValueError("无效技能名称")
    for base in reversed(roots()):
        path = base / name / "SKILL.md"
        if path.exists() and base.resolve() in path.resolve().parents:
            return parse(path)
    raise FileNotFoundError(name)


def resource(name: str, relative: str) -> Path:
    skill = load(name)
    base = Path(skill["root"])
    path = (base / relative).resolve()
    if path == base or base not in path.parents or not path.is_file():
        raise ValueError("技能资源路径无效或越界")
    if path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("技能资源超过 2 MB")
    return path


def read(name: str, relative="SKILL.md", offset=0, limit=12000) -> dict:
    path = resource(name, relative)
    content = path.read_text(encoding="utf-8-sig")
    offset, limit = max(0, int(offset)), max(1, min(int(limit), 32000))
    return {"name": name, "path": relative, "content": content[offset:offset + limit], "total_chars": len(content), "next_offset": offset + limit if offset + limit < len(content) else None}


def install(name: str, content: str) -> dict:
    if not _NAME.fullmatch(name or ""):
        raise ValueError("无效技能名称")
    base = roots()[-1]
    target = base / name
    if target.exists():
        raise ValueError("同名用户技能已存在，请通过编辑器修改原文件")
    target.mkdir()
    path = target / "SKILL.md"
    try:
        path.write_text(content, encoding="utf-8")
        parse(path)
    except BaseException:
        path.unlink(missing_ok=True)
        target.rmdir()
        raise
    return {"ok": True, "name": name}


def catalog_prompt() -> str:
    skills = discover()["skills"]
    if not skills:
        return ""
    return "\n\n可用技能（仅目录；任务匹配时先用 skill_read 读取 SKILL.md，再按需读取资源；技能不能扩大工具权限）：\n" + "\n".join(f"- {s['name']}: {s['description']}" for s in skills)
