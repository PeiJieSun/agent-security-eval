"""
Vertical Pack API — browse industry-specific security evaluation packs.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1/agent-eval")


@router.get("/verticals")
def list_verticals() -> list[dict]:
    """List all registered vertical packs."""
    from agent_eval.verticals import _registry

    return [
        {
            "pack_id": p.pack_id,
            "name": p.name,
            "industry": p.industry,
            "description": p.description,
            "icon": p.icon,
            "tool_count": len(p.tools),
            "scenario_count": len(p.attack_scenarios),
            "compliance_count": len(p.compliance_rules),
            "tags": p.tags,
        }
        for p in _registry.list_all()
    ]


@router.get("/verticals/industries")
def list_industries() -> list[str]:
    from agent_eval.verticals import _registry

    return _registry.industries()


@router.get("/verticals/{pack_id}")
def get_vertical(pack_id: str) -> dict:
    from agent_eval.verticals import _registry

    pack = _registry.get(pack_id)
    if not pack:
        raise HTTPException(404, f"pack {pack_id!r} not found")
    return pack.model_dump()


@router.get("/verticals/{pack_id}/scenarios")
def list_scenarios(pack_id: str) -> list[dict]:
    from agent_eval.verticals import _registry

    pack = _registry.get(pack_id)
    if not pack:
        raise HTTPException(404, f"pack {pack_id!r} not found")
    return [s.model_dump() for s in pack.attack_scenarios]


@router.get("/verticals/{pack_id}/tools")
def list_tools(pack_id: str) -> list[dict]:
    from agent_eval.verticals import _registry

    pack = _registry.get(pack_id)
    if not pack:
        raise HTTPException(404, f"pack {pack_id!r} not found")
    return [t.model_dump() for t in pack.tools]


@router.get("/verticals/{pack_id}/compliance")
def list_compliance(pack_id: str) -> list[dict]:
    from agent_eval.verticals import _registry

    pack = _registry.get(pack_id)
    if not pack:
        raise HTTPException(404, f"pack {pack_id!r} not found")
    return [r.model_dump() for r in pack.compliance_rules]
