"""
System-level sandbox behavior monitor (R7 — Backlog).

Captures file system operations, network requests, and process creation
from an Agent running inside a Docker container, converting them into
standard AgentTrajectory steps.

Status: SKELETON — the actual seccomp/ptrace/eBPF integration is future work.
Currently provides a Docker-log-based monitor that watches container output.
"""
from __future__ import annotations

import json
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from pydantic import BaseModel, Field

from agent_eval.trajectory import AgentTrajectory


class SyscallEvent(BaseModel):
    """A captured system-level event from the sandbox."""
    timestamp: str
    event_type: str    # "file_read" | "file_write" | "network" | "process" | "tool_call"
    target: str        # path, URL, command, or tool name
    details: dict[str, Any] = Field(default_factory=dict)


class SandboxMonitorConfig(BaseModel):
    container_name: str = ""
    image: str = "python:3.11-slim"
    command: list[str] = Field(default_factory=list)
    network_disabled: bool = True
    max_events: int = 500
    timeout_seconds: int = 300


class SandboxMonitor:
    """
    Monitor an Agent running in a Docker container.

    Current implementation: parse Docker container logs for structured events.
    Future: integrate seccomp-bpf or eBPF tracing for syscall-level capture.
    """

    def __init__(self, config: SandboxMonitorConfig) -> None:
        self.config = config
        self.events: list[SyscallEvent] = []
        self.trajectory = AgentTrajectory(
            task_id=f"sandbox_{uuid.uuid4().hex[:8]}"
        )
        self._container_id: Optional[str] = None
        self._running = False
        self._callbacks: list[Callable[[SyscallEvent], None]] = []

    def on_event(self, cb: Callable[[SyscallEvent], None]) -> None:
        self._callbacks.append(cb)

    def events_to_trajectory(self) -> AgentTrajectory:
        """Convert captured events into an AgentTrajectory for analysis."""
        traj = AgentTrajectory(task_id=self.trajectory.task_id)
        for ev in self.events:
            traj.add_step(
                tool_name=ev.event_type,
                kwargs={"target": ev.target, **ev.details},
                observation={"result": f"[{ev.event_type}] {ev.target}"},
            )
        return traj

    def parse_log_line(self, line: str) -> Optional[SyscallEvent]:
        """
        Parse a structured log line from the container.

        The container agent should output JSON lines with:
          {"event": "file_read", "target": "/app/data.txt", ...}
        """
        line = line.strip()
        if not line:
            return None
        try:
            data = json.loads(line)
            if "event" in data or "event_type" in data:
                ev = SyscallEvent(
                    timestamp=data.get("timestamp", datetime.now(timezone.utc).isoformat()),
                    event_type=data.get("event_type", data.get("event", "unknown")),
                    target=data.get("target", ""),
                    details={k: v for k, v in data.items() if k not in ("event", "event_type", "target", "timestamp")},
                )
                self.events.append(ev)
                for cb in self._callbacks:
                    try:
                        cb(ev)
                    except Exception:
                        pass
                return ev
        except json.JSONDecodeError:
            pass
        return None

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "container_id": self._container_id,
            "events_captured": len(self.events),
            "event_types": list({e.event_type for e in self.events}),
        }
