"""Defense Gateway API — manage runtime defense policies and monitor interceptions."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent_eval.defense_gateway import get_gateway, SecurityPolicy

router = APIRouter(prefix="/api/v1/agent-eval")


@router.get("/defense/status")
def get_status() -> dict:
    gw = get_gateway()
    return {
        "active": gw.state.active,
        "policy_count": len(gw.state.policies),
        "total_intercepted": gw.state.total_intercepted,
        "total_passed": gw.state.total_passed,
        "kill_switch_triggered": gw.state.kill_switch_triggered,
    }


@router.post("/defense/activate")
def activate() -> dict:
    gw = get_gateway()
    gw.activate()
    return {"active": True}


@router.post("/defense/deactivate")
def deactivate() -> dict:
    gw = get_gateway()
    gw.deactivate()
    return {"active": False}


@router.get("/defense/policies")
def list_policies() -> list[dict]:
    gw = get_gateway()
    return [p.model_dump() for p in gw.state.policies]


@router.post("/defense/policies")
def add_policy(policy: SecurityPolicy) -> dict:
    gw = get_gateway()
    gw.add_policy(policy)
    return policy.model_dump()


@router.delete("/defense/policies/{rule_id}")
def delete_policy(rule_id: str) -> dict:
    gw = get_gateway()
    removed = gw.remove_policy(rule_id)
    if not removed:
        raise HTTPException(404, f"policy {rule_id!r} not found")
    return {"removed": rule_id}


@router.put("/defense/policies/{rule_id}/toggle")
def toggle_policy(rule_id: str) -> dict:
    gw = get_gateway()
    for p in gw.state.policies:
        if p.rule_id == rule_id:
            p.enabled = not p.enabled
            return p.model_dump()
    raise HTTPException(404, f"policy {rule_id!r} not found")


@router.get("/defense/log")
def get_log(limit: int = 50) -> list[dict]:
    gw = get_gateway()
    logs = gw.state.interception_log[-limit:]
    return [log.model_dump() for log in reversed(logs)]


@router.post("/defense/generate-from-tcg")
def generate_from_tcg() -> dict:
    gw = get_gateway()
    new_policies = gw.generate_policies_from_tcg()
    return {
        "generated": len(new_policies),
        "policies": [p.model_dump() for p in new_policies],
    }


class SimulateRequest(BaseModel):
    tool_name: str
    arguments: dict = {}
    response_text: str = ""


@router.post("/defense/simulate")
def simulate_call(req: SimulateRequest) -> dict:
    gw = get_gateway()
    allowed, reason = gw.check_tool_call(req.tool_name, req.arguments)
    sanitized = gw.sanitize_response(req.tool_name, req.response_text) if req.response_text else ""
    return {
        "allowed": allowed,
        "reason": reason,
        "original_response": req.response_text,
        "sanitized_response": sanitized,
        "was_modified": sanitized != req.response_text,
    }


class FullDefenseCheckRequest(BaseModel):
    tool_name: str
    tool_response: str = ""
    reasoning: str = ""
    previous_observations: list[str] = []
    user_instruction: str = ""
    context: dict = {}
    session_asr: float = 0.0
    session_actions: int = 0


@router.post("/defense/full-check")
def full_defense_check(req: FullDefenseCheckRequest) -> dict:
    gw = get_gateway()
    return gw.full_defense_check(
        tool_name=req.tool_name,
        tool_response=req.tool_response,
        reasoning=req.reasoning,
        previous_observations=req.previous_observations,
        user_instruction=req.user_instruction,
        context=req.context,
        session_asr=req.session_asr,
        session_actions=req.session_actions,
    )


class AuditPolicyRequest(BaseModel):
    vulns: list[dict]


@router.post("/defense/generate-from-audit")
def generate_from_audit(req: AuditPolicyRequest) -> dict:
    gw = get_gateway()
    new_policies = gw.generate_policies_from_audit(req.vulns)
    return {"generated": len(new_policies), "policies": [p.model_dump() for p in new_policies]}
