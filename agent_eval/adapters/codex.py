"""
Codex / OpenAI adapter.

Handles two formats:
  1. Chat Completions API: messages with assistant tool_calls + tool role results
  2. Responses API (Codex CLI): items with function_call / function_call_output types

Format 1 (Chat Completions):
  [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": null, "tool_calls": [
      {"id": "call_1", "type": "function",
       "function": {"name": "bash", "arguments": "{\"cmd\":\"ls\"}"}}
    ]},
    {"role": "tool", "tool_call_id": "call_1", "content": "file1.py\\nfile2.py"},
    ...
  ]

Format 2 (Responses API):
  [
    {"type": "message", "role": "user", "content": [{"type":"input_text","text":"..."}]},
    {"type": "function_call", "call_id": "fc_1", "name": "bash", "arguments": "{\\"cmd\\":\\"ls\\"}"},
    {"type": "function_call_output", "call_id": "fc_1", "output": "file1.py\\nfile2.py"},
    ...
  ]
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from agent_eval.adapters.base import AdapterMeta, BaseAdapter, ParseResult, REGISTRY
from agent_eval.trajectory import AgentTrajectory, TrajectoryStep


class CodexAdapter(BaseAdapter):
    def meta(self) -> AdapterMeta:
        return AdapterMeta(
            adapter_id="codex",
            name="Codex / OpenAI",
            description="解析 OpenAI Chat Completions (tool_calls) 或 Responses API (function_call) 日志",
            supported_formats=["json", "jsonl"],
            example_snippet='[{"role":"assistant","tool_calls":[{"id":"c1","type":"function","function":{"name":"bash","arguments":"{\\"cmd\\":\\"ls\\"}"}}]}]',
        )

    def parse(self, raw: str, task_id: Optional[str] = None) -> ParseResult:
        warnings: list[str] = []
        data = _parse_json_or_jsonl(raw, warnings)
        if not data:
            return ParseResult(trajectories=[], warnings=warnings)

        if _is_responses_api(data):
            return _parse_responses_api(data, task_id, warnings)
        return _parse_chat_completions(data, task_id, warnings)


def _parse_json_or_jsonl(raw: str, warnings: list[str]) -> list[dict]:
    raw = raw.strip()
    if raw.startswith("["):
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            warnings.append(f"JSON parse error: {e}")
            return []
    items = []
    for i, line in enumerate(raw.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            warnings.append(f"Line {i}: not valid JSON, skipped")
    return items


def _is_responses_api(data: list[dict]) -> bool:
    return any(d.get("type") in ("function_call", "function_call_output") for d in data)


def _parse_chat_completions(
    data: list[dict], task_id: Optional[str], warnings: list[str]
) -> ParseResult:
    tid = task_id or f"openai_{uuid.uuid4().hex[:8]}"
    traj = AgentTrajectory(task_id=tid)
    pending: dict[str, dict[str, Any]] = {}
    last_reasoning: Optional[str] = None

    for msg in data:
        role = msg.get("role", "")

        if role == "assistant":
            content = msg.get("content")
            if content:
                last_reasoning = str(content)

            for tc in msg.get("tool_calls", []):
                fn = tc.get("function", {})
                call_id = tc.get("id", "")
                name = fn.get("name", "unknown")
                try:
                    args = json.loads(fn.get("arguments", "{}"))
                except (json.JSONDecodeError, TypeError):
                    args = {"raw": fn.get("arguments", "")}
                pending[call_id] = {
                    "name": name,
                    "kwargs": args,
                    "reasoning": last_reasoning,
                }
                last_reasoning = None

        elif role == "tool":
            call_id = msg.get("tool_call_id", "")
            content = msg.get("content", "")
            observation = {"result": str(content)}
            if call_id in pending:
                pc = pending.pop(call_id)
                traj.add_step(
                    tool_name=pc["name"],
                    kwargs=pc["kwargs"],
                    observation=observation,
                    reasoning=pc.get("reasoning"),
                )
            else:
                warnings.append(f"tool response for unknown call_id {call_id}")

    for cid, pc in pending.items():
        warnings.append(f"tool_call {pc['name']} (id={cid}) has no response")
        traj.add_step(
            tool_name=pc["name"], kwargs=pc["kwargs"],
            observation={"error": "no response"},
            reasoning=pc.get("reasoning"),
        )

    return ParseResult(
        trajectories=[traj] if traj.steps else [],
        warnings=warnings,
        stats={"format": "chat_completions", "tool_calls": len(traj.steps)},
    )


def _parse_responses_api(
    data: list[dict], task_id: Optional[str], warnings: list[str]
) -> ParseResult:
    tid = task_id or f"codex_{uuid.uuid4().hex[:8]}"
    traj = AgentTrajectory(task_id=tid)
    pending: dict[str, dict[str, Any]] = {}

    for item in data:
        itype = item.get("type", "")

        if itype == "function_call":
            call_id = item.get("call_id", "")
            name = item.get("name", "unknown")
            try:
                args = json.loads(item.get("arguments", "{}"))
            except (json.JSONDecodeError, TypeError):
                args = {"raw": item.get("arguments", "")}
            pending[call_id] = {"name": name, "kwargs": args}

        elif itype == "function_call_output":
            call_id = item.get("call_id", "")
            output = item.get("output", "")
            observation = {"result": str(output)}
            if call_id in pending:
                pc = pending.pop(call_id)
                traj.add_step(
                    tool_name=pc["name"],
                    kwargs=pc["kwargs"],
                    observation=observation,
                )
            else:
                warnings.append(f"function_call_output for unknown call_id {call_id}")

        elif itype == "message" and item.get("role") == "assistant":
            content = item.get("content", [])
            if isinstance(content, list):
                text_parts = [b.get("text", "") for b in content if b.get("type") == "output_text"]
                if text_parts:
                    traj.final_output = "\n".join(text_parts)

    return ParseResult(
        trajectories=[traj] if traj.steps else [],
        warnings=warnings,
        stats={"format": "responses_api", "tool_calls": len(traj.steps)},
    )


REGISTRY.register(CodexAdapter())
