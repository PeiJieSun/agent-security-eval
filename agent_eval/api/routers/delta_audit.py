"""Delta Audit API — A/B comparison between framework baseline and custom deployment."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent_eval.delta_audit import run_delta_audit, DeltaAuditResult
from agent_eval.framework_fingerprint import KNOWN_BASELINES

router = APIRouter(prefix="/api/v1/agent-eval")

_audit_history: list[DeltaAuditResult] = []


class DeltaAuditRequest(BaseModel):
    framework: str
    custom_label: str = ""
    custom_scores: dict[str, float]


@router.post("/delta-audit")
def create_delta_audit(req: DeltaAuditRequest) -> dict:
    if req.framework not in KNOWN_BASELINES:
        raise HTTPException(400, f"Unknown framework: {req.framework!r}. Available: {list(KNOWN_BASELINES.keys())}")
    try:
        result = run_delta_audit(req.framework, req.custom_scores, req.custom_label)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _audit_history.append(result)
    return result.model_dump()


@router.get("/delta-audit")
def list_audits() -> list[dict]:
    return [a.model_dump() for a in reversed(_audit_history)]


@router.get("/delta-audit/{audit_id}")
def get_audit(audit_id: str) -> dict:
    for a in _audit_history:
        if a.audit_id == audit_id:
            return a.model_dump()
    raise HTTPException(404, f"audit {audit_id!r} not found")
