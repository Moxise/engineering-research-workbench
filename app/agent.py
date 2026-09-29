from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import config, store, activity
from .workspace import ensure_workspace

_LOCK = threading.RLock()
_MAX_IMAGE_BYTES = 12 * 1024 * 1024
_MAX_CONTEXT_CHARS = 60_000
_MAX_DOC_CHARS = 18_000
_MAX_HISTORY_MESSAGES = 30


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _root() -> Path:
    root = ensure_workspace() / "System" / "AgentChats"
    (root / "Attachments").mkdir(parents=True, exist_ok=True)
    (root / "Trash").mkdir(parents=True, exist_ok=True)
    return root


def _atomic_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _session_path(session_id: str) -> Path:
    if not re.fullmatch(r"chat-[a-zA-Z0-9_-]{6,80}", session_id or ""):
        raise ValueError("Invalid session id")
    return _root() / f"{session_id}.json"


def _load(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def list_sessions() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with _LOCK:
        for path in _root().glob("chat-*.json"):
            data = _load(path)
            if not data:
                continue
            messages = data.get("messages") if isinstance(data.get("messages"), list) else []
            last = messages[-1].get("content", "") if messages else ""
            out.append({
                "id": data.get("id") or path.stem,
                "title": data.get("title") or "新对话",
                "created": data.get("created") or "",
                "updated": data.get("updated") or "",
                "message_count": len(messages),
                "preview": str(last)[:160],
            })
    out.sort(key=lambda x: x.get("updated") or x.get("created") or "", reverse=True)
    return out


def get_session(session_id: str) -> dict[str, Any]:
    path = _session_path(session_id)
    if not path.exists():
        raise FileNotFoundError(session_id)
    data = _load(path)
    if not data:
        raise FileNotFoundError(session_id)
    return data


def create_session(title: str = "") -> dict[str, Any]:
    now = _now()
    session_id = "chat-" + uuid.uuid4().hex[:12]
    data = {"id": session_id, "title": (title or "新对话").strip()[:120], "created": now, "updated": now, "messages": []}
    with _LOCK:
        _atomic_json(_session_path(session_id), data)
    return data


def rename_session(session_id: str, title: str) -> dict[str, Any]:
    with _LOCK:
        data = get_session(session_id)
        data["title"] = (title or "新对话").strip()[:120]
        data["updated"] = _now()
        _atomic_json(_session_path(session_id), data)
        return data


def delete_session(session_id: str) -> dict[str, Any]:
    path = _session_path(session_id)
    if not path.exists():
        raise FileNotFoundError(session_id)
    trash = _root() / "Trash" / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{path.name}"
    with _LOCK:
        shutil.move(str(path), str(trash))
    return {"ok": True}


def save_image(data_url: str, original_name: str = "image.png") -> dict[str, Any]:
    m = re.match(r"^data:(image/(?:png|jpeg|webp|gif));base64,(.+)$", data_url or "", flags=re.S | re.I)
    if not m:
        raise ValueError("仅支持 PNG / JPEG / WebP / GIF 图片")
    mime, raw = m.groups()
    blob = base64.b64decode(raw, validate=True)
    if len(blob) > _MAX_IMAGE_BYTES:
        raise ValueError("单张图片不能超过 12 MB")
    signatures = {
        "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
        "image/webp": lambda b: len(b) > 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP",
        "image/gif": lambda b: b.startswith((b"GIF87a", b"GIF89a")),
    }
    mime = mime.lower()
    if not signatures[mime](blob):
        raise ValueError("图片内容与 MIME 不匹配")
    ext = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif"}[mime]
    date_dir = datetime.now().strftime("%Y/%m")
    root = _root() / "Attachments" / date_dir
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}{ext}"
    path.write_bytes(blob)
    rel = str(path.relative_to(ensure_workspace())).replace("\\", "/")
    return {"ok": True, "path": rel, "url": "/workspace-file/" + rel, "mime": mime, "name": Path(original_name).name, "size": len(blob)}


