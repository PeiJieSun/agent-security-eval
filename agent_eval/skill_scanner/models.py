"""
Data models for the five-layer Skill Security Scanner.
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Core finding model (shared across all layers)
# ---------------------------------------------------------------------------

class Finding(BaseModel):
    finding_id: str
    severity: str          # critical / high / medium / low / info
    category: str          # injection / invisible_char / mcp_config / permission / encoding / semantic / capability / behavior / supply_chain / composition
    title: str
    description: str
    file_path: str
    line_number: int = 0
    matched_text: str = ""
    recommendation: str = ""
    layer: str = ""        # L1 ~ L5


class ScannedFile(BaseModel):
    path: str
    file_type: str         # skill / rule / agents_md / mcp_config / unknown
    size_bytes: int = 0
    findings: list[Finding] = Field(default_factory=list)


class ScanReport(BaseModel):
    """Quick scan report (L1 static only — backward compat)."""
    scan_id: str = ""
    target_path: str
    files_scanned: int = 0
    total_findings: int = 0
    critical_count: int = 0
    high_count: int = 0
    medium_count: int = 0
    low_count: int = 0
    files: list[ScannedFile] = Field(default_factory=list)
    summary: str = ""


# ---------------------------------------------------------------------------
# L2 Capability Graph
# ---------------------------------------------------------------------------

class CapabilityNode(BaseModel):
    id: str
    type: str              # skill / tool / permission / impact
    label: str
    risk_level: str = "low"  # safe / low / medium / high / critical


class CapabilityEdge(BaseModel):
    source: str
    target: str
    relation: str          # declares / grants / enables / escalates_to


class CapabilityGraph(BaseModel):
    nodes: list[CapabilityNode] = Field(default_factory=list)
    edges: list[CapabilityEdge] = Field(default_factory=list)
    risk_paths: list[list[str]] = Field(default_factory=list)
    max_blast_radius: str = "none"   # none / file_read / file_write / credential_theft / network / rce / data_exfil


class BlastRadius(BaseModel):
    level: str             # none / file_read / file_write / credential_theft / network / rce / data_exfil
    description: str = ""
    affected_assets: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# L3 Behavior
# ---------------------------------------------------------------------------

class TestScenario(BaseModel):
    scenario_id: str
    skill_text: str
    benign_task: str
    expected_tools: list[str] = Field(default_factory=list)
    honeypot_tools: list[str] = Field(default_factory=list)


class BehaviorDeviation(BaseModel):
    declared_purpose: str
    actual_actions: list[str] = Field(default_factory=list)
    deviation_score: float = 0.0   # 0=identical, 1=completely different
    suspicious_calls: list[dict] = Field(default_factory=list)
    summary: str = ""


# ---------------------------------------------------------------------------
# L4 Supply Chain
# ---------------------------------------------------------------------------

class FileProvenance(BaseModel):
    path: str
    sha256: str = ""
    git_author: str = ""
    git_commit: str = ""
    git_date: str = ""
    has_uncommitted_changes: bool = False
    file_permissions: str = ""
    permission_anomaly: bool = False


class DependencyRisk(BaseModel):
    name: str
    risk_type: str         # typosquat / known_malicious / cve / missing
    description: str = ""
    severity: str = "medium"


# ---------------------------------------------------------------------------
# L5 Composition
# ---------------------------------------------------------------------------

class FileDirective(BaseModel):
    file_path: str
    file_type: str
    directives: list[str] = Field(default_factory=list)
    permissions_granted: list[str] = Field(default_factory=list)
    safety_constraints: list[str] = Field(default_factory=list)


class ConflictPair(BaseModel):
    file_a: str
    file_b: str
    conflict_type: str     # override / contradiction / escalation / ambiguity
    description: str
    severity: str = "medium"


class ConflictMatrix(BaseModel):
    files: list[str]
    conflicts: list[ConflictPair] = Field(default_factory=list)
    escalation_paths: list[list[str]] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Layer result + deep scan report
# ---------------------------------------------------------------------------

class LayerResult(BaseModel):
    layer: str             # L1 ~ L5
    layer_name: str
    status: str = "pending"  # pending / running / done / skipped / error
    score: Optional[float] = None  # 0.0~1.0
    findings: list[Finding] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    elapsed_ms: int = 0
    error_message: str = ""


LAYER_WEIGHTS = {"L1": 0.15, "L2": 0.30, "L3": 0.30, "L4": 0.10, "L5": 0.15}


class DeepScanReport(BaseModel):
    scan_id: str = ""
    target_path: str
    layers_requested: list[str] = Field(default_factory=list)
    layer_results: list[LayerResult] = Field(default_factory=list)
    overall_score: Optional[float] = None
    overall_verdict: str = "unknown"   # safe / suspicious / dangerous / unknown
    files_discovered: list[ScannedFile] = Field(default_factory=list)

    def compute_overall(self) -> None:
        done = [lr for lr in self.layer_results if lr.status == "done" and lr.score is not None]
        if not done:
            self.overall_score = None
            self.overall_verdict = "unknown"
            return
        total_w = sum(LAYER_WEIGHTS.get(lr.layer, 0.1) for lr in done)
        if total_w == 0:
            return
        self.overall_score = sum(
            (LAYER_WEIGHTS.get(lr.layer, 0.1) / total_w) * lr.score
            for lr in done
        )
        if self.overall_score >= 0.9:
            self.overall_verdict = "safe"
        elif self.overall_score >= 0.6:
            self.overall_verdict = "suspicious"
        else:
            self.overall_verdict = "dangerous"
