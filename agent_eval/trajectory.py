"""
Trajectory recording for agent evaluation.

A trajectory captures the full sequence of reasoning + tool calls an agent
makes while attempting a task.  Each call_tool() invocation on a
FunctionsRuntime that has an attached AgentTrajectory appends one step.

Design follows AgentDojo's Trajectory concept:
  step_k  – 1-indexed position in the call sequence
  reasoning – agent's scratchpad / chain-of-thought (optional)
  tool_call – {"name": ..., "kwargs": {...}}
  observation – the dict returned by the tool
"""
from __future__ import annotations

import json
from typing import Any, Optional

import yaml
from pydantic import BaseModel, Field


class TrajectoryStep(BaseModel):
    step_k: int
    reasoning: Optional[str] = None
    tool_call: dict[str, Any] = Field(default_factory=dict)
    observation: dict[str, Any] = Field(default_factory=dict)


class AgentTrajectory(BaseModel):
    task_id: str
    steps: list[TrajectoryStep] = Field(default_factory=list)
    final_output: Optional[str] = None

    # ── Mutation helpers ──────────────────────────────────────────────────

    def add_step(
        self,
        tool_name: str,
        kwargs: dict[str, Any],
        observation: dict[str, Any],
        reasoning: Optional[str] = None,
    ) -> TrajectoryStep:
        step = TrajectoryStep(
            step_k=len(self.steps) + 1,
            reasoning=reasoning,
            tool_call={"name": tool_name, "kwargs": kwargs},
            observation=observation,
        )
        self.steps.append(step)
        return step

    # ── Serialisation ─────────────────────────────────────────────────────

    def to_yaml(self) -> str:
        data = {
            "task_id": self.task_id,
            "final_output": self.final_output,
            "steps": [
                {
                    "step_k": s.step_k,
                    "reasoning": s.reasoning,
                    "tool_call": s.tool_call,
                    "observation": s.observation,
                }
                for s in self.steps
            ],
        }
        return yaml.dump(data, allow_unicode=True, sort_keys=False)

    def to_dict(self) -> dict[str, Any]:
        return json.loads(self.model_dump_json())

    @classmethod
    def from_yaml(cls, yaml_str: str) -> "AgentTrajectory":
        raw = yaml.safe_load(yaml_str)
        steps = [TrajectoryStep(**s) for s in (raw.get("steps") or [])]
        return cls(
            task_id=raw["task_id"],
            steps=steps,
            final_output=raw.get("final_output"),
        )
