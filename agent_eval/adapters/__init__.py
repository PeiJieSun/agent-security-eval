"""
Trajectory adapters — convert external agent log formats to AgentTrajectory.

Supported formats:
  - claude_code: Anthropic Messages API (tool_use / tool_result)
  - codex:       OpenAI Chat Completions + Responses API (function_call / tool_calls)
  - mcp_log:     MCP JSON-RPC tools/call request/response logs
  - generic:     Minimal JSON with {tool_name, arguments, observation} steps
"""
from agent_eval.adapters.base import BaseAdapter, AdapterRegistry, REGISTRY
from agent_eval.adapters.claude_code import ClaudeCodeAdapter
from agent_eval.adapters.codex import CodexAdapter
from agent_eval.adapters.mcp_log import MCPLogAdapter
from agent_eval.adapters.generic import GenericAdapter

__all__ = [
    "BaseAdapter",
    "AdapterRegistry",
    "REGISTRY",
    "ClaudeCodeAdapter",
    "CodexAdapter",
    "MCPLogAdapter",
    "GenericAdapter",
]