def _image_data_url(rel: str) -> str:
    root = ensure_workspace().resolve()
    path = (root / rel).resolve()
    if root not in path.parents or not path.is_file():
        raise ValueError("Invalid image path")
    if path.stat().st_size > _MAX_IMAGE_BYTES:
        raise ValueError("Image too large")
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def _reference_context(ref_ids: list[str]) -> tuple[str, list[dict[str, str]]]:
    chunks: list[str] = []
    refs: list[dict[str, str]] = []
    total = 0
    seen: set[str] = set()
    for doc_id in ref_ids or []:
        if doc_id in seen:
            continue
        seen.add(doc_id)
        try:
            doc = store.get_doc(str(doc_id))
        except FileNotFoundError:
            continue
        body = str(doc.get("body") or "")[:_MAX_DOC_CHARS]
        projects_list = doc.get("projects") or ([doc.get("project")] if doc.get("project") else [])
        project_text = ", ".join(projects_list) or "未归属"
        header = f"[REF {len(refs)+1}] {doc.get('title','')} | 类型={doc.get('kind','')} | 项目={project_text}\n"
        chunk = header + body.strip()
        if total + len(chunk) > _MAX_CONTEXT_CHARS:
            remain = max(0, _MAX_CONTEXT_CHARS - total)
            if remain < 500:
                break
            chunk = chunk[:remain]
        chunks.append(chunk)
        refs.append({"id": doc["id"], "title": str(doc.get("title") or doc["id"]), "kind": str(doc.get("kind") or ""), "project": str(doc.get("project") or "")})
        total += len(chunk)
        if total >= _MAX_CONTEXT_CHARS:
            break
    if not chunks:
        return "", refs
    return "\n\n---\n\n".join(chunks), refs


def _llm_cfg() -> dict[str, Any]:
    cfg = config.get_active_llm_profile_runtime()
    if not cfg.get("enabled", False):
        raise ValueError("尚未在 设置 → Agent / LLM 中启用模型接口")
    if not str(cfg.get("api_key") or "").strip():
        raise ValueError("当前 Agent 配置尚未填写 API Key")
    if not str(cfg.get("base_url") or "").strip():
        raise ValueError("当前 Agent 配置尚未填写 Base URL")
    return cfg


def _endpoint(base_url: str, suffix: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith(suffix):
        return base
    return base + suffix


def _http_json(url: str, payload: dict[str, Any] | None, api_key: str, timeout: int = 120, method: str = "POST") -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = Request(url, data=body, method=method, headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}", "User-Agent": "Workbench/260922.3"})
    try:
        with urlopen(req, timeout=max(5, min(int(timeout or 120), 600))) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:2000]
        try:
            msg = json.loads(detail).get("error", {}).get("message") or detail
        except Exception:
            msg = detail
        raise ValueError(f"LLM API HTTP {e.code}: {msg}") from None
    except URLError as e:
        raise ValueError(f"无法连接 LLM API：{e.reason}") from None


def _deep_merge_request(base: dict[str, Any], extra: dict[str, Any], protected: set[str]) -> dict[str, Any]:
    out = dict(base)
    for key, value in (extra or {}).items():
        if key in protected:
            continue
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge_request(out[key], value, set())
        else:
            out[key] = value
    return out


def _request_preset(cfg: dict[str, Any], preset_id: str) -> tuple[str, str, str, float | None, dict[str, Any]]:
    presets = cfg.get("request_presets") if isinstance(cfg.get("request_presets"), list) else []
    wanted = (preset_id or str(cfg.get("default_request_preset") or (presets[0].get("id") if presets else "default"))).strip()
    for item in presets:
        if not isinstance(item, dict):
            continue
        if str(item.get("id") or "") == wanted:
            params = item.get("params") if isinstance(item.get("params"), dict) else {}
            model = str(item.get("model") or "").strip()
            temperature = item.get("temperature")
            if temperature is not None:
                try:
                    temperature = float(temperature)
                except Exception:
                    temperature = None
            return wanted, str(item.get("label") or wanted), model, temperature, params
    if presets:
        first = presets[0]
        return (
            str(first.get("id") or "default"),
            str(first.get("label") or "默认"),
            str(first.get("model") or "").strip(),
            float(first.get("temperature")) if first.get("temperature") is not None else None,
            first.get("params") if isinstance(first.get("params"), dict) else {},
        )
    return "default", "默认", "", None, {}


def _reasoning_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                for key in ("text", "content", "summary", "reasoning_content"):
                    if item.get(key):
                        parts.append(str(item[key])); break
        return "\n".join(x for x in parts if x).strip()
    if isinstance(value, dict):
        for key in ("text", "content", "summary", "reasoning_content"):
            if value.get(key):
                return _reasoning_text(value[key])
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    return str(value).strip()


