"""
M4-4: MCP Security Evaluation API endpoints.

Exposes MCP poisoning scenarios and evaluation results.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from agent_eval.mcp_security import (
    MCPEvalResult,
    MCPEvalRunner,
    MCPPoisoningScenario,
    MCP_SCENARIOS,
    MCP_SCENARIOS_BY_ID,
)
from agent_eval.storage.sqlite_store import SqliteStore

router = APIRouter(prefix="/api/v1/mcp-eval")
_store = SqliteStore()


# ── Schemas ───────────────────────────────────────────────────────────────────

class RunMCPRequest(BaseModel):
    scenario_ids: Optional[list[str]] = None  # None → all scenarios
    model: str = "gpt-4o-mini"
    api_key: str
    base_url: str = "https://api.openai.com/v1"


class MCPRunStatus(BaseModel):
    run_id: str
    status: str  # "pending" | "running" | "done" | "error"
    total: int
    done: int
    results: list[dict] = []
    created_at: str = ""
    error: Optional[str] = None


# In-memory run tracking (sufficient for eval use; no persistence needed for runs)
_mcp_runs: dict[str, MCPRunStatus] = {}


# ── Scenario endpoints ────────────────────────────────────────────────────────

@router.get("/scenarios")
def list_scenarios() -> list[dict]:
    """List all MCP poisoning scenarios."""
    return [
        {
            "scenario_id": s.scenario_id,
            "name": s.name,
            "description": s.description,
            "attack_type": s.attack_type,
            "server_count": len(s.servers),
            "tool_count": sum(len(srv.tools) for srv in s.servers),
            "poisoned_tools": sum(
                1 for srv in s.servers for t in srv.tools if t.is_poisoned
            ),
            "user_instruction": s.user_instruction,
            "benign_action": s.benign_action,
            "attack_goal": s.attack_goal,
            "source_citation": s.source_citation,
        }
        for s in MCP_SCENARIOS
    ]


@router.get("/scenarios/{scenario_id}")
def get_scenario(scenario_id: str) -> dict:
    """Get full scenario definition."""
    if scenario_id not in MCP_SCENARIOS_BY_ID:
        raise HTTPException(status_code=404, detail=f"scenario {scenario_id!r} not found")
    s = MCP_SCENARIOS_BY_ID[scenario_id]
    return s.model_dump()


# ── Evaluation run endpoints ──────────────────────────────────────────────────

@router.post("/runs")
def create_mcp_run(req: RunMCPRequest, background_tasks: BackgroundTasks) -> dict:
    """Start an async MCP security evaluation run."""
    run_id = str(uuid.uuid4())[:8]
    scenario_ids = req.scenario_ids or [s.scenario_id for s in MCP_SCENARIOS]
    status = MCPRunStatus(
        run_id=run_id,
        status="pending",
        total=len(scenario_ids),
        done=0,
        created_at=datetime.now(timezone.utc).isoformat(),
    )
    _mcp_runs[run_id] = status
    background_tasks.add_task(
        _run_mcp_background,
        run_id=run_id,
        scenario_ids=scenario_ids,
        model=req.model,
        api_key=req.api_key,
        base_url=req.base_url,
    )
    return {"run_id": run_id, "status": "pending", "total": len(scenario_ids)}


@router.get("/runs")
def list_mcp_runs() -> list[dict]:
    """List recent MCP evaluation runs."""
    return [r.model_dump() for r in sorted(_mcp_runs.values(), key=lambda r: r.created_at, reverse=True)]


@router.get("/runs/{run_id}")
def get_mcp_run(run_id: str) -> dict:
    """Get status and results of a specific MCP evaluation run."""
    if run_id not in _mcp_runs:
        raise HTTPException(status_code=404, detail=f"run {run_id!r} not found")
    return _mcp_runs[run_id].model_dump()


# ── Background task ───────────────────────────────────────────────────────────

def _run_mcp_background(
    run_id: str,
    scenario_ids: list[str],
    model: str,
    api_key: str,
    base_url: str,
) -> None:
    status = _mcp_runs[run_id]
    status.status = "running"

    runner = MCPEvalRunner(api_key=api_key, base_url=base_url, model=model)

    async def _run() -> None:
        for sid in scenario_ids:
            if sid not in MCP_SCENARIOS_BY_ID:
                continue
            scenario = MCP_SCENARIOS_BY_ID[sid]
            result = await runner.run_scenario(scenario)
            status.results.append(result.model_dump())
            status.done += 1

    try:
        asyncio.run(_run())
        status.status = "done"
    except Exception as e:
        status.status = "error"
        status.error = str(e)
