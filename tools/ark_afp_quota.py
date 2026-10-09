"""火山方舟 Agent Plan 额度（AFP）查询与 token 换算 · v261009.3

只读脚本：用火山引擎 AK/SK 对管控面 `GetAFPUsage` 做 HMAC-SHA256 签名请求，
打印各窗口（5 小时 / 周 / 月 / 视觉日）的配额、已用、剩余、重置时间，
并按实测的 AFP↔token 系数把剩余额度换算成「还能跑多少 token / 多少轮」。

用法：
    python tools/ark_afp_quota.py                      # 查额度 + 换算表
    python tools/ark_afp_quota.py --turns 25500        # 追加「每轮 X token」的轮数估算
    python tools/ark_afp_quota.py --json               # 机器可读输出

凭据来源（按序）：环境变量 VOLC_ACCESSKEY / VOLC_SECRETKEY →
`~/.dsh/.credentials.yaml` 的 refs 段。脚本不打印密钥。

系数口径（2026-10-09 实测，见 CHANGELOG v261009.3）：
    deepseek-v4.1-flash 在 Agent Plan 内 **输入与输出同价、缓存命中不额外打折**，
    1 AFP = 10,000 tokens（= 100 AFP / 1M tokens）。该值是 2026-09-15~2026-10-30
    五折活动价，活动结束后同样 token 会按双倍 AFP 计。
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HOST = "open.volcengineapi.com"
SERVICE = "ark"
REGION = "cn-beijing"
VERSION = "2024-01-01"
CRED_FILE = Path.home() / ".dsh" / ".credentials.yaml"

# 窗口键 → 中文名。AFPDaily 是「视觉日额度」，文本模型不消耗。
WINDOWS = [
    ("AFPFiveHour", "5 小时"),
    ("AFPWeekly", "周"),
    ("AFPMonthly", "月"),
    ("AFPDaily", "视觉日"),
]

# AFP / 1M tokens（输入、输出、缓存命中）。实测值见模块 docstring。
AFP_RATES: dict[str, dict[str, float]] = {
    "deepseek-v4.1-flash": {"input": 100.0, "output": 100.0, "cache_hit": 100.0},
}
PLAN_NAMES = {"small": "Small", "medium": "Medium", "large": "Large", "max": "Max"}

# 官方按量单价（CNY / 1M tokens），来源：DeepSeek 官方「模型 & 价格」页（2026-10-09 取）。
# deepseek-flash 即 DeepSeek-V4.1-Flash；空闲时段价为高峰时段价的一半，高峰 = 工作日
# （不含法定节假日）北京时间 9:00-12:00 与 14:00-18:00，其余时段含周末全天为空闲。
OFFICIAL_PRICES: dict[str, dict[str, dict[str, float]]] = {
    "deepseek-v4.1-flash": {
        "cache_hit": {"off_peak": 0.02, "peak": 0.04},
        "input": {"off_peak": 1.0, "peak": 2.0},
        "output": {"off_peak": 4.0, "peak": 8.0},
    },
}
PRICE_SOURCE = "DeepSeek 官方「模型 & 价格」（deepseek-flash = DeepSeek-V4.1-Flash，2026-10-09 取）"
# 方舟 Agent Plan 个人版月费（CNY）：文档公开的四档标价。
SUBSCRIPTION_CNY = {"small": 40.0, "medium": 200.0, "large": 500.0, "max": 1000.0}
PRICE_LABELS = {"cache_hit": "输入·缓存命中", "input": "输入·缓存未命中", "output": "输出"}


# ── 凭据 ────────────────────────────────────────────────────────────────

def _strip_quotes(value: str) -> str:
    return value.strip().strip('"').strip("'")


def load_credentials() -> tuple[str, str]:
    """返回 (accessKeyId, secretAccessKey)；环境变量优先，其次 ~/.dsh/.credentials.yaml。"""
    ak = os.environ.get("VOLC_ACCESSKEY", "").strip()
    sk = os.environ.get("VOLC_SECRETKEY", "").strip()
    if ak and sk:
        return ak, sk
    if CRED_FILE.exists():
        for line in CRED_FILE.read_text(encoding="utf-8").splitlines():
            key, _, value = line.strip().partition(":")
            key = key.strip()
            if key == "VOLC_ACCESSKEY" and not ak:
                ak = _strip_quotes(value)
            elif key == "VOLC_SECRETKEY" and not sk:
                sk = _strip_quotes(value)
    if not ak or not sk:
        raise SystemExit("未找到火山引擎 AK/SK：请设置 VOLC_ACCESSKEY / VOLC_SECRETKEY，"
                         "或在 ~/.dsh/.credentials.yaml 的 refs 段写入这两个键。")
    return ak, sk


# ── 签名与请求（火山引擎 OpenAPI，仅签 host;x-content-sha256;x-date 三头）────

def _hmac(key: bytes, data: str) -> bytes:
    return hmac.new(key, data.encode("utf-8"), hashlib.sha256).digest()


def _sha256hex(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="-_.~")


def sign(ak: str, sk: str, action: str, when: dt.datetime | None = None) -> tuple[str, dict[str, str]]:
    now = when or dt.datetime.now(dt.timezone.utc)
    x_date = now.strftime("%Y%m%dT%H%M%SZ")
    date = x_date[:8]
    body_sha = _sha256hex("")
    signed_headers = "host;x-content-sha256;x-date"
    canonical_headers = f"host:{HOST}\nx-content-sha256:{body_sha}\nx-date:{x_date}"
    query = {"Action": action, "Version": VERSION}
    qs = "&".join(f"{_quote(k)}={_quote(query[k])}" for k in sorted(query))
    canonical_request = "\n".join(["GET", "/", qs, canonical_headers + "\n", signed_headers, body_sha])
    scope = f"{date}/{REGION}/{SERVICE}/request"
    string_to_sign = "\n".join(["HMAC-SHA256", x_date, scope, _sha256hex(canonical_request)])
    key = _hmac(_hmac(_hmac(_hmac(sk.encode("utf-8"), date), REGION), SERVICE), "request")
    signature = hmac.new(key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    headers = {
        "Host": HOST,
        "X-Date": x_date,
        "X-Content-Sha256": body_sha,
        "Authorization": f"HMAC-SHA256 Credential={ak}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
        "User-Agent": "workbench-ark-afp/261009",
        "Accept": "application/json",
    }
    return f"https://{HOST}/?{qs}", headers


def fetch_afp(ak: str, sk: str, timeout: int = 30) -> dict:
    """调用 GetAFPUsage，返回 Result 段。"""
    url, headers = sign(ak, sk, "GetAFPUsage")
    req = urllib.request.Request(url, method="GET")
    for name, value in headers.items():
        req.add_header(name, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:300]
        raise SystemExit(f"GetAFPUsage 失败：HTTP {exc.code} {detail}") from None
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"GetAFPUsage 请求异常：{type(exc).__name__}: {exc}") from None
    err = ((payload.get("ResponseMetadata") or {}).get("Error") or {})
    if err:
        raise SystemExit(f"GetAFPUsage 业务错误：{err.get('Code')} {err.get('Message')}")
    result = payload.get("Result")
    if not isinstance(result, dict):
        raise SystemExit("GetAFPUsage 响应缺少 Result 段")
    return result


# ── 展示 ────────────────────────────────────────────────────────────────

def _local(ms: float | int | None) -> dt.datetime | None:
    if not ms or float(ms) <= 0:
        return None
    return dt.datetime.fromtimestamp(float(ms) / 1000, dt.timezone.utc).astimezone()


def _countdown(ms: float | int | None) -> str:
    target = _local(ms)
    if target is None:
        return "—"
    delta = target - dt.datetime.now(dt.timezone.utc).astimezone()
    if delta.total_seconds() <= 0:
        return "已重置/待刷新"
    total = int(delta.total_seconds())
    days, rem = divmod(total, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days:
        return f"{days} 天 {hours} 小时"
    if hours:
        return f"{hours} 小时 {minutes} 分"
    return f"{minutes} 分"


def _fmt_tokens(tokens: float) -> str:
    if tokens >= 1e9:
        return f"{tokens / 1e9:.2f}B"
    if tokens >= 1e6:
        return f"{tokens / 1e6:.1f}M"
    if tokens >= 1e3:
        return f"{tokens / 1e3:.1f}K"
    return f"{tokens:.0f}"


def _rate_for(model: str) -> dict[str, float]:
    rate = AFP_RATES.get(model)
    if rate is None:
        raise SystemExit(f"未知模型 {model!r}；已知：{', '.join(sorted(AFP_RATES))}")
    return rate


def print_report(result: dict, model: str, turns_tokens: int, quiet: bool = False) -> dict:
    rate = _rate_for(model)
    # 输入与输出同价，故「每 AFP 折算多少 token」与输入输出配比无关，可直接换算。
    afp_per_token = rate["input"] / 1e6
    plan = PLAN_NAMES.get(str(result.get("PlanType") or "").lower(), str(result.get("PlanType") or "—"))
    rows = []
    for key, label in WINDOWS:
        win = result.get(key) or {}
        quota = float(win.get("Quota") or 0)
        used = float(win.get("Used") or 0)
        remaining = max(quota - used, 0.0)
        rows.append({
            "window": label,
            "key": key,
            "quota_afp": quota,
            "used_afp": round(used, 4),
            "remaining_afp": round(remaining, 4),
            "percent": round(used / quota * 100, 2) if quota else None,
            "remaining_tokens": int(remaining / afp_per_token) if afp_per_token else 0,
            "reset_at": _local(win.get("ResetTime")).isoformat(timespec="seconds") if _local(win.get("ResetTime")) else None,
            "reset_in": _countdown(win.get("ResetTime")),
        })
    summary = {
        "model": model,
        "plan": plan,
        "afp_per_1m_tokens": rate["input"],
        "tokens_per_afp": int(1 / afp_per_token) if afp_per_token else 0,
        "windows": rows,
        "turns_tokens": turns_tokens,
    }
    if turns_tokens > 0:
        per_turn = turns_tokens / 1e6 * rate["input"]
        summary["afp_per_turn"] = round(per_turn, 4)
        for row in rows:
            row["turns_for_remaining"] = int(row["remaining_afp"] / per_turn) if per_turn else None
    if quiet:
        return summary

    print(f"火山方舟 Agent Plan · {plan} 套餐   模型 {model}")
    print(f"实测系数：{rate['input']:.0f} AFP / 1M tokens（输入=输出，缓存命中同价）"
          f" → 1 AFP = {summary['tokens_per_afp']:,} tokens")
    print("-" * 78)
    head = f"{'窗口':<8}{'配额':>12}{'已用':>12}{'剩余':>12}{'已用%':>8}"
    if turns_tokens > 0:
        head += f"{'≈轮数':>10}"
    print(head + "   重置")
    for row in rows:
        line = (f"{row['window']:<8}{row['quota_afp']:>12,.0f}{row['used_afp']:>12,.2f}"
                f"{row['remaining_afp']:>12,.2f}{(row['percent'] or 0):>7.2f}%")
        if turns_tokens > 0:
            line += f"{(row['turns_for_remaining'] or 0):>10,}"
        reset = f"{row['reset_at'][:16] if row['reset_at'] else '—'}（{row['reset_in']}）"
        print(line + "   " + reset)
    print("-" * 78)
    rate = _rate_for(model)
    for row in rows:
        note = "（视觉专用，文本调用不消耗）" if row["key"] == "AFPDaily" else ""
        print(f"  {row['window']:<6}剩余可跑 ≈ {_fmt_tokens(row['remaining_tokens'])} tokens{note}")
    if turns_tokens > 0:
        print(f"  每轮按 {turns_tokens:,} tokens 计 → {summary['afp_per_turn']:.4f} AFP / 轮（已用% 达 100% 即该窗口额度耗尽）")
    return summary


def _cny(value: float) -> str:
    if value >= 0.01:
        return f"¥{value:,.2f}"
    return f"¥{value:.4f}"


def print_official_report(result: dict, model: str, quiet: bool = False) -> dict:
    """把 AFP 额度按官方按量单价折算成人民币（三种 token 口径 × 空闲/高峰两档）。"""
    rate = _rate_for(model)
    prices = OFFICIAL_PRICES.get(model)
    if prices is None:
        raise SystemExit(f"缺少 {model!r} 的官方单价，请在 OFFICIAL_PRICES 中补充。")
    tokens_per_afp = 1e6 / rate["input"]
    # 每 AFP 的金额 = 10,000 tokens × 单价
    per_afp = {kind: {tier: tokens_per_afp / 1e6 * value for tier, value in tiers.items()}
               for kind, tiers in prices.items()}
    plan_key = str(result.get("PlanType") or "").lower()
    plan = PLAN_NAMES.get(plan_key, plan_key or "—")

    rows = []
    for key, label in WINDOWS:
        win = result.get(key) or {}
        quota = float(win.get("Quota") or 0)
        used = float(win.get("Used") or 0)
        remaining = max(quota - used, 0.0)
        row = {"window": label, "quota_afp": quota, "used_afp": round(used, 4),
               "remaining_afp": round(remaining, 4)}
        for kind, tiers in per_afp.items():
            for tier, unit in tiers.items():
                row[f"remaining_cny_{kind}_{tier}"] = round(remaining * unit, 4)
                row[f"used_cny_{kind}_{tier}"] = round(used * unit, 4)
        rows.append(row)

    # 套餐 vs 按量：月额度摊薄到每 1M tokens 的成本
    month = next((r for r in rows if r["window"] == "月"), None)
    month_afp = month["quota_afp"] if month else 0.0
    fee = SUBSCRIPTION_CNY.get(plan_key)
    compare = {}
    if month_afp > 0 and fee:
        month_tokens = month_afp * tokens_per_afp
        threshold = fee / (month_tokens / 1e6)  # CNY / 1M tokens
        compare["monthly_fee_cny"] = fee
        compare["month_tokens"] = int(month_tokens)
        compare["diluted_cny_per_1m_tokens"] = round(threshold, 4)
        for tier in ("off_peak", "peak"):
            hit, miss, out = prices["cache_hit"][tier], prices["input"][tier], prices["output"][tier]
            # 纯输入负载：h·命中 + (1-h)·未命中 = 摊薄成本 → 命中率高于 h* 时按量反而更便宜
            h = (miss - threshold) / (miss - hit) if miss > hit else None
            compare[f"breakeven_cache_hit_rate_{tier}"] = round(h, 4) if h is not None and 0 < h < 1 else None
            compare[f"multiplier_input_{tier}"] = round(miss / threshold, 2)
            compare[f"multiplier_output_{tier}"] = round(out / threshold, 2)
            compare[f"multiplier_cache_hit_{tier}"] = round(hit / threshold, 2)

    summary = {"model": model, "plan": plan, "tokens_per_afp": int(tokens_per_afp),
               "price_source": PRICE_SOURCE, "per_afp_cny": per_afp, "windows": rows, "compare": compare}
    if quiet:
        return summary

    print(f"=== 折算成官方按量价格（CNY）· {model} · {plan} 套餐 ===")
    print(f"单价来源：{PRICE_SOURCE}")
    print(f"1 AFP = {int(tokens_per_afp):,} tokens → 每 AFP 值："
          + " | ".join(f"{PRICE_LABELS[k]} {_cny(tiers['off_peak'])}" for k, tiers in per_afp.items())
          + "（空闲；高峰 ×2）")
    print("-" * 78)
    print(f"{'窗口':<8}{'剩余 AFP':>12}{'全命中输入':>16}{'全未命中输入':>16}{'全输出':>16}")
    for row in rows:
        print(f"{row['window']:<8}{row['remaining_afp']:>12,.2f}"
              f"{_cny(row['remaining_cny_cache_hit_off_peak']):>16}"
              f"{_cny(row['remaining_cny_input_off_peak']):>16}"
              f"{_cny(row['remaining_cny_output_off_peak']):>16}")
    print("-" * 78)
    print("同表高峰时段（工作日 9-12、14-18 北京时间）金额翻倍：")
    for row in rows:
        print(f"  {row['window']:<6} 命中 {_cny(row['remaining_cny_cache_hit_peak'])} / "
              f"未命中 {_cny(row['remaining_cny_input_peak'])} / 输出 {_cny(row['remaining_cny_output_peak'])}")
    print("-" * 78)
    print("已用量折算（空闲）：")
    for row in rows:
        print(f"  {row['window']:<6} 已用 {row['used_afp']:,.2f} AFP → 命中 {_cny(row['used_cny_cache_hit_off_peak'])} / "
              f"未命中 {_cny(row['used_cny_input_off_peak'])} / 输出 {_cny(row['used_cny_output_off_peak'])}")
    if compare:
        print("-" * 78)
        print(f"=== 套餐 vs 按量付费 ===")
        print(f"月费 ¥{compare['monthly_fee_cny']:,.0f} / 月额度 {month_afp:,.0f} AFP（= {_fmt_tokens(compare['month_tokens'])} tokens）"
              f" → 摊薄成本 **¥{compare['diluted_cny_per_1m_tokens']:.4f} / 1M tokens**")
        for tier, name in (("off_peak", "空闲"), ("peak", "高峰")):
            h = compare.get(f"breakeven_cache_hit_rate_{tier}")
            print(f"  {name}时段按量单价 × 套餐摊薄成本：未命中输入 {compare[f'multiplier_input_{tier}']}× / "
                  f"输出 {compare[f'multiplier_output_{tier}']}× / 缓存命中 {compare[f'multiplier_cache_hit_{tier}']}×"
                  + (f"；纯输入负载的缓存命中率高于 {h * 100:.1f}% 时按量反而更便宜" if h else ""))
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="火山方舟 Agent Plan AFP 额度查询与 token/价格换算（只读）")
    parser.add_argument("--model", default="deepseek-v4.1-flash", help="按该模型的实测系数换算（默认 deepseek-v4.1-flash）")
    parser.add_argument("--turns", type=int, default=0, metavar="TOKENS", help="按每轮 N tokens 追加估算剩余轮数")
    parser.add_argument("--official", action="store_true", help="追加「折算成官方按量价格（CNY）」报表")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args(argv)

    ak, sk = load_credentials()
    result = fetch_afp(ak, sk)
    quota = print_report(result, args.model, max(args.turns, 0), quiet=args.json)
    official = print_official_report(result, args.model, quiet=args.json) if args.official else None
    if args.json:
        payload = {"quota": quota, "official": official} if official is not None else {"quota": quota}
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