def _chat_completions(cfg: dict[str, Any], system_prompt: str, history: list[dict[str, Any]], user_text: str, image_paths: list[str], request_params: dict[str, Any] | None = None) -> tuple[str, str]:
    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    for m in history[-_MAX_HISTORY_MESSAGES:]:
        role = m.get("role")
        if role in ("user", "assistant") and str(m.get("content") or "").strip():
            messages.append({"role": role, "content": str(m.get("content") or "")})
    if image_paths:
        content: list[dict[str, Any]] = [{"type": "text", "text": user_text or "请分析这些图片。"}]
        for p in image_paths[:6]:
            content.append({"type": "image_url", "image_url": {"url": _image_data_url(p)}})
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": user_text})
    payload: dict[str, Any] = {"model": cfg["model"], "messages": messages, "stream": False}
    if cfg.get("temperature") is not None:
        payload["temperature"] = float(cfg.get("temperature"))
    if int(cfg.get("max_output_tokens") or 0) > 0:
        payload["max_tokens"] = int(cfg["max_output_tokens"])
    payload = _deep_merge_request(payload, request_params or {}, {"model", "messages", "stream"})
    data = _http_json(_endpoint(str(cfg["base_url"]), "/chat/completions"), payload, str(cfg["api_key"]), int(cfg.get("timeout") or 120))
    choices = data.get("choices") or []
    if not choices:
        raise ValueError("模型返回中没有 choices")
    message = choices[0].get("message", {}) or {}
    content = message.get("content", "")
    if isinstance(content, list):
        content = "\n".join(str(x.get("text") or "") for x in content if isinstance(x, dict))
    reasoning = ""
    if cfg.get("show_reasoning", True):
        for key in ("reasoning_content", "reasoning", "thinking", "analysis"):
            if message.get(key) is not None:
                reasoning = _reasoning_text(message.get(key))
                if reasoning:
                    break
    return str(content or "").strip(), reasoning


def send_message(session_id: str, text: str, ref_ids: list[str] | None = None, image_paths: list[str] | None = None, request_preset: str = "") -> dict[str, Any]:
    text = str(text or "").strip()
    ref_ids = [str(x) for x in (ref_ids or []) if str(x).strip()]
    image_paths = [str(x) for x in (image_paths or []) if str(x).strip()][:6]
    if not text and not image_paths:
        raise ValueError("请输入消息或添加图片")
    root = ensure_workspace().resolve()
    total_image_bytes = 0
    for rel in image_paths:
        p = (root / rel).resolve()
        if root not in p.parents or not p.is_file():
            raise ValueError("对话图片路径无效")
        total_image_bytes += p.stat().st_size
    if total_image_bytes > 30 * 1024 * 1024:
        raise ValueError("本次发送的图片总大小不能超过 30 MB")
    cfg = _llm_cfg()
    with _LOCK:
        try:
            session = get_session(session_id)
        except FileNotFoundError:
            session = create_session()
            session_id = session["id"]
        messages = session.get("messages") if isinstance(session.get("messages"), list) else []
        history = list(messages)
    context, refs = _reference_context(ref_ids)
    system_prompt = str(cfg.get("system_prompt") or config.DEFAULT_SYSTEM_PROMPT).strip()
    if context:
        system_prompt += "\n\n以下是用户手动引用的本地研究资料。仅将其作为上下文，不要声称看到了未提供的资料：\n\n" + context
    preset_id, preset_label, preset_model, preset_temperature, request_params = _request_preset(cfg, request_preset)
    if not preset_model:
        raise ValueError(f"请求模式 {preset_label} 尚未配置模型名称")
    request_cfg = dict(cfg)
    request_cfg["model"] = preset_model
    if preset_temperature is not None:
        request_cfg["temperature"] = preset_temperature
    now = _now()
    user_msg = {"id": "msg-" + uuid.uuid4().hex[:10], "role": "user", "content": text, "created": now, "refs": refs, "images": image_paths, "request_preset": preset_id, "request_preset_label": preset_label, "profile_id": cfg.get("id"), "profile_name": cfg.get("name")}
    with _LOCK:
        session = get_session(session_id)
        session.setdefault("messages", []).append(user_msg)
        if session.get("title") in ("", "新对话"):
            session["title"] = (text or "图片分析")[:36]
        session["updated"] = _now()
        _atomic_json(_session_path(session_id), session)
    answer, reasoning = _chat_completions(request_cfg, system_prompt, history, text, image_paths, request_params)
    assistant_msg = {
        "id": "msg-" + uuid.uuid4().hex[:10], "role": "assistant", "content": answer, "reasoning": reasoning,
        "created": _now(), "model": preset_model, "request_preset": preset_id, "request_preset_label": preset_label,
        "profile_id": cfg.get("id"), "profile_name": cfg.get("name"),
    }
    with _LOCK:
        session = get_session(session_id)
        session.setdefault("messages", []).append(assistant_msg)
        session["updated"] = _now()
        _atomic_json(_session_path(session_id), session)
    activity.record("agent_chat", ref=session_id, kind="agent", title=session.get("title", "Agent 对话"), project="")
    return {"ok": True, "session": session, "assistant": assistant_msg}


