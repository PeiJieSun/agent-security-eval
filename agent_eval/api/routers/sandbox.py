"""
M5-1: Docker Sandbox API endpoints.

Provides scenario management and run execution for sandboxed agent evaluation.
Runs in mock mode by default; set DOCKER_AVAILABLE=true for real Docker execution.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from agent_eval.docker_sandbox import (
    SANDBOX_SCENARIOS,
    SANDBOX_SCENARIOS_BY_ID,
    DockerSandboxRunner,
    DockerSandboxSpec,
    SandboxRunResult,
    AgentFramework,
)

router = APIRouter(prefix="/api/v1/sandbox")


# ── In-memory run store ───────────────────────────────────────────────────────

class SandboxRun(BaseModel):
    run_id: str
    spec_ids: list[str]
    status: str  # "pending" | "running" | "done" | "error"
    total: int
    done: int
    results: list[dict] = []
    created_at: str = ""
    model: str = ""
    use_docker: bool = False


_sandbox_runs: dict[str, SandboxRun] = {}


# ── Request schemas ───────────────────────────────────────────────────────────

class RunSandboxRequest(BaseModel):
    spec_ids: Optional[list[str]] = None  # None → all scenarios
    model: str = "gpt-4o-mini"
    api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    use_docker: bool = False


# ── Scenario endpoints ────────────────────────────────────────────────────────

@router.get("/scenarios")
def list_scenarios() -> list[dict]:
    """List all sandbox evaluation scenarios."""
    return [
        {
            "spec_id": s.spec_id,
            "name": s.name,
            "description": s.description,
            "framework": s.framework.value,
            "tool_count": len(s.tools),
            "injectable_tools": sum(1 for t in s.tools if t.inject_payload),
            "attack_type": s.attack_type,
            "user_instruction": s.user_instruction,
            "benign_success_check": s.benign_success_check,
            "attack_success_check": s.attack_success_check,
            "timeout_sec": s.timeout_sec,
            "network_disabled": s.network_disabled,
            "tags": s.tags,
        }
        for s in SANDBOX_SCENARIOS
    ]


@router.get("/scenarios/{spec_id}")
def get_scenario(spec_id: str) -> dict:
    if spec_id not in SANDBOX_SCENARIOS_BY_ID:
        raise HTTPException(status_code=404, detail=f"scenario {spec_id!r} not found")
    return SANDBOX_SCENARIOS_BY_ID[spec_id].model_dump()


@router.get("/frameworks")
def list_frameworks() -> list[dict]:
    """List supported agent frameworks."""
    return [
        {"id": f.value, "name": f.value.replace("_", " ").title()}
        for f in AgentFramework
    ]


# ── Run endpoints ─────────────────────────────────────────────────────────────

@router.post("/runs", status_code=202)
def create_sandbox_run(req: RunSandboxRequest, background_tasks: BackgroundTasks) -> dict:
    """Start a sandbox evaluation run (mock or real Docker)."""
    spec_ids = req.spec_ids or [s.spec_id for s in SANDBOX_SCENARIOS]
    run_id = "sb_" + str(uuid.uuid4())[:8]
    run = SandboxRun(
        run_id=run_id,
        spec_ids=spec_ids,
        status="pending",
        total=len(spec_ids),
        done=0,
        created_at=datetime.now(timezone.utc).isoformat(),
        model=req.model,
        use_docker=req.use_docker,
    )
    _sandbox_runs[run_id] = run
    background_tasks.add_task(
        _run_sandbox_background,
        run_id=run_id,
        spec_ids=spec_ids,
        model=req.model,
        api_key=req.api_key,
        base_url=req.base_url,
        use_docker=req.use_docker,
    )
    return run.model_dump()


@router.get("/runs")
def list_runs() -> list[dict]:
    return [r.model_dump() for r in sorted(
        _sandbox_runs.values(), key=lambda r: r.created_at, reverse=True
    )]


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    if run_id not in _sandbox_runs:
        raise HTTPException(status_code=404, detail=f"run {run_id!r} not found")
    return _sandbox_runs[run_id].model_dump()


# ── Background task ───────────────────────────────────────────────────────────

def _run_sandbox_background(
    run_id: str,
    spec_ids: list[str],
    model: str,
    api_key: str,
    base_url: str,
    use_docker: bool,
) -> None:
    run = _sandbox_runs[run_id]
    run.status = "running"

    runner = DockerSandboxRunner(
        api_key=api_key,
        base_url=base_url,
        model=model,
        use_docker=use_docker,
    )

    for sid in spec_ids:
        spec = SANDBOX_SCENARIOS_BY_ID.get(sid)
        if not spec:
            continue
        result: SandboxRunResult = runner.run(spec)
        run.results.append(result.model_dump())
        run.done += 1

    run.status = "done"
