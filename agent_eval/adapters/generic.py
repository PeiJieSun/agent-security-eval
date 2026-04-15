"""
Generic adapter — minimal JSON/YAML trajectory format.

Accepts a simple array of steps, each with tool_name/arguments/observation.
This is the fallback for any Agent that doesn't match a specific adapter.

Expected input (JSON array):
  [
    {
      "tool_name": "read_file",
      "arguments": {"path": "foo.py"},
      "observation": "file contents...",
      "reasoning": "I need to read foo.py"    // optional
    },
    ...
  ]

Or a YAML document with the same structure.
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

import yaml

from agent_eval.adapters.base import AdapterMeta, BaseAdapter, ParseResult, REGISTRY
from agent_eval.trajectory import AgentTrajectory


class GenericAdapter(BaseAdapter):
    def meta(self) -> AdapterMeta:
        return AdapterMeta(
            adapter_id="generic",
            name="通用 JSON/YAML",
            description="最简轨迹格式: 数组, 每项含 tool_name / arguments / observation",
            supported_formats=["json", "jsonl", "yaml"],
            example_snippet='[{"tool_name":"bash","arguments":{"cmd":"ls"},"observation":"file1.py"}]',
        )

    def parse(self, raw: str, task_id: Optional[str] = None) -> ParseResult:
        warnings: list[str] = []
        steps_data = _load_steps(raw, warnings)
        if not steps_data:
            return ParseResult(trajectories=[], warnings=warnings)

        tid = task_id or f"generic_{uuid.uuid4().hex[:8]}"
        traj = AgentTrajectory(task_id=tid)

        for i, step in enumerate(steps_data):
            if not isinstance(step, dict):
                warnings.append(f"Step {i}: not a dict, skipped")
                continue

            name = step.get("tool_name") or step.get("name") or step.get("tool") or "unknown"
            args = step.get("arguments") or step.get("kwargs") or step.get("args") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {"raw": args}

            obs_raw = step.get("observation") or step.get("result") or step.get("output") or ""
            if isinstance(obs_raw, str):
                observation = {"result": obs_raw}
            elif isinstance(obs_raw, dict):
                observation = obs_raw
            else:
                observation = {"result": str(obs_raw)}

            reasoning = step.get("reasoning") or step.get("thinking") or None

            traj.add_step(
                tool_name=str(name),
                kwargs=args if isinstance(args, dict) else {},
                observation=observation,
                reasoning=reasoning,
            )

        return ParseResult(
            trajectories=[traj] if traj.steps else [],
            warnings=warnings,
            stats={"tool_calls": len(traj.steps)},
        )


def _load_steps(raw: str, warnings: list[str]) -> list[Any]:
    raw = raw.strip()

    if raw.startswith("[") or raw.startswith("{"):
        try:
            data = json.loads(raw)
            if isinstance(data, list):
                return data
            if isinstance(data, dict) and "steps" in data:
                return data["steps"]
            return [data]
        except json.JSONDecodeError:
            pass

    try:
        data = yaml.safe_load(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "steps" in data:
            return data["steps"]
        warnings.append("YAML parsed but not a list or {steps: [...]}")
        return []
    except yaml.YAMLError:
        pass

    items = []
    for i, line in enumerate(raw.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            warnings.append(f"Line {i}: not valid JSON/YAML, skipped")
    return items


REGISTRY.register(GenericAdapter())
