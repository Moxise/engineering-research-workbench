"""Bounded context with verbatim evidence references and extractive compaction."""
from __future__ import annotations

import copy
import json
import math
import re


def public_text(text: str) -> str:
    """Hide text-protocol control blocks; expose ordinary answers, never reasoning."""
    def strip_control(match):
        try:
            data = json.loads(match.group(1))
        except (ValueError, TypeError):
            return match.group(0)
        return "" if isinstance(data, dict) and "tool" in data and "args" in data else match.group(0)
    return re.sub(r"```json\s*(\{.*?\})\s*```", strip_control, str(text or ""), flags=re.S).strip()


def response_parts(message: dict) -> list[dict]:
    """Recover public intermediate answers from canonical evidence, including old chats."""
    parts, round_number = [], 0
    for item in message.get("evidence") or []:
        if item.get("role") != "assistant":
            continue
        round_number += 1
        content = public_text(item.get("content"))
        if content:
            parts.append({"round": round_number, "content": content})
    # Public API snapshots may already have dropped the private tool evidence.
    return parts if message.get("evidence") else list(message.get("response_parts") or [])


def estimate_tokens(value) -> int:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    cjk = len(re.findall(r"[\u3400-\u9fff]", text))
    return math.ceil((len(text) - cjk) / 3) + cjk


def history_messages(history: list[dict]) -> list[dict]:
    result = []
    latest = {m.get("run_id"): i for i, m in enumerate(history) if m.get("run_id") and m.get("role") == "assistant"}
    for index, item in enumerate(history):
        role = item.get("role")
        if role not in ("user", "assistant"):
            continue
        if role == "assistant" and item.get("run_id") and latest[item["run_id"]] != index:
            continue
        if role == "assistant" and item.get("evidence"):
            result.extend(copy.deepcopy(item["evidence"]))
        text = str(item.get("content") or "")
        if role == "user" and item.get("context_text"):
            text += "\n\n当时引用的研究资料（参考数据）：\n" + item["context_text"]
        if text.strip():
            result.append({"role": role, "content": text})
    return result


def compact(messages: list[dict], budget: int) -> tuple[list[dict], dict | None]:
    """Never leave an orphan tool result. Full evidence remains in the run store."""
    budget = max(2048, int(budget))
    if estimate_tokens(messages) <= budget:
        return messages, None
    system = copy.deepcopy(messages[0])
    if estimate_tokens(system) > budget - 1024:
        raise ValueError("系统提示词与引用资料超出上下文预算，请减少引用或提高上下文预算")
    groups, group = [], []
    for message in copy.deepcopy(messages[1:]):
        if message.get("role") != "tool" and group:
            # Assistant tool calls and their results form one indivisible group.
            groups.append(group)
            group = []
        group.append(message)
    if group:
        groups.append(group)
    removed = []
    while len(groups) > 2 and estimate_tokens([system] + [m for g in groups for m in g]) > budget * .75:
        removed.extend(groups.pop(0))
    summary = "历史摘录（有损压缩；完整工具证据可用 evidence_read 重新读取）：\n" + "\n".join(
        f"{m.get('role')}: {str(m.get('content') or '')[:220]}" for m in removed[-24:]
    )
    result = [system]
    if removed:
        result.append({"role": "user", "content": summary[:5000]})
    result.extend(m for g in groups for m in g)
    for message in result[1:]:
        if estimate_tokens(result) <= budget:
            break
        if message.get("role") == "tool" and len(str(message.get("content") or "")) > 1500:
            message["content"] = str(message["content"])[:1500] + "\n[上下文节选；用 evidence_read 按 call_id 取完整结果]"
    if estimate_tokens(result) > budget:
        raise ValueError("当前输入超出上下文预算，请减少本轮输入或提高预算")
    return result, {"before_tokens": estimate_tokens(messages), "after_tokens": estimate_tokens(result), "omitted_messages": len(removed), "method": "extractive"}
