"""Taint Analysis API — trace untrusted data flow through agent reasoning."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from agent_eval.taint_analysis import (
    analyze_trajectory,
    analyze_trajectories,
    aggregate_taint_stats,
    TaintTrace,
)
from agent_eval.storage.sqlite_store import SqliteStore

router = APIRouter(prefix="/api/v1/agent-eval")
_store = SqliteStore()


@router.get("/taint/analyze-all")
def analyze_all_trajectories(limit: int = 100) -> dict:
    """Analyze all stored trajectories for taint propagation."""
    trajectories = _store.list_trajectories(limit=limit)
    if not trajectories:
        return {"traces": [], "stats": aggregate_taint_stats([]), "message": "暂无轨迹数据"}

    traces = analyze_trajectories(trajectories)
    stats = aggregate_taint_stats(traces)

    traces_data = []
    for t in traces:
        traces_data.append({
            "trace_id": t.trace_id,
            "task_id": t.task_id,
            "sources": len(t.sources),
            "sinks": len(t.sinks),
            "links": len(t.links),
            "attack_chains": t.attack_chains,
            "taint_coverage": t.taint_coverage,
            "max_chain_length": t.max_chain_length,
        })

    return {"traces": traces_data, "stats": stats}


@router.get("/taint/trace/{task_id}")
def get_trace(task_id: str) -> dict:
    """Get detailed taint trace for a specific trajectory."""
    trajectories = _store.list_trajectories(limit=500)
    target = None
    for t in trajectories:
        if t.task_id == task_id:
            target = t
            break

    if not target:
        raise HTTPException(404, f"Trajectory {task_id!r} not found")

    trace = analyze_trajectory(target)
    return trace.model_dump()


@router.get("/taint/stats")
def get_stats() -> dict:
    """Get aggregate taint statistics across all trajectories."""
    trajectories = _store.list_trajectories(limit=200)
    traces = analyze_trajectories(trajectories)
    return aggregate_taint_stats(traces)
