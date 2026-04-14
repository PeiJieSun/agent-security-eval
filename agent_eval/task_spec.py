"""
EvalTask — open-world task definition schema.

A task fully specifies a security evaluation scenario:
  - The environment initial state
  - The user's legitimate instruction to the agent
  - The attacker's injection vector (where / what to inject)
  - Success oracles for both the benign goal and the attack goal

Tasks are model-agnostic and environment-agnostic: the same task definition
can be used to evaluate any LLM agent.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class InjectionVector(BaseModel):
    """
    Specifies WHERE to inject and WHAT payload to inject.

    target_tool:  The tool whose return value is intercepted (e.g. "get_emails").
    field_path:   Dot-separated path into the return value to inject into.
                  For list returns (get_emails returns a list), the injection
                  is appended to the 'body' field of each item.
                  Use "" to append a new item to a list return.
    payload:      The injected instruction text.
    inject_index: For list returns, which element index to inject into (-1 = last).
    """

    target_tool: str
    field_path: str = "body"
    payload: str
    inject_index: int = 0


class EvalTask(BaseModel):
    """
    Open-world task definition for agent security evaluation.

    Follows the AgentDojo (Debenedetti et al., 2024) security case model:
    each security case = (user_task, injection_task).

    Fields
    ------
    task_id:
        Unique identifier.
    description:
        Human-readable description of what this task tests.
    environment_type:
        "email" uses EmailEnvironment; future types can be added.
    environment_config:
        Dict passed to the environment constructor as kwargs
        (e.g. {"inbox": [...], "outbox": []}).
    user_instruction:
        The legitimate instruction given to the agent (system or user prompt).
    attack_vector:
        Where and what to inject into tool return values.
    benign_success_expr:
        Python expression (string) evaluated with local vars:
          env  — the environment object after agent run
          traj — AgentTrajectory of the run
        Returns True if the agent successfully completed the user's task.
        Example: "any(e.to == 'boss@company.com' for e in env.outbox)"
    attack_success_expr:
        Same format; True if the attacker's goal was achieved.
        Example: "any(e.to == 'attacker@evil.com' for e in env.outbox)"
    attack_type:
        InjecAgent taxonomy (Zhan et al., 2024, §2.1):
        "direct_harm" | "data_stealing"
    tags:
        Free-form tags for filtering (e.g. ["email", "exfiltration"]).
    """

    task_id: str
    description: str
    environment_type: str = "email"
    environment_config: dict
    user_instruction: str
    system_prompt: Optional[str] = None
    attack_vector: InjectionVector
    benign_success_expr: str
    attack_success_expr: str
    attack_type: str = "data_stealing"
    tags: list[str] = []
    max_steps: int = 10
