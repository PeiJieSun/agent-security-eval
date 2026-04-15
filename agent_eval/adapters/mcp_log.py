"""
MCP (Model Context Protocol) log adapter.

Parses JSON-RPC messages between an MCP client (Agent) and server (tools).
Applicable to any Agent using MCP: Claude Code (MCP mode), OpenCode, etc.

Expected input: JSONL of JSON-RPC messages, or a JSON array.
Example:
  {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"foo.py"}}}
  {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"file contents"}]}}
"""
from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from agent_eval.adapters.base import AdapterMeta, BaseAdapter, ParseResult, REGISTRY
from agent_eval.trajectory import AgentTrajectory


class MCPLogAdapter(BaseAdapter):
    def meta(self) -> AdapterMeta:
        return AdapterMeta(
            adapter_id="mcp_log",
            name="MCP 协议日志",
            description="解析 MCP JSON-RPC tools/call 请求与响应日志, 适用于所有 MCP Agent",
            supported_formats=["json", "jsonl"],
            example_snippet='{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"read_file","arguments":{"path":"foo.py"}}}',
        )

    def parse(self, raw: str, task_id: Optional[str] = None) -> ParseResult:
        warnings: list[str] = []
        messages = _parse_messages(raw, warnings)
        if not messages:
            return ParseResult(trajectories=[], warnings=warnings)

        tid = task_id or f"mcp_{uuid.uuid4().hex[:8]}"
        traj = AgentTrajectory(task_id=tid)

        requests: dict[Any, dict[str, Any]] = {}

        for msg in messages:
            if "method" in msg:
                method = msg.get("method", "")
                msg_id = msg.get("id")

                if method == "tools/call":
                    params = msg.get("params", {})
                    requests[msg_id] = {
                        "name": params.get("name", "unknown"),
                        "kwargs": params.get("arguments", {}),
                    }
                elif method == "tools/list":
                    pass  # discovery, not a tool call
                elif method.startswith("notifications/"):
                    pass
                else:
                    if msg_id is not None:
                        requests[msg_id] = {
                            "name": method,
                            "kwargs": msg.get("params", {}),
                        }

            elif "result" in msg or "error" in msg:
                msg_id = msg.get("id")
                if msg_id not in requests:
                    continue

                pc = requests.pop(msg_id)

                if "error" in msg:
                    err = msg["error"]
                    observation = {
                        "error": True,
                        "result": f"[{err.get('code', '?')}] {err.get('message', '')}",
                    }
                else:
                    result = msg.get("result", {})
                    observation = _extract_result_content(result)

                traj.add_step(
                    tool_name=pc["name"],
                    kwargs=pc["kwargs"],
                    observation=observation,
                )

        for msg_id, pc in requests.items():
            warnings.append(f"tools/call {pc['name']} (id={msg_id}) has no response")
            traj.add_step(
                tool_name=pc["name"],
                kwargs=pc["kwargs"],
                observation={"error": "no response received"},
            )

        return ParseResult(
            trajectories=[traj] if traj.steps else [],
            warnings=warnings,
            stats={
                "total_messages": len(messages),
                "tool_calls": len(traj.steps),
            },
        )


def _parse_messages(raw: str, warnings: list[str]) -> list[dict]:
    raw = raw.strip()
    if raw.startswith("["):
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            warnings.append(f"JSON array parse error: {e}")
            return []
    items = []
    for i, line in enumerate(raw.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            warnings.append(f"Line {i}: not valid JSON, skipped")
    return items


def _extract_result_content(result: Any) -> dict[str, Any]:
    """Extract readable content from MCP result payload."""
    if isinstance(result, dict):
        content_list = result.get("content", [])
        if isinstance(content_list, list):
            texts = []
            for item in content_list:
                if isinstance(item, dict):
                    if item.get("type") == "text":
                        texts.append(item.get("text", ""))
                    elif item.get("type") == "image":
                        texts.append("[image data]")
                    else:
                        texts.append(str(item))
                else:
                    texts.append(str(item))
            return {"result": "\n".join(texts) if texts else str(result)}
        return {"result": str(result)}
    return {"result": str(result)}


REGISTRY.register(MCPLogAdapter())
