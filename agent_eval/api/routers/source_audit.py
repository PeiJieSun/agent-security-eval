"""Source Code Audit API — scan framework source code for Agent-specific vulnerabilities."""
from __future__ import annotations

import threading
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent_eval.source_audit import (
    audit_directory,
    audit_installed_package,
    AuditReport,
    CWE_CATALOG,
)

router = APIRouter(prefix="/api/v1/agent-eval")

_audit_history: list[AuditReport] = []
_running: dict[str, dict] = {}  # audit_id → status
_lock = threading.Lock()


@router.get("/source-audit/cwe-catalog")
def get_cwe_catalog() -> dict:
    return CWE_CATALOG


class AuditRequest(BaseModel):
    target: str           # package name or directory path
    mode: str = "package" # "package" or "directory"
    framework: str = ""


@router.post("/source-audit/scan")
def start_scan(req: AuditRequest) -> dict:
    """Start a source code audit. Runs synchronously for now (fast enough for single packages)."""
    try:
        if req.mode == "package":
            report = audit_installed_package(req.target)
        else:
            report = audit_directory(req.target, framework=req.framework)
    except Exception as e:
        raise HTTPException(500, f"Scan failed: {e}")

    with _lock:
        _audit_history.append(report)

    return report.model_dump()


@router.get("/source-audit/reports")
def list_reports() -> list[dict]:
    return [
        {
            "report_id": r.report_id,
            "target": r.target,
            "framework": r.framework,
            "files_scanned": r.files_scanned,
            "lines_scanned": r.lines_scanned,
            "vuln_count": len(r.vulnerabilities),
            "vuln_by_severity": r.vuln_by_severity,
            "created_at": r.created_at,
            "scan_duration_ms": r.scan_duration_ms,
        }
        for r in reversed(_audit_history)
    ]


@router.get("/source-audit/reports/{report_id}")
def get_report(report_id: str) -> dict:
    for r in _audit_history:
        if r.report_id == report_id:
            return r.model_dump()
    raise HTTPException(404, f"Report {report_id!r} not found")


@router.get("/source-audit/reports/{report_id}/call-graph")
def get_call_graph(report_id: str) -> list[dict]:
    for r in _audit_history:
        if r.report_id == report_id:
            return [n.model_dump() for n in r.call_graph]
    raise HTTPException(404, f"Report {report_id!r} not found")
