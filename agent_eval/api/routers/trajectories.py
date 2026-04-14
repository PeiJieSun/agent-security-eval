"""
Runs and trajectory endpoints.

Endpoints
---------
  POST   /api/v1/agent-eval/runs               create a new run
  GET    /api/v1/agent-eval/runs               list runs (newest first)
  GET    /api/v1/agent-eval/runs/{run_id}      run detail
  DELETE /api/v1/agent-eval/runs/{run_id}      delete run + trajectory
  GET    /api/v1/agent-eval/tasks/{task_id}/trajectory  full trajectory YAML + parsed steps
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from agent_eval.storage.sqlite_store import SqliteStore
from agent_eval.trajectory import AgentTrajectory

router = APIRouter(prefix="/api/v1/agent-eval", tags=["agent-eval"])


# ── Dependency ────────────────────────────────────────────────────────────

def get_store() -> SqliteStore:
    return SqliteStore()


# ── Request / response models ─────────────────────────────────────────────

class CreateRunRequest(BaseModel):
    task_id: str
    run_id: Optional[str] = None


class SaveTrajectoryRequest(BaseModel):
    trajectory_yaml: str


# ── Runs ──────────────────────────────────────────────────────────────────

@router.post("/runs", status_code=201)
def create_run(
    body: CreateRunRequest,
    store: SqliteStore = Depends(get_store),
) -> dict[str, Any]:
    return store.create_run(task_id=body.task_id, run_id=body.run_id)


@router.get("/runs")
def list_runs(
    limit: int = 50,
    store: SqliteStore = Depends(get_store),
) -> list[dict[str, Any]]:
    return store.list_runs(limit=limit)


@router.get("/runs/{run_id}")
def get_run(run_id: str, store: SqliteStore = Depends(get_store)) -> dict[str, Any]:
    try:
        return store.get_run(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")


@router.delete("/runs/{run_id}", status_code=204)
def delete_run(run_id: str, store: SqliteStore = Depends(get_store)) -> None:
    try:
        store.get_run(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
    store.delete_run(run_id)


@router.post("/runs/{run_id}/trajectory", status_code=201)
def save_trajectory(
    run_id: str,
    body: SaveTrajectoryRequest,
    store: SqliteStore = Depends(get_store),
) -> dict[str, Any]:
    """Store a serialised AgentTrajectory YAML blob for a run."""
    try:
        store.get_run(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
    try:
        traj = AgentTrajectory.from_yaml(body.trajectory_yaml)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid trajectory YAML: {exc}")
    store.save_trajectory(run_id, traj)
    store.update_run(run_id, status="done", steps_count=len(traj.steps))
    return {"run_id": run_id, "steps_count": len(traj.steps)}


# ── Trajectory retrieval ──────────────────────────────────────────────────

@router.get("/tasks/{task_id}/trajectory")
def get_trajectory_by_task(
    task_id: str,
    store: SqliteStore = Depends(get_store),
) -> dict[str, Any]:
    """
    Return the latest trajectory for a given task_id.
    Scans runs newest-first for a matching task_id with a stored trajectory.
    """
    runs = store.list_runs(limit=200)
    matching = [r for r in runs if r["task_id"] == task_id]
    if not matching:
        raise HTTPException(status_code=404, detail=f"No runs found for task {task_id!r}")
    for run in matching:
        try:
            traj = store.get_trajectory(run["run_id"])
            return {
                "run_id": run["run_id"],
                "task_id": task_id,
                "steps_count": len(traj.steps),
                "final_output": traj.final_output,
                "steps": traj.to_dict()["steps"],
            }
        except KeyError:
            continue
    raise HTTPException(
        status_code=404, detail=f"No trajectory stored for task {task_id!r}"
    )


@router.get("/runs/{run_id}/trajectory")
def get_trajectory_by_run(
    run_id: str,
    store: SqliteStore = Depends(get_store),
) -> dict[str, Any]:
    try:
        store.get_run(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run {run_id!r} not found")
    try:
        traj = store.get_trajectory(run_id)
    except KeyError:
        raise HTTPException(
            status_code=404, detail=f"No trajectory for run {run_id!r}"
        )
    return {
        "run_id": run_id,
        "task_id": traj.task_id,
        "steps_count": len(traj.steps),
        "final_output": traj.final_output,
        "steps": traj.to_dict()["steps"],
    }


@router.get("/trajectories/{traj_id}")
def get_trajectory_direct(
    traj_id: str,
    store: SqliteStore = Depends(get_store),
) -> dict[str, Any]:
    """
    Fetch a trajectory directly by its storage ID (no run record required).
    Used for eval trajectories stored as {eval_id}_clean / {eval_id}_attack.
    """
    try:
        traj = store.get_trajectory(traj_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Trajectory {traj_id!r} not found")
    return {
        "run_id": traj_id,
        "task_id": traj.task_id,
        "steps_count": len(traj.steps),
        "final_output": traj.final_output,
        "steps": traj.to_dict()["steps"],
    }
