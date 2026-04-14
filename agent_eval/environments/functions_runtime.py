"""
FunctionsRuntime — tool registry and execution engine.

Provides the bridge between an agent's tool-call requests and the
environment methods that mutate state and return observations.

Usage
-----
    runtime = FunctionsRuntime()
    runtime.register_tool("send_email", env.send_email)
    runtime.register_tool("get_emails", env.get_emails)

    obs = runtime.call_tool("send_email", to="bob@example.com",
                            subject="Hi", body="Hello")
    # obs == {"status": "ok", "sent_id": "...", ...}

Trajectory recording
--------------------
    from agent_eval.trajectory import AgentTrajectory

    traj = AgentTrajectory(task_id="my-task")
    runtime.trajectory = traj
    runtime.call_tool(...)  # each call appends a TrajectoryStep automatically
"""
from __future__ import annotations

import traceback
from typing import TYPE_CHECKING, Any, Callable, Optional

if TYPE_CHECKING:
    from agent_eval.trajectory import AgentTrajectory


class ToolNotFoundError(Exception):
    pass


class FunctionsRuntime:
    """
    Lightweight tool registry + synchronous call dispatcher.

    All registered tools are plain callables.  call_tool() wraps execution
    in a try/except so errors are returned as observations rather than
    raised — matching how real agent frameworks surface tool failures.

    If a trajectory is attached (runtime.trajectory = AgentTrajectory(...)),
    every call_tool() automatically appends a TrajectoryStep, including the
    tool name, kwargs, and returned observation.
    """

    def __init__(self, trajectory: Optional["AgentTrajectory"] = None) -> None:
        self.registry: dict[str, Callable] = {}
        self.trajectory: Optional["AgentTrajectory"] = trajectory

    # ── Registration ──────────────────────────────────────────────────────

    def register_tool(self, name: str, fn: Callable) -> None:
        """Register a callable under the given tool name."""
        self.registry[name] = fn

    def register_env(self, env: Any, tools: list[str]) -> None:
        """
        Bulk-register a list of method names from an environment object.

            runtime.register_env(email_env, ["send_email", "get_emails", "delete_email"])
        """
        for name in tools:
            self.register_tool(name, getattr(env, name))

    # ── Execution ─────────────────────────────────────────────────────────

    def call_tool(
        self,
        name: str,
        reasoning: Optional[str] = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """
        Execute a registered tool and return its observation dict.

        Parameters
        ----------
        name:
            Registered tool name.
        reasoning:
            Optional agent scratchpad text for this step (stored in trajectory).
        **kwargs:
            Arguments forwarded to the tool callable.

        Returns
        -------
        dict with at least:
          - "status": "ok" | "error"
          - "result": tool return value (on success)
          - "error": traceback string (on failure)
          - "tool": tool name
        """
        if name not in self.registry:
            obs = {
                "status": "error",
                "tool": name,
                "error": f"Tool {name!r} is not registered.",
            }
            self._record(name, kwargs, obs, reasoning)
            return obs

        try:
            result = self.registry[name](**kwargs)
            if isinstance(result, dict):
                obs = {"tool": name, **result}
            else:
                obs = {"status": "ok", "tool": name, "result": result}
        except Exception:
            obs = {
                "status": "error",
                "tool": name,
                "error": traceback.format_exc(),
            }

        self._record(name, kwargs, obs, reasoning)
        return obs

    def available_tools(self) -> list[str]:
        return sorted(self.registry.keys())

    # ── Internal ──────────────────────────────────────────────────────────

    def _record(
        self,
        tool_name: str,
        kwargs: dict[str, Any],
        observation: dict[str, Any],
        reasoning: Optional[str],
    ) -> None:
        if self.trajectory is not None:
            self.trajectory.add_step(
                tool_name=tool_name,
                kwargs=kwargs,
                observation=observation,
                reasoning=reasoning,
            )
