"""
Claude Code / Anthropic Messages API adapter.

Parses conversation logs that use Anthropic's message format with
tool_use and tool_result content blocks.

Expected input: JSON array of messages, each with role and content blocks.
Example:
  [
    {"role": "user", "content": "read the file foo.py"},
    {"role": "assistant", "content": [
      {"type": "thinking", "thinking": "I should use the Read tool..."},
      {"type": "tool_use", "id": "tu_1", "name": "Read", "input": {"path": "foo.py"}}
    ]},
    {"role": "user", "content": [
      {"type": "tool_result", "tool_use_id": "tu_1", "content": "file contents here"}
    ]},
    ...
  ]
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from agent_eval.adapters.base import AdapterMeta, BaseAdapter, ParseResult, REGISTRY
from agent_eval.trajectory import AgentTrajectory, TrajectoryStep


class ClaudeCodeAdapter(BaseAdapter):
    def meta(self) -> AdapterMeta:
        return AdapterMeta(
            adapter_id="claude_code",
            name="Claude Code / Anthropic",
            description="解析 Anthropic Messages API 的对话日志 (tool_use / tool_result / thinking)",
            supported_formats=["json", "jsonl"],
            example_snippet='[{"role":"assistant","content":[{"type":"tool_use","id":"tu_1","name":"Read","input":{"path":"foo.py"}}]}]',
        )

    def parse(self, raw: str, task_id: Optional[str] = None) -> ParseResult:
        warnings: list[str] = []
        data = _parse_input(raw, warnings)
        if not data:
            return ParseResult(trajectories=[], warnings=warnings)

        tid = task_id or f"claude_{uuid.uuid4().hex[:8]}"
        traj = AgentTrajectory(task_id=tid)

        pending_calls: dict[str, dict[str, Any]] = {}
        current_reasoning: Optional[str] = None

        for msg in data:
            role = msg.get("role", "")
            content = msg.get("content", "")

            if isinstance(content, str):
                if role == "assistant":
                    traj.final_output = content
                continue

            if not isinstance(content, list):
                continue

            for block in content:
                btype = block.get("type", "")

                if btype == "thinking":
                    current_reasoning = block.get("thinking", "")

                elif btype == "text" and role == "assistant":
                    traj.final_output = block.get("text", "")

                elif btype == "tool_use":
                    call_id = block.get("id", "")
                    pending_calls[call_id] = {
                        "name": block.get("name", "unknown"),
                        "kwargs": block.get("input", {}),
                        "reasoning": current_reasoning,
                    }
                    current_reasoning = None

                elif btype == "tool_result":
                    call_id = block.get("tool_use_id", "")
                    result_content = block.get("content", "")
                    if isinstance(result_content, list):
                        result_content = " ".join(
                            b.get("text", str(b)) for b in result_content
                        )

                    observation = {"result": str(result_content)}
                    if block.get("is_error"):
                        observation["error"] = True

                    if call_id in pending_calls:
                        pc = pending_calls.pop(call_id)
                        traj.add_step(
                            tool_name=pc["name"],
                            kwargs=pc["kwargs"],
                            observation=observation,
                            reasoning=pc.get("reasoning"),
                        )
                    else:
                        warnings.append(f"tool_result for unknown id {call_id}")
                        traj.add_step(
                            tool_name="unknown",
                            kwargs={},
                            observation=observation,
                        )

        for call_id, pc in pending_calls.items():
            warnings.append(f"tool_use {pc['name']} (id={call_id}) has no result")
            traj.add_step(
                tool_name=pc["name"],
                kwargs=pc["kwargs"],
                observation={"error": "no tool_result received"},
                reasoning=pc.get("reasoning"),
            )

        stats = {
            "total_messages": len(data),
            "tool_calls": len(traj.steps),
            "has_thinking": any(s.reasoning for s in traj.steps),
        }
        return ParseResult(
            trajectories=[traj] if traj.steps else [],
            warnings=warnings,
            stats=stats,
        )


def _parse_input(raw: str, warnings: list[str]) -> list[dict]:
    """Try JSON array first, then JSONL."""
    raw = raw.strip()
    if raw.startswith("["):
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            warnings.append(f"JSON parse error: {e}")
            return []
    messages = []
    for i, line in enumerate(raw.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            messages.append(json.loads(line))
        except json.JSONDecodeError:
            warnings.append(f"Line {i}: not valid JSON, skipped")
    return messages


REGISTRY.register(ClaudeCodeAdapter())