_ASSIST_PROMPTS = {  # v260929 · PDF 阅读区 AI 助手：按动作切换系统提示词，全部要求 Markdown 输出；具体行为可经 设置→文献/PDF→AI 阅读助手 调整
    "translate": "你是科研文献翻译助手。将用户提供的学术内容准确翻译为目标语言：专业术语首次出现时在括号内保留原文；公式、变量、单位、人名保持原样。只输出译文本身，不要任何解释或原文重复。",
    "summarize": "你是科研文献阅读助手。用中文对用户提供的内容做要点总结：提炼核心观点、方法与结论，输出为简洁的 Markdown 列表；只依据给定内容，不得编造其中不存在的信息。",
    "organize": "你是科研知识整理助手。把用户提供的内容整理为结构化中文知识笔记（Markdown 分节）：核心要点、关键术语、方法/数据、可引用结论；条目化并保留关键数字与公式；只依据给定内容，不得编造。",
    "polish": "你是科研笔记编辑助手。整理润色用户提供的文献笔记（Markdown）：统一为清晰的结构（如 摘要/要点/方法/结论/摘录），修正错别字与冗余表达；必须保留用户笔记中的全部原有信息，不得删改实质内容，不得添加虚构内容。",
}
_MAX_ASSIST_CHARS = 24_000  # 默认输入上限，可经 设置→文献/PDF→AI 阅读助手 调整（1000–60000）


def assist(action: str, text: str, instruction: str = "") -> dict[str, Any]:
    """v260929 · PDF 阅读区 AI 助手（无会话状态的一次性补全）：
    复用 设置→Agent/LLM 的模型档案；行为参数（启用/请求模式/翻译目标语言/附加风格指令/输入上限）
    来自 设置→文献/PDF→AI 阅读助手（config/app.json llm.assist）。"""
    action = str(action or "").strip() or "custom"
    instruction = str(instruction or "").strip()
    text = str(text or "").strip()
    if not text:
        raise ValueError("没有可处理的文本")
    cfg = _llm_cfg()
    st = cfg.get("assist") if isinstance(cfg.get("assist"), dict) else {}
    if st.get("enabled") is False:
        raise ValueError("AI 阅读助手已在 设置 → 文献 / PDF 中关闭")
    try:
        max_chars = max(1000, min(60000, int(st.get("max_chars") or _MAX_ASSIST_CHARS)))
    except Exception:
        max_chars = _MAX_ASSIST_CHARS
    if len(text) > max_chars:
        text = text[:max_chars]
    if action in _ASSIST_PROMPTS:
        system_prompt = _ASSIST_PROMPTS[action]
        if action == "translate":
            lang = str(st.get("target_language") or "中文").strip() or "中文"
            system_prompt += f"\n目标语言：{lang}。"
    else:
        if not instruction:
            raise ValueError("自定义指令不能为空")
        system_prompt = "你是科研工作台里的 AI 助手，严格按用户给出的指令处理提供的文本，输出中文 Markdown。"
    style = str(st.get("style_instruction") or "").strip()
    if style:
        system_prompt += "\n\n附加要求：\n" + style
    preset_id, preset_label, preset_model, preset_temperature, request_params = _request_preset(cfg, str(st.get("request_preset") or ""))
    model_override = str(st.get("model_override") or "").strip()  # v260929 · 阅读助手可无视所选请求模式，直接覆盖模型/温度/附加参数
    if model_override:
        preset_model = model_override
    if not preset_model:
        raise ValueError(f"请求模式 {preset_label} 尚未配置模型名称，可在 设置 → 文献/PDF → AI 阅读助手 的「模型覆盖」中填写")
    request_cfg = dict(cfg)
    request_cfg["model"] = preset_model
    resolved_temp = preset_temperature
    if st.get("temperature_override") is not None:
        try:
            resolved_temp = float(st.get("temperature_override"))
        except Exception:
            pass
    if resolved_temp is not None:
        request_cfg["temperature"] = resolved_temp
    extra = st.get("extra_params") if isinstance(st.get("extra_params"), dict) else {}
    if extra:
        request_params = _deep_merge_request(request_params, extra, {"model", "messages", "stream"})
    user_text = text + (f"\n\n---\n指令：{instruction}" if instruction and action == "custom" else "")
    content, reasoning = _chat_completions(request_cfg, system_prompt, [], user_text, None, request_params)
    return {"ok": True, "action": action, "content": content, "model": preset_model,
            "reasoning": reasoning if cfg.get("show_reasoning", True) else ""}


def test_connection() -> dict[str, Any]:
    cfg = _llm_cfg()
    url = _endpoint(str(cfg["base_url"]), "/models")
    data = _http_json(url, None, str(cfg["api_key"]), min(int(cfg.get("timeout") or 30), 45), method="GET")
    models = data.get("data") if isinstance(data, dict) else []
    names = [str(x.get("id")) for x in (models or []) if isinstance(x, dict) and x.get("id")][:12]
    return {"ok": True, "models": names, "message": "连接成功", "profile": cfg.get("name") or ""}
