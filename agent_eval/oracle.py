"""
SuccessOracle — evaluates whether a goal was achieved after an agent run.

Oracles can be:
  1. Programmatic: a Python expression string evaluated against env + traj
  2. (future) LLM-judge: a second LLM evaluates the trajectory

Programmatic oracles are deterministic, reproducible, and do not require
additional LLM calls — following the principle that verification should be
cheaper than generation.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agent_eval.environments.email_env import EmailEnvironment
    from agent_eval.trajectory import AgentTrajectory


class OracleError(Exception):
    """Raised when the oracle expression fails to evaluate."""


class SuccessOracle:
    """
    Evaluates a Python expression against the final environment state
    and the agent trajectory.

    The expression has access to:
      env    — the environment object (e.g. EmailEnvironment)
      traj   — AgentTrajectory
      outbox — shorthand for env.outbox  (email environments)
      inbox  — shorthand for env.inbox   (email environments)
      steps  — shorthand for traj.steps

    Returns True/False.  Raises OracleError on expression syntax/runtime error.

    Safety note: The expression is eval()'d in a restricted namespace.
    This is appropriate for a local evaluation tool; do NOT expose expression
    evaluation to untrusted input in a networked service.
    """

    SAFE_BUILTINS = {
        "any": any,
        "all": all,
        "len": len,
        "list": list,
        "set": set,
        "dict": dict,
        "str": str,
        "int": int,
        "float": float,
        "bool": bool,
        "sum": sum,
        "min": min,
        "max": max,
        "enumerate": enumerate,
        "zip": zip,
        "filter": filter,
        "map": map,
        "sorted": sorted,
        "True": True,
        "False": False,
        "None": None,
    }

    def __init__(self, expression: str) -> None:
        self.expression = expression

    def evaluate(self, env: Any, traj: "AgentTrajectory") -> bool:
        """
        Evaluate the oracle expression.

        Parameters
        ----------
        env:
            Environment object after agent run (e.g. EmailEnvironment).
        traj:
            AgentTrajectory from the run.

        Returns
        -------
        bool: True if the goal condition is satisfied.

        Raises
        ------
        OracleError: if the expression raises or returns a non-bool.
        """
        local_ns: dict[str, Any] = {
            "env": env,
            "traj": traj,
            "steps": traj.steps,
        }
        # Convenience shortcuts for email environments
        if hasattr(env, "outbox"):
            local_ns["outbox"] = env.outbox
        if hasattr(env, "inbox"):
            local_ns["inbox"] = env.inbox

        try:
            result = eval(  # noqa: S307
                self.expression,
                {"__builtins__": self.SAFE_BUILTINS},
                local_ns,
            )
        except Exception as exc:
            raise OracleError(
                f"Oracle expression raised an error: {exc!r}\n"
                f"Expression: {self.expression!r}"
            ) from exc

        if not isinstance(result, bool):
            try:
                result = bool(result)
            except Exception as exc:
                raise OracleError(
                    f"Oracle expression returned non-bool {result!r}"
                ) from exc

        return result

    def safe_evaluate(self, env: Any, traj: "AgentTrajectory") -> tuple[bool, str | None]:
        """
        Like evaluate() but catches OracleError and returns (False, error_msg).
        Useful when a single bad oracle should not abort an entire eval run.
        """
        try:
            return self.evaluate(env, traj), None
        except OracleError as exc:
            return False, str(exc)

    def __repr__(self) -> str:
        return f"SuccessOracle({self.expression!r})"
