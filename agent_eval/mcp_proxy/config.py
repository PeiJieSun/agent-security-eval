"""
MCP Proxy configuration and injection rules.
"""
from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


class InjectionRule(BaseModel):
    """Defines when and what to inject into a tool's response."""
    tool_name: str
    payload: str
    inject_on_call: int = 1  # Nth invocation (0 = every call)
    prepend: bool = False    # prepend vs append vs replace


class ProxyConfig(BaseModel):
    """Configuration for a running MCP proxy session."""
    session_id: str = ""
    upstream_command: list[str] = Field(default_factory=list)
    upstream_url: Optional[str] = None       # SSE upstream
    listen_port: int = 18210                 # SSE listen port for the proxy
    transport: str = "stdio"                 # "stdio" | "sse"
    injection_rules: list[InjectionRule] = Field(default_factory=list)
    record_trajectory: bool = True
    max_steps: int = 200


class ProxySession(BaseModel):
    """Runtime state of one proxy session."""
    session_id: str
    config: ProxyConfig
    status: str = "idle"                     # idle | running | stopped | error
    tool_calls_count: int = 0
    injections_count: int = 0
    error_message: Optional[str] = None
    trajectory_run_id: Optional[str] = None

    # per-tool call counters for injection scheduling
    _call_counters: dict[str, int] = {}

    def model_post_init(self, __context: Any) -> None:
        object.__setattr__(self, "_call_counters", {})

    def should_inject(self, tool_name: str) -> Optional[InjectionRule]:
        """Check if any injection rule fires for this tool call."""
        for rule in self.config.injection_rules:
            if rule.tool_name == tool_name or rule.tool_name == "*":
                counter = self._call_counters.get(tool_name, 0) + 1
                self._call_counters[tool_name] = counter
                if rule.inject_on_call == 0:
                    return rule
                if counter == rule.inject_on_call:
                    return rule
        return None

    def apply_injection(self, original: str, rule: InjectionRule) -> str:
        """Apply an injection rule to a tool response."""
        self.injections_count += 1
        if rule.prepend:
            return rule.payload + "\n" + original
        return original + "\n" + rule.payload
