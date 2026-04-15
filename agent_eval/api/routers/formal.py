"""Formal Verification API — Agent behavior state machine analysis."""
from __future__ import annotations

from fastapi import APIRouter

from agent_eval.formal_model import (
    build_state_machine_from_trajectories,
    AgentStateMachine,
)
from agent_eval.storage.sqlite_store import SqliteStore

router = APIRouter(prefix="/api/v1/agent-eval")
_store = SqliteStore()


@router.get("/formal/state-machine")
def get_state_machine(limit: int = 200) -> dict:
    """Build and return the Agent behavior state machine from stored trajectories."""
    trajectories = _store.list_trajectories(limit=limit)
    if not trajectories:
        return {"states": [], "transitions": [], "properties": [], "message": "暂无轨迹数据"}

    sm = build_state_machine_from_trajectories(trajectories)
    return sm.model_dump()


@router.get("/formal/verify")
def verify_safety(limit: int = 200) -> dict:
    """Build state machine and verify all safety properties."""
    trajectories = _store.list_trajectories(limit=limit)
    if not trajectories:
        return {"results": [], "message": "暂无轨迹数据"}

    sm = build_state_machine_from_trajectories(trajectories)
    results = sm.verify_all()

    return {
        "state_count": len(sm.states),
        "transition_count": len(sm.transitions),
        "property_count": len(sm.properties),
        "results": [r.model_dump() for r in results],
        "all_verified": all(r.verified for r in results),
    }
