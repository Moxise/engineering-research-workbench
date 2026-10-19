"""Bounded context with verbatim evidence references and extractive compaction."""
from __future__ import annotations

import copy
import json
import math
import re
from collections import Counter


RESEARCH_RULES = """研究取证规则：
1. 优先回答用户本轮问题；解释或检索问题不需要额外建档或要求用户确认下一步。
2. 区分搜索候选节选、已读正文、原始文献和自行推断。笔记引用原文时，沿 links 的 doc_id/paper_id 或用 kb_read(title=准确标题)核对关键原文。
3. 当前页面未挂载文献只表示缺少页面上下文，不表示知识库没有文献；搜索前列未命中也不能证明条目不存在。先按准确标题打开来源，不能据此诊断索引缺失或要求重新上传。
4. workspace_list 只反映当前层级，目录大小不是递归内容大小，不得据此宣称整个目录或知识库为空。
5. 引用使用 [[条目ID|标题]] 或工具返回的 citation，不编造条目。没有读取原文时明确说明；职责分工、作者结论以原文为准，领域扩展和工程建议单独标明。
6. 检索清单、读取范围、工具次数依据实际执行记录和下方系统统计，不凭回忆编造；性能和预算同时考虑模型请求/token、工具调用和总耗时。确定性计算结果依赖模型、输入与求解状态，不能将失败/超时/不收敛直接当成不可行或现实真值。
"""


def execution_summary(trace: list[dict], evidence: list[dict]) -> str:
    counts = dict(Counter(item.get("tool", "unknown") for item in trace))
    reads = []
    for message in evidence:
        if message.get("role") != "tool":
            continue
        try:
            value = json.loads(message.get("content") or "{}")
        except (ValueError, TypeError):
            continue
        if not isinstance(value, dict):
            continue
        if value.get("id") and "body" in value:
            reads.append({k: value.get(k) for k in ("id", "title", "read_scope", "total_chars", "next_offset")})
    return json.dumps({"tool_calls": len(trace), "tool_counts": counts, "read_documents": reads}, ensure_ascii=False)


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
        if role == "assistant" and item.get("tool_trace"):
            text += "\n\n[系统生成的本轮执行统计，优先于回复中自述的检索次数与读取范围]\n" + execution_summary(item["tool_trace"], item.get("evidence") or [])
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
