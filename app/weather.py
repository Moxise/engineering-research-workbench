from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .config import get_app
from .workspace import ensure_workspace

WEATHER_CODE = {
    0: "晴",
    1: "大部晴朗", 2: "局部多云", 3: "阴",
    45: "雾", 48: "雾凇",
    51: "小毛毛雨", 53: "毛毛雨", 55: "强毛毛雨",
    56: "冻毛毛雨", 57: "强冻毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨",
    66: "冻雨", 67: "强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "米雪",
    80: "阵雨", 81: "中等阵雨", 82: "强阵雨",
    85: "阵雪", 86: "强阵雪",
    95: "雷暴", 96: "雷暴伴小冰雹", 99: "雷暴伴大冰雹",
}
CACHE_TTL = 10 * 60


def _cache_path() -> Path:
    return ensure_workspace() / "System" / "Cache" / "weather.json"


def clear_cache() -> None:
    try:
        _cache_path().unlink(missing_ok=True)
    except OSError:
        pass


def _json_get(url: str, timeout: float = 7.0) -> dict:
    req = Request(url, headers={"User-Agent": "EngineeringResearchWorkbench/1.0"})
    with urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(4 * 1024 * 1024).decode("utf-8"))


def _cached(cache_key: str, *, max_age: float | None) -> dict | None:
    """读缓存。`max_age=None` 表示不限新鲜度（断网时用陈旧数据也比报错好）。"""
    p = _cache_path()
    if not p.exists():
        return None
    try:
        c = json.loads(p.read_text(encoding="utf-8"))
        if c.get("key") != cache_key:
            return None
        if max_age is not None and time.time() - float(c.get("timestamp", 0)) >= max_age:
            return None
        return c["data"]
    except Exception:
        return None


def geocode(name: str) -> dict:
    """地名解析。**离线不抛异常**：返回空结果 + 原因（前端设置页据此提示，而不是 500）。"""
    if not str(name or "").strip():
        return {"results": []}
    params = urlencode({"name": name, "count": 6, "language": "zh", "format": "json"})
    try:
        data = _json_get("https://geocoding-api.open-meteo.com/v1/search?" + params)
    except Exception as exc:  # URLError / timeout / JSON 解析失败
        return {"results": [], "unavailable": True, "reason": _reason(exc)}
    return {"results": data.get("results", [])}


def _reason(exc: Exception) -> str:
    text = str(exc)
    if "10061" in text or "refused" in text.lower():
        return "网络不可达（连接被拒绝）"
    if "timed out" in text.lower() or "timeout" in text.lower():
        return "网络超时"
    return f"{type(exc).__name__}: {text}"[:160]


def current(force: bool = False) -> dict:
    cfg = get_app().get("weather", {})
    if not cfg.get("enabled", True):
        return {"enabled": False}
    p = _cache_path()
    cache_key = json.dumps({k: cfg.get(k) for k in ("location", "latitude", "longitude", "timezone")}, ensure_ascii=False, sort_keys=True)
    fresh = _cached(cache_key, max_age=CACHE_TTL)
    if fresh is not None and not force:
        return fresh

    # v261009 · 取数失败**不再冒泡成 500**：网络不可达时先退回陈旧缓存，再退化为
    # 「enabled 但 unavailable」的显式载荷。此前离线会 500 + 浏览器 console error，
    # 既让「天气」卡片报错，也让前端冒烟闸门（ui_smoke 断言无 console error）变得不确定。
    try:
        lat = cfg.get("latitude"); lon = cfg.get("longitude"); tz = cfg.get("timezone") or "auto"
        if lat is None or lon is None:
            geo = geocode(str(cfg.get("location") or "")); results = geo.get("results") or []
            if not results:
                raise ValueError("无法解析天气地点")
            lat, lon = results[0]["latitude"], results[0]["longitude"]
            tz = results[0].get("timezone") or tz
        params = {
            "latitude": lat,
            "longitude": lon,
            "timezone": tz,
            "current": "temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "forecast_days": 3,
        }
        data = _json_get("https://api.open-meteo.com/v1/forecast?" + urlencode(params))
    except Exception as exc:
        stale = _cached(cache_key, max_age=None)
        if stale is not None:
            return {**stale, "stale": True, "reason": _reason(exc)}
        return {
            "enabled": True, "unavailable": True, "reason": _reason(exc),
            "location": cfg.get("location") or "当前位置",
            "current": {}, "daily": [], "provider": "Open-Meteo",
        }
    cur = data.get("current", {}); daily = data.get("daily", {}); days = []; times = daily.get("time", [])
    for i, dt in enumerate(times):
        code = (daily.get("weather_code") or [None] * len(times))[i]
        days.append({
            "date": dt,
            "condition": WEATHER_CODE.get(code, f"天气代码 {code}"),
            "high": (daily.get("temperature_2m_max") or [None] * len(times))[i],
            "low": (daily.get("temperature_2m_min") or [None] * len(times))[i],
            "precip_probability": (daily.get("precipitation_probability_max") or [None] * len(times))[i],
        })
    result = {
        "enabled": True,
        "location": cfg.get("location") or "当前位置",
        "latitude": data.get("latitude", lat), "longitude": data.get("longitude", lon), "timezone": data.get("timezone", tz),
        "current": {
            "temperature": cur.get("temperature_2m"), "apparent": cur.get("apparent_temperature"),
            "condition": WEATHER_CODE.get(cur.get("weather_code"), str(cur.get("weather_code"))),
            "precipitation": cur.get("precipitation"), "wind_speed": cur.get("wind_speed_10m"),
        },
        "daily": days,
        "provider": "Open-Meteo",
    }
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"timestamp": time.time(), "key": cache_key, "data": result}, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)
    return result
