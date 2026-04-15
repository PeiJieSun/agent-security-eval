"""
Trajectory Import API — ingest external agent logs via adapters.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from agent_eval.adapters import REGISTRY
from agent_eval.storage.sqlite_store import SqliteStore

router = APIRouter(prefix="/api/v1/agent-eval")
_store = SqliteStore()


class ImportRequest(BaseModel):
    adapter_id: str
    raw: str
    task_id: Optional[str] = None


class ImportResult(BaseModel):
    imported: int
    run_ids: list[str]
    warnings: list[str]
    stats: dict


@router.get("/adapters")
def list_adapters():
    """List all available trajectory adapters."""
    return [m.model_dump() for m in REGISTRY.list_all()]


@router.post("/import-trajectory", response_model=ImportResult)
def import_trajectory(req: ImportRequest):
    """Parse external agent logs and import as internal trajectories."""
    adapter = REGISTRY.get(req.adapter_id)
    if not adapter:
        available = [m.adapter_id for m in REGISTRY.list_all()]
        raise HTTPException(404, f"Adapter '{req.adapter_id}' not found. Available: {available}")

    result = adapter.parse(req.raw, task_id=req.task_id)

    run_ids: list[str] = []
    for traj in result.trajectories:
        run_id = traj.task_id
        _store.save_trajectory(run_id, traj.to_yaml())
        run_ids.append(run_id)

    return ImportResult(
        imported=len(result.trajectories),
        run_ids=run_ids,
        warnings=result.warnings,
        stats=result.stats,
    )


@router.post("/import-trajectory/upload", response_model=ImportResult)
async def import_trajectory_upload(
    file: UploadFile = File(...),
    adapter_id: str = Form(...),
    task_id: Optional[str] = Form(None),
):
    """Upload a file and import its trajectories."""
    adapter = REGISTRY.get(adapter_id)
    if not adapter:
        raise HTTPException(404, f"Adapter '{adapter_id}' not found")

    content = await file.read()
    raw = content.decode("utf-8", errors="replace")

    result = adapter.parse(raw, task_id=task_id)

    run_ids: list[str] = []
    for traj in result.trajectories:
        run_id = traj.task_id
        _store.save_trajectory(run_id, traj.to_yaml())
        run_ids.append(run_id)

    return ImportResult(
        imported=len(result.trajectories),
        run_ids=run_ids,
        warnings=result.warnings,
        stats=result.stats,
    )


@router.post("/import-trajectory/preview")
def preview_import(req: ImportRequest):
    """Parse without saving — preview what would be imported."""
    adapter = REGISTRY.get(req.adapter_id)
    if not adapter:
        raise HTTPException(404, f"Adapter '{req.adapter_id}' not found")

    result = adapter.parse(req.raw, task_id=req.task_id)

    previews = []
    for traj in result.trajectories:
        previews.append({
            "task_id": traj.task_id,
            "step_count": len(traj.steps),
            "tools_used": list({s.tool_call.get("name", "?") for s in traj.steps}),
            "first_steps": [
                {
                    "step_k": s.step_k,
                    "tool": s.tool_call.get("name", "?"),
                    "has_reasoning": bool(s.reasoning),
                    "observation_preview": str(s.observation.get("result", ""))[:200],
                }
                for s in traj.steps[:5]
            ],
        })

    return {
        "trajectories": previews,
        "warnings": result.warnings,
        "stats": result.stats,
    }
