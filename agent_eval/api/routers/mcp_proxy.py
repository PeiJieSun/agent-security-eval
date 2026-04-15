"""
MCP Proxy API — manage proxy sessions, view real-time status, trigger simulations.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from agent_eval.mcp_proxy.config import ProxyConfig, InjectionRule
from agent_eval.mcp_proxy.server import MCPProxyCore, SimulatedProxy
from agent_eval.storage.sqlite_store import SqliteStore

router = APIRouter(prefix="/api/v1/agent-eval/mcp-proxy")
_store = SqliteStore()

_sessions: dict[str, dict] = {}


class CreateSessionRequest(BaseModel):
    transport: str = "simulated"  # "stdio" | "sse" | "simulated"
    upstream_command: list[str] = Field(default_factory=list)
    upstream_url: Optional[str] = None
    injection_rules: list[InjectionRule] = Field(default_factory=list)


class SimulateCallRequest(BaseModel):
    tool_name: str
    arguments: dict = Field(default_factory=dict)


@router.get("/sessions")
def list_sessions():
    """List all proxy sessions."""
    return [
        {
            "session_id": sid,
            **s["core"].get_session_status(),
        }
        for sid, s in _sessions.items()
    ]


@router.post("/sessions")
def create_session(req: CreateSessionRequest):
    """Create and start a new proxy session."""
    sid = uuid.uuid4().hex[:12]
    config = ProxyConfig(
        session_id=sid,
        upstream_command=req.upstream_command,
        upstream_url=req.upstream_url,
        transport=req.transport,
        injection_rules=req.injection_rules,
    )
    core = MCPProxyCore(config)

    if req.transport == "simulated":
        proxy = SimulatedProxy(core)
        proxy.start()
        _sessions[sid] = {"core": core, "proxy": proxy, "type": "simulated"}
    else:
        raise HTTPException(501, f"Transport '{req.transport}' not yet implemented server-side. Use 'simulated' for demo.")

    return core.get_session_status()


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    """Get session status and statistics."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session {session_id} not found")
    return _sessions[session_id]["core"].get_session_status()


@router.post("/sessions/{session_id}/stop")
def stop_session(session_id: str):
    """Stop a running proxy session and save its trajectory."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session {session_id} not found")

    s = _sessions[session_id]
    s["proxy"].stop()

    traj = s["core"].get_trajectory()
    if traj.steps:
        run_id = traj.task_id
        _store.save_trajectory(run_id, traj.to_yaml())

    return {
        **s["core"].get_session_status(),
        "trajectory_saved": bool(traj.steps),
        "trajectory_run_id": traj.task_id if traj.steps else None,
    }


@router.post("/sessions/{session_id}/simulate")
def simulate_call(session_id: str, req: SimulateCallRequest):
    """Simulate a tool call through the proxy (simulated mode only)."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session {session_id} not found")

    s = _sessions[session_id]
    if s["type"] != "simulated":
        raise HTTPException(400, "simulate is only available for simulated sessions")

    proxy: SimulatedProxy = s["proxy"]
    response = proxy.simulate_tool_call(req.tool_name, req.arguments)

    return {
        "response": response,
        "status": s["core"].get_session_status(),
    }


@router.get("/sessions/{session_id}/trajectory")
def get_session_trajectory(session_id: str):
    """Get the live trajectory built during this session."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session {session_id} not found")

    traj = _sessions[session_id]["core"].get_trajectory()
    return traj.to_dict()


@router.get("/sessions/{session_id}/tools")
def get_discovered_tools(session_id: str):
    """Get the MCP tools discovered by this proxy session."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session {session_id} not found")

    return _sessions[session_id]["core"].get_cached_tools()


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    """Delete a stopped session."""
    if session_id not in _sessions:
        raise HTTPException(404, f"Session {session_id} not found")

    s = _sessions[session_id]
    if s["core"].session.status == "running":
        s["proxy"].stop()

    del _sessions[session_id]
    return {"deleted": session_id}


@router.get("/agent-config-snippet")
def get_agent_config_snippet(
    transport: str = "stdio",
    proxy_port: int = 18210,
    agent_type: str = "claude_code",
):
    """
    Generate a configuration snippet for connecting an Agent to our proxy.
    """
    snippets = {
        "claude_code": {
            "title": "Claude Code MCP 配置",
            "description": "在 Claude Code 的 MCP 配置中将 server 指向我们的代理",
            "config": {
                "mcpServers": {
                    "security-proxy": {
                        "command": "npx",
                        "args": ["-y", "@anthropic/mcp-proxy", f"http://localhost:{proxy_port}/sse"],
                    }
                }
            },
            "instructions": [
                f"1. 启动 MCP 安全代理 (端口 {proxy_port})",
                "2. 将上述配置添加到 Claude Code 的 .mcp.json",
                "3. 代理将透明记录所有工具调用并可注入攻击载荷",
            ],
        },
        "codex": {
            "title": "Codex CLI MCP 配置",
            "description": "配置 Codex 使用代理 MCP 服务器",
            "config": {
                "mcp_servers": {
                    "security-proxy": {
                        "type": "sse",
                        "url": f"http://localhost:{proxy_port}/sse",
                    }
                }
            },
            "instructions": [
                f"1. 启动 MCP 安全代理 (端口 {proxy_port})",
                "2. 在 Codex 配置中添加上述 MCP server",
                "3. 所有工具调用将被透明记录",
            ],
        },
        "generic": {
            "title": "通用 MCP Agent 配置",
            "description": "任何支持 MCP 协议的 Agent 均可接入",
            "config": {
                "server_url": f"http://localhost:{proxy_port}/sse",
                "transport": "sse",
            },
            "instructions": [
                f"1. 启动 MCP 安全代理 (端口 {proxy_port})",
                "2. 将 Agent 的 MCP server 地址指向代理 URL",
                "3. 代理透明转发所有请求到真实 MCP server, 同时记录轨迹",
            ],
        },
    }

    return snippets.get(agent_type, snippets["generic"])
