from __future__ import annotations

import json
import os
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"
DEFAULT_APP_CONFIG = {
    "app_name": "科研工作台",
    "subtitle": "Engineering Research Workspace",
    "host": "127.0.0.1",
    "port": 8765,
    "auto_open_browser": True,
    "workspace": "Workspace",
    "weather": {
        "enabled": True,
        "location": "天津市南开区",
        "latitude": 39.105,
        "longitude": 117.15,
        "timezone": "Asia/Shanghai",
    },
    "ui": {
        "theme": "light",
        "sidebar_pinned_groups": ["core"],
        "milestone_default_view": "timeline",
        "graph_default_view": "2d",
        "animations": True,
        "heatmap_months": 12,
    },
    "academic_profile": {
        "degree_name": "博士进度",
        "start_date": "",
        "expected_end_date": "",
        "weekly_goal_days": 5,
        "graduation_conditions": [],
    },
    "workspace_migration": {
        "enabled": True,
        "copy_legacy_data": True,
    },
    "llm": {
        "enabled": False,
        "provider_label": "OpenAI-compatible",
        "base_url": "https://api.openai.com/v1",
        "api_key_env": "OPENAI_API_KEY",
        "show_reasoning": True,
        "model": "",
        "protocol": "chat_completions",
        "timeout": 120,
        "max_output_tokens": 0,
        "temperature": None,
        "system_prompt": "你是一个严谨的科研助手。优先基于用户显式引用的研究资料回答，不确定时明确说明。",
        "request_presets": [
            {"id": "default", "label": "默认（不附加参数）", "params": {}},
            {"id": "qwen-low", "label": "Qwen · 低思考", "params": {"enable_thinking": True, "thinking_budget": 1024}},
            {"id": "qwen-off", "label": "Qwen · 无思考", "params": {"enable_thinking": False}}
        ],
        "default_request_preset": "default"
    },
}

DEFAULT_RSS_CONFIG = {
    "sources": [
        {
            "name": "arXiv · Artificial Intelligence",
            "url": "https://rss.arxiv.org/rss/cs.AI",
            "enabled": True,
        },
        {
            "name": "arXiv · Machine Learning",
            "url": "https://rss.arxiv.org/rss/cs.LG",
            "enabled": True,
        },
        {
            "name": "arXiv · Computation and Language",
            "url": "https://rss.arxiv.org/rss/cs.CL",
            "enabled": True,
        },
    ],
    "max_items_per_source": 12,
}

_lock = threading.RLock()
_cache: dict[str, Any] = {}
_secrets_mtime: int | None = None


def load_secrets() -> None:
    """加载本地私密配置 config/secrets.json（已被 .gitignore 排除，不上传 git）。

    将其中 env 对象的键值注入进程环境变量，供 agent 按 api_key_env 读取。
    通过文件修改时间检测变更：保存后自动重新注入，无需重启服务。
    文件不存在或格式异常时静默跳过，不阻断启动。
    """
    global _secrets_mtime
    path = CONFIG_DIR / "secrets.json"
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        _secrets_mtime = None
        return
    if mtime == _secrets_mtime:
        return
    _secrets_mtime = mtime
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
        env = data.get("env") if isinstance(data, dict) else None
        if not isinstance(env, dict):
            return
        for key, value in env.items():
            name = str(key).strip()
            if name and isinstance(value, str) and value.strip():
                os.environ[name] = value.strip()
    except Exception:
        pass

def _deep_merge(base: dict, override: dict) -> dict:
    out = deepcopy(base)
    for key, value in (override or {}).items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def _atomic_json_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _load_json(path: Path, default: dict) -> dict:
    if not path.exists():
        _atomic_json_write(path, default)
        return deepcopy(default)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return _deep_merge(default, data if isinstance(data, dict) else {})
    except Exception:
        return deepcopy(default)


def reload_all() -> dict:
    global _cache
    with _lock:
        app = _load_json(CONFIG_DIR / "app.json", DEFAULT_APP_CONFIG)
        rss = _load_json(CONFIG_DIR / "rss.json", DEFAULT_RSS_CONFIG)
        llm = app.setdefault("llm", {})
        # v260920.2 no longer reads or stores API keys on disk. Older key fields are ignored.
        llm.pop("api_key", None)
        if not str(llm.get("api_key_env") or "").strip():
            llm["api_key_env"] = "OPENAI_API_KEY"
        _cache = {"app": app, "rss": rss}
        return deepcopy(_cache)

def get_all() -> dict:
    load_secrets()
    with _lock:
        if not _cache:
            return reload_all()
        return deepcopy(_cache)


def get_app() -> dict:
    return get_all()["app"]


def get_public() -> dict:
    data = get_all()
    app = deepcopy(data.get("app", {}))
    llm = dict(app.get("llm") or {})
    env_name = str(llm.get("api_key_env") or "OPENAI_API_KEY").strip()
    llm["api_key_env"] = env_name
    llm["has_api_key"] = bool(env_name and __import__("os").environ.get(env_name))
    llm["api_key_source"] = "environment"
    app["llm"] = llm
    return {"app": app, "rss": data.get("rss", {})}


def get_rss() -> dict:
    return get_all()["rss"]


def save_app(data: dict) -> dict:
    incoming = deepcopy(data or {})
    incoming_llm = incoming.get("llm") if isinstance(incoming.get("llm"), dict) else None
    if incoming_llm is not None:
        incoming_llm.pop("has_api_key", None)
        incoming_llm.pop("api_key", None)
        incoming_llm.pop("api_key_source", None)
        incoming_llm["api_key_env"] = str(incoming_llm.get("api_key_env") or "OPENAI_API_KEY").strip() or "OPENAI_API_KEY"
    merged = _deep_merge(DEFAULT_APP_CONFIG, incoming)
    merged.setdefault("llm", {}).pop("api_key", None)
    with _lock:
        _atomic_json_write(CONFIG_DIR / "app.json", merged)
        reload_all()
    return get_public()["app"]

def save_rss(data: dict) -> dict:
    merged = _deep_merge(DEFAULT_RSS_CONFIG, data or {})
    with _lock:
        _atomic_json_write(CONFIG_DIR / "rss.json", merged)
        reload_all()
    return get_rss()


def workspace_root() -> Path:
    cfg = get_app()
    raw = str(cfg.get("workspace") or "Workspace")
    p = Path(raw)
    return p if p.is_absolute() else ROOT / p


load_secrets()
reload_all()
