"""
Core abstractions for stateful task environments.

Design mirrors AgentDojo's TaskEnvironment:
  - Environments expose tools and maintain mutable state.
  - snapshot() captures pre/post state as a flat FieldSnapshot list.
  - diff(pre, post) produces a deterministic change set — no LLM needed.
"""
from __future__ import annotations

import hashlib
from abc import ABC, abstractmethod
from typing import Any, Optional

import yaml
from pydantic import BaseModel


class FieldSnapshot(BaseModel):
    """A single named field captured from environment state."""

    path: str
    value: Any
    hash: str

    @classmethod
    def from_value(cls, path: str, value: Any) -> "FieldSnapshot":
        h = hashlib.md5(str(value).encode()).hexdigest()
        return cls(path=path, value=value, hash=h)


class EnvironmentState(BaseModel):
    """Flat snapshot of all environment fields at a point in time."""

    fields: list[FieldSnapshot] = []

    def get(self, path: str) -> Optional[FieldSnapshot]:
        for f in self.fields:
            if f.path == path:
                return f
        return None

    def as_dict(self) -> dict[str, Any]:
        return {f.path: f.value for f in self.fields}


class StateDiff(BaseModel):
    added: list[str] = []
    removed: list[str] = []
    modified: list[str] = []


class AgentTaskEnvironment(ABC):
    """
    Base class for all stateful evaluation environments.

    Subclasses must implement:
      - snapshot() → EnvironmentState
      - reset()    → None  (restore to initial state)

    The pre/post snapshot pair drives deterministic utility and security scoring,
    following the AgentDojo pattern.
    """

    @abstractmethod
    def snapshot(self) -> EnvironmentState:
        """Capture the current state as a flat field list."""

    @abstractmethod
    def reset(self) -> None:
        """Restore environment to its initial state."""

    @staticmethod
    def diff(pre: EnvironmentState, post: EnvironmentState) -> StateDiff:
        """
        Deterministic diff between two snapshots.
        Returns which field paths were added, removed, or modified.
        """
        pre_map = {f.path: f.hash for f in pre.fields}
        post_map = {f.path: f.hash for f in post.fields}

        added = [p for p in post_map if p not in pre_map]
        removed = [p for p in pre_map if p not in post_map]
        modified = [
            p for p in pre_map
            if p in post_map and pre_map[p] != post_map[p]
        ]
        return StateDiff(added=added, removed=removed, modified=modified)


# ── YAML serialisation ────────────────────────────────────────────────────

def dump_env(env: EnvironmentState) -> str:
    """Serialise an EnvironmentState to a YAML string."""
    data = [{"path": f.path, "value": f.value, "hash": f.hash} for f in env.fields]
    return yaml.dump({"fields": data}, allow_unicode=True, sort_keys=False)


def load_env(yaml_str: str) -> EnvironmentState:
    """Deserialise an EnvironmentState from a YAML string produced by dump_env."""
    raw = yaml.safe_load(yaml_str)
    fields = [
        FieldSnapshot(path=item["path"], value=item["value"], hash=item["hash"])
        for item in (raw.get("fields") or [])
    ]
    return EnvironmentState(fields=fields)
