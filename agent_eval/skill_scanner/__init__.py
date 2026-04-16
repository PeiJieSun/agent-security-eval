"""
Skill / Rules / Agent Config Security Scanner — five-layer deep analysis.

Backward-compatible: scan_directory, scan_content, scan_file still work as before.
New: SkillSecurityPipeline for five-layer deep scan.
"""
from agent_eval.skill_scanner.models import (
    Finding, ScannedFile, ScanReport, DeepScanReport, LayerResult,
    CapabilityGraph, CapabilityNode, CapabilityEdge,
)
from agent_eval.skill_scanner.discovery import discover_files, classify_file
from agent_eval.skill_scanner.pipeline import SkillSecurityPipeline

# ---------------------------------------------------------------------------
# Backward-compatible quick scan functions
# ---------------------------------------------------------------------------

def scan_file(path, counter=None):
    """Scan a single file (backward compat)."""
    from pathlib import Path
    from agent_eval.skill_scanner.l1_text import (
        scan_text_for_injection, scan_text_for_invisible,
        scan_text_for_encoding, scan_mcp_config, _next_id,
    )
    p = Path(path)
    file_type = classify_file(p)
    if counter is None:
        counter = [0]
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except (OSError, PermissionError) as e:
        return ScannedFile(
            path=str(p), file_type=file_type,
            findings=[Finding(
                finding_id=_next_id(counter), severity="info", category="error",
                title=f"Cannot read file: {e}", description=str(e), file_path=str(p),
            )],
        )
    findings = []
    fp = str(p)
    findings.extend(scan_text_for_injection(text, fp, counter))
    findings.extend(scan_text_for_invisible(text, fp, counter))
    findings.extend(scan_text_for_encoding(text, fp, counter))
    if file_type == "mcp_config":
        findings.extend(scan_mcp_config(text, fp, counter))
    return ScannedFile(path=fp, file_type=file_type,
                       size_bytes=len(text.encode("utf-8")), findings=findings)


def scan_content(text, file_path="<input>", file_type="unknown"):
    """Scan raw text content (backward compat)."""
    from agent_eval.skill_scanner.l1_text import (
        scan_text_for_injection, scan_text_for_invisible,
        scan_text_for_encoding, scan_mcp_config,
    )
    counter = [0]
    findings = []
    findings.extend(scan_text_for_injection(text, file_path, counter))
    findings.extend(scan_text_for_invisible(text, file_path, counter))
    findings.extend(scan_text_for_encoding(text, file_path, counter))
    if file_type == "mcp_config" or file_path.endswith(".json"):
        findings.extend(scan_mcp_config(text, file_path, counter))
    return ScannedFile(path=file_path, file_type=file_type,
                       size_bytes=len(text.encode("utf-8")), findings=findings)


def scan_directory(root):
    """Scan directory using static patterns only (backward compat)."""
    import uuid
    from pathlib import Path
    root = Path(root)
    files = discover_files(root)
    counter = [0]
    scanned = [scan_file(f, counter) for f in files]
    all_findings = [f for sf in scanned for f in sf.findings]
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for f in all_findings:
        if f.severity in counts:
            counts[f.severity] += 1
    report = ScanReport(
        scan_id=uuid.uuid4().hex[:12], target_path=str(root),
        files_scanned=len(scanned), total_findings=len(all_findings),
        critical_count=counts["critical"], high_count=counts["high"],
        medium_count=counts["medium"], low_count=counts["low"],
        files=scanned,
    )
    parts = []
    if report.critical_count: parts.append(f"{report.critical_count} critical")
    if report.high_count: parts.append(f"{report.high_count} high")
    if report.medium_count: parts.append(f"{report.medium_count} medium")
    report.summary = (
        f"Scanned {report.files_scanned} files, found {report.total_findings} issues"
        + (f" ({', '.join(parts)})" if parts else "")
    )
    return report


__all__ = [
    "Finding", "ScannedFile", "ScanReport", "DeepScanReport", "LayerResult",
    "CapabilityGraph", "CapabilityNode", "CapabilityEdge",
    "discover_files", "classify_file",
    "scan_file", "scan_content", "scan_directory",
    "SkillSecurityPipeline",
]
