"""
Base class and registry for trajectory adapters.

Each adapter converts a vendor-specific log format into the internal
AgentTrajectory used by all analysis engines (taint, call-graph, formal).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Optional

from pydantic import BaseModel

from agent_eval.trajectory import AgentTrajectory


class AdapterMeta(BaseModel):
    """Metadata about an adapter for UI display."""
    adapter_id: str
    name: str
    description: str
    supported_formats: list[str]  # e.g. ["json", "jsonl", "yaml"]
    example_snippet: str = ""


class ParseResult(BaseModel):
    """Result of parsing external logs."""
    trajectories: list[AgentTrajectory]
    warnings: list[str] = []
    stats: dict[str, Any] = {}


class BaseAdapter(ABC):
    """Abstract base for all trajectory adapters."""

    @abstractmethod
    def meta(self) -> AdapterMeta:
        """Return adapter metadata for registry/UI."""

    @abstractmethod
    def parse(self, raw: str, task_id: Optional[str] = None) -> ParseResult:
        """
        Parse raw log text into one or more AgentTrajectory objects.

        Args:
            raw: The raw log content (JSON, JSONL, YAML, etc.)
            task_id: Optional override for the trajectory task_id.
                     If None, adapter should infer or generate one.
        Returns:
            ParseResult with trajectories and any parse warnings.
        """


class AdapterRegistry:
    """Singleton registry of available adapters."""

    def __init__(self) -> None:
        self._adapters: dict[str, BaseAdapter] = {}

    def register(self, adapter: BaseAdapter) -> None:
        m = adapter.meta()
        self._adapters[m.adapter_id] = adapter

    def get(self, adapter_id: str) -> Optional[BaseAdapter]:
        return self._adapters.get(adapter_id)

    def list_all(self) -> list[AdapterMeta]:
        return [a.meta() for a in self._adapters.values()]


REGISTRY = AdapterRegistry()
