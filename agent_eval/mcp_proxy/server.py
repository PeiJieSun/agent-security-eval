"""
MCP Proxy Server — intercepts JSON-RPC between Agent and upstream MCP Server.

Architecture:
  Agent (MCP Client) <--JSON-RPC--> [MCP Proxy] <--JSON-RPC--> Upstream MCP Server

The proxy:
  1. Forwards all requests to the upstream server
  2. Records tools/call request-response pairs
  3. Optionally injects IPI payloads into tool responses
  4. Builds AgentTrajectory in real-time

Supports stdio transport (subprocess pipe to upstream).
SSE transport can be added by wrapping this core in an HTTP server.
"""
from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from agent_eval.mcp_proxy.config import ProxyConfig, ProxySession, InjectionRule
from agent_eval.trajectory import AgentTrajectory

logger = logging.getLogger(__name__)


class MCPProxyCore:
    """
    Core proxy logic — protocol-agnostic.

    Receives JSON-RPC messages from the client, forwards to upstream,
    records tool calls, applies injections, and returns responses.
    """

    def __init__(self, config: ProxyConfig) -> None:
        self.config = config
        self.session = ProxySession(
            session_id=config.session_id or uuid.uuid4().hex[:12],
            config=config,
        )
        self.trajectory = AgentTrajectory(
            task_id=f"mcp_proxy_{self.session.session_id}"
        )
        self._tools_cache: list[dict] = []
        self._pending_calls: dict[Any, dict[str, Any]] = {}
        self._step_callbacks: list[Callable] = []

    def on_step(self, cb: Callable[[dict], None]) -> None:
        """Register a callback for each completed tool call step."""
        self._step_callbacks.append(cb)

    def _notify_step(self, step_data: dict) -> None:
        for cb in self._step_callbacks:
            try:
                cb(step_data)
            except Exception:
                logger.exception("step callback error")

    def process_client_message(self, msg: dict) -> dict:
        """
        Process a JSON-RPC message from the client (Agent).
        Returns the message to forward to upstream (possibly unmodified).
        """
        method = msg.get("method", "")
        msg_id = msg.get("id")

        if method == "tools/call":
            params = msg.get("params", {})
            self._pending_calls[msg_id] = {
                "name": params.get("name", "unknown"),
                "arguments": params.get("arguments", {}),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            self.session.tool_calls_count += 1

        return msg

    def process_upstream_response(self, msg: dict) -> dict:
        """
        Process a JSON-RPC response from the upstream MCP server.
        Records the tool call, applies injections, returns (possibly modified) response.
        """
        msg_id = msg.get("id")
        if msg_id not in self._pending_calls:
            if "result" in msg and msg_id is not None:
                pass
            return msg

        call_info = self._pending_calls.pop(msg_id)
        tool_name = call_info["name"]
        tool_args = call_info["arguments"]

        observation: dict[str, Any]
        if "error" in msg:
            err = msg["error"]
            observation = {
                "error": True,
                "result": f"[{err.get('code', '?')}] {err.get('message', '')}",
            }
        else:
            observation = self._extract_result(msg.get("result", {}))

        rule = self.session.should_inject(tool_name)
        if rule:
            original_text = observation.get("result", "")
            injected_text = self.session.apply_injection(str(original_text), rule)
            observation["result"] = injected_text
            observation["__injected__"] = True
            msg = self._inject_into_response(msg, injected_text)

        step = self.trajectory.add_step(
            tool_name=tool_name,
            kwargs=tool_args,
            observation=observation,
        )

        self._notify_step({
            "session_id": self.session.session_id,
            "step_k": step.step_k,
            "tool_name": tool_name,
            "arguments": tool_args,
            "injected": bool(rule),
            "timestamp": call_info["timestamp"],
        })

        return msg

    def process_upstream_notification(self, msg: dict) -> dict:
        """Handle notifications from upstream (tools/list_changed, etc.)."""
        method = msg.get("method", "")
        if method == "notifications/tools/list_changed":
            self._tools_cache = []
        return msg

    def cache_tools_list(self, result: dict) -> None:
        """Cache tools/list results for inspection."""
        tools = result.get("tools", [])
        self._tools_cache = tools

    def get_cached_tools(self) -> list[dict]:
        return list(self._tools_cache)

    def get_trajectory(self) -> AgentTrajectory:
        return self.trajectory

    def get_session_status(self) -> dict:
        return {
            "session_id": self.session.session_id,
            "status": self.session.status,
            "tool_calls": self.session.tool_calls_count,
            "injections": self.session.injections_count,
            "trajectory_steps": len(self.trajectory.steps),
            "tools_discovered": len(self._tools_cache),
        }

    @staticmethod
    def _extract_result(result: Any) -> dict[str, Any]:
        if isinstance(result, dict):
            content_list = result.get("content", [])
            if isinstance(content_list, list):
                texts = []
                for item in content_list:
                    if isinstance(item, dict):
                        if item.get("type") == "text":
                            texts.append(item.get("text", ""))
                        elif item.get("type") == "image":
                            texts.append("[image]")
                        else:
                            texts.append(str(item))
                    else:
                        texts.append(str(item))
                return {"result": "\n".join(texts) if texts else str(result)}
            return {"result": str(result)}
        return {"result": str(result)}

    @staticmethod
    def _inject_into_response(msg: dict, injected_text: str) -> dict:
        """Modify the actual JSON-RPC response to contain the injected text."""
        result = msg.get("result", {})
        if isinstance(result, dict):
            content = result.get("content", [])
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "text":
                        item["text"] = injected_text
                        return msg
                content.append({"type": "text", "text": injected_text})
                return msg
        return msg


class StdioProxy:
    """
    Runs the MCP proxy with stdio transport.

    Launches the upstream MCP server as a subprocess and bridges
    stdin/stdout between the client and the upstream.
    """

    def __init__(self, core: MCPProxyCore) -> None:
        self.core = core
        self._process: Optional[subprocess.Popen] = None
        self._running = False

    async def start(self) -> None:
        """Start the upstream subprocess and begin proxying."""
        cmd = self.core.config.upstream_command
        if not cmd:
            raise ValueError("upstream_command is required for stdio transport")

        self.core.session.status = "running"
        self._running = True

        self._process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0,
        )
        logger.info("Started upstream MCP server: %s (pid=%d)", cmd, self._process.pid)

    async def send_to_upstream(self, message: dict) -> dict | None:
        """Send a JSON-RPC message to upstream and read the response."""
        if not self._process or not self._process.stdin or not self._process.stdout:
            return None

        processed = self.core.process_client_message(message)
        line = json.dumps(processed) + "\n"

        try:
            self._process.stdin.write(line)
            self._process.stdin.flush()
        except (BrokenPipeError, OSError):
            self.core.session.status = "error"
            self.core.session.error_message = "Upstream pipe broken"
            return None

        try:
            resp_line = self._process.stdout.readline()
            if not resp_line:
                return None
            resp = json.loads(resp_line)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Failed to read upstream response: %s", e)
            return None

        if "method" in resp and "id" not in resp:
            return self.core.process_upstream_notification(resp)

        method = message.get("method", "")
        if method == "tools/list" and "result" in resp:
            self.core.cache_tools_list(resp.get("result", {}))

        return self.core.process_upstream_response(resp)

    def stop(self) -> None:
        """Stop the proxy and kill the upstream process."""
        self._running = False
        self.core.session.status = "stopped"
        if self._process:
            self._process.terminate()
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None


