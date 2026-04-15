"""Compliance Report API — generate and view industry compliance audit reports."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent_eval.compliance_templates import TEMPLATES, generate_compliance_report, ComplianceReport

router = APIRouter(prefix="/api/v1/agent-eval")

_report_history: list[ComplianceReport] = []


@router.get("/compliance/templates")
def list_templates() -> list[dict]:
    return [
        {
            "template_id": t.template_id,
            "industry": t.industry,
            "standard": t.standard,
            "standard_full_name": t.standard_full_name,
            "description": t.description,
            "section_count": len(t.sections),
            "tags": t.tags,
        }
        for t in TEMPLATES.values()
    ]


@router.get("/compliance/templates/{template_id}")
def get_template(template_id: str) -> dict:
    t = TEMPLATES.get(template_id)
    if not t:
        raise HTTPException(404, f"Template {template_id!r} not found")
    return t.model_dump()


class ComplianceRequest(BaseModel):
    template_id: str
    dimension_scores: dict[str, float]
    model: str = ""


@router.post("/compliance/generate")
def generate_report(req: ComplianceRequest) -> dict:
    try:
        report = generate_compliance_report(req.template_id, req.dimension_scores, req.model)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _report_history.append(report)
    return report.model_dump()


@router.get("/compliance/reports")
def list_reports() -> list[dict]:
    return [r.model_dump() for r in reversed(_report_history)]


@router.get("/compliance/reports/{report_id}")
def get_report(report_id: str) -> dict:
    for r in _report_history:
        if r.report_id == report_id:
            return r.model_dump()
    raise HTTPException(404, f"report {report_id!r} not found")