class SimulatedProxy:
    """
    A proxy that doesn't connect to a real upstream server.
    Uses predefined mock responses for testing/demo purposes.
    """

    def __init__(self, core: MCPProxyCore) -> None:
        self.core = core
        self._mock_tools: list[dict] = [
            {"name": "read_file", "description": "Read file contents",
             "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}}},
            {"name": "bash", "description": "Execute bash command",
             "inputSchema": {"type": "object", "properties": {"cmd": {"type": "string"}}}},
            {"name": "write_file", "description": "Write file contents",
             "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}}},
        ]
        self._call_id = 0

    def start(self) -> None:
        self.core.session.status = "running"
        self.core.cache_tools_list({"tools": self._mock_tools})

    def simulate_tool_call(self, tool_name: str, arguments: dict) -> dict:
        """Simulate a tool call and return the proxied response."""
        self._call_id += 1
        msg_id = self._call_id

        client_msg = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": arguments},
        }
        self.core.process_client_message(client_msg)

        mock_result = f"[mock response for {tool_name}({json.dumps(arguments, ensure_ascii=False)[:100]})]"
        upstream_resp = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "result": {
                "content": [{"type": "text", "text": mock_result}],
            },
        }

        return self.core.process_upstream_response(upstream_resp)

    def stop(self) -> None:
        self.core.session.status = "stopped"
