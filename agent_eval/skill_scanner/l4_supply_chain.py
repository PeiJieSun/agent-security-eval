"""
L4: Supply Chain Provenance Layer.
Mostly deterministic analysis — git provenance, integrity checks, dependency audit.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import time
from pathlib import Path
from typing import Any

from agent_eval.skill_scanner.discovery import classify_file
from agent_eval.skill_scanner.models import (
    DependencyRisk, FileProvenance, Finding, LayerResult,
)

# ---------------------------------------------------------------------------
# Known typosquat / suspicious package patterns
# ---------------------------------------------------------------------------

TYPOSQUAT_PAIRS: list[tuple[str, str]] = [
    ("@anthropic-ai/", "@anthropc-ai/"),
    ("@anthropic-ai/", "@anthrpic-ai/"),
    ("@modelcontextprotocol/", "@model-context-protocol/"),
    ("@modelcontextprotocol/", "@modelcontextprotcol/"),
    ("@openai/", "@opanai/"),
    ("@openai/", "@open-ai/"),
    ("langchain", "lang-chain"),
    ("langchain", "langchaim"),
    ("crewai", "crew-ai"),
    ("crewai", "crewaii"),
]

KNOWN_SUSPICIOUS_DOMAINS = [
    "evil.com", "attacker.com", "malicious.site",
    "pastebin.com", "requestbin.com", "webhook.site",
    "ngrok.io", "serveo.net", "localtunnel.me",
]


# ---------------------------------------------------------------------------
# Git provenance
# ---------------------------------------------------------------------------

def _git_provenance(path: Path) -> FileProvenance:
    prov = FileProvenance(path=str(path))

    try:
        perm = os.stat(path).st_mode
        prov.file_permissions = oct(perm)[-3:]
        prov.permission_anomaly = bool(perm & stat.S_IWOTH)
    except OSError:
        pass

    try:
        prov.sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        pass

    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%an|%H|%aI", "--", str(path)],
            capture_output=True, text=True, timeout=5,
            cwd=str(path.parent),
        )
        if result.returncode == 0 and result.stdout.strip():
            parts = result.stdout.strip().split("|", 2)
            if len(parts) == 3:
                prov.git_author, prov.git_commit, prov.git_date = parts
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", "--", str(path)],
            capture_output=True, text=True, timeout=5,
            cwd=str(path.parent),
        )
        if result.returncode == 0 and result.stdout.strip():
            prov.has_uncommitted_changes = True
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return prov


# ---------------------------------------------------------------------------
# MCP dependency analysis
# ---------------------------------------------------------------------------

def _check_typosquat(name: str) -> list[DependencyRisk]:
    risks = []
    name_lower = name.lower()
    for legit, typo in TYPOSQUAT_PAIRS:
        if typo in name_lower:
            risks.append(DependencyRisk(
                name=name, risk_type="typosquat",
                description=f"Package name resembles known typosquat of '{legit}' — found '{typo}'",
                severity="critical",
            ))
    return risks


def _check_suspicious_urls(text: str, file_path: str) -> list[DependencyRisk]:
    risks = []
    for domain in KNOWN_SUSPICIOUS_DOMAINS:
        if domain in text.lower():
            risks.append(DependencyRisk(
                name=domain, risk_type="known_malicious",
                description=f"Reference to suspicious domain '{domain}' in {file_path}",
                severity="high",
            ))
    return risks


def _analyze_mcp_dependencies(text: str, file_path: str) -> list[DependencyRisk]:
    risks = []
    try:
        config = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return risks

    servers = config.get("mcpServers", config.get("mcp_servers", {}))
    if not isinstance(servers, dict):
        return risks

    for name, srv in servers.items():
        if not isinstance(srv, dict):
            continue
        cmd = srv.get("command", "")
        args = srv.get("args", [])
        full_cmd = f"{cmd} {' '.join(str(a) for a in args)}"

        risks.extend(_check_typosquat(full_cmd))

        url = srv.get("url", "")
        if url:
            risks.extend(_check_suspicious_urls(url, file_path))
        risks.extend(_check_suspicious_urls(full_cmd, file_path))

    return risks


# ---------------------------------------------------------------------------
# Cross-reference check
# ---------------------------------------------------------------------------

def _check_cross_references(contents: dict[str, str]) -> list[Finding]:
    """Check if skills reference other files/skills that don't exist."""
    findings = []
    all_paths = set(contents.keys())

    for fp, text in contents.items():
        # Look for file references like `skills/foo/SKILL.md` or `Read ~/.cursor/skills/...`
        import re
        refs = re.findall(r'(?:skills|rules)/[\w\-/]+\.(?:md|mdc|json)', text)
        for ref in refs:
            found = any(ref in p for p in all_paths)
            if not found:
                findings.append(Finding(
                    finding_id="", severity="low",
                    category="supply_chain", layer="L4",
                    title=f"Unresolved reference: {ref}",
                    description=f"File {fp} references '{ref}' which was not found in the scan scope",
                    file_path=fp,
                    recommendation="Verify the referenced file exists and is accessible.",
                ))
    return findings


# ---------------------------------------------------------------------------
# L4 entry point
# ---------------------------------------------------------------------------

def _next_id(counter: list[int]) -> str:
    counter[0] += 1
    return f"F{counter[0]:04d}"


async def analyze(
    contents: dict[str, str],
    counter: list[int],
) -> LayerResult:
    t0 = time.time()
    findings: list[Finding] = []

    # Provenance per file
    provenances: list[dict] = []
    for fp in contents:
        p = Path(fp)
        prov = _git_provenance(p)
        provenances.append(prov.model_dump())

        if prov.has_uncommitted_changes:
            findings.append(Finding(
                finding_id=_next_id(counter), severity="medium",
                category="supply_chain", layer="L4",
                title=f"Uncommitted changes: {p.name}",
                description=f"File has local modifications not tracked by git",
                file_path=fp,
                recommendation="Commit or review local changes to maintain auditability.",
            ))

        if prov.permission_anomaly:
            findings.append(Finding(
                finding_id=_next_id(counter), severity="high",
                category="supply_chain", layer="L4",
                title=f"World-writable file: {p.name}",
                description=f"File permissions {prov.file_permissions} allow world write access",
                file_path=fp,
                recommendation="Restrict file permissions (chmod 644 or tighter).",
            ))

        if not prov.git_commit:
            findings.append(Finding(
                finding_id=_next_id(counter), severity="low",
                category="supply_chain", layer="L4",
                title=f"No git history: {p.name}",
                description="File has no git commit history — provenance unknown",
                file_path=fp,
                recommendation="Track this file in version control for auditability.",
            ))

    # MCP dependency risks
    dep_risks: list[dict] = []
    for fp, text in contents.items():
        if classify_file(Path(fp)) == "mcp_config":
            risks = _analyze_mcp_dependencies(text, fp)
            for risk in risks:
                dep_risks.append(risk.model_dump())
                findings.append(Finding(
                    finding_id=_next_id(counter), severity=risk.severity,
                    category="supply_chain", layer="L4",
                    title=f"Dependency risk: {risk.risk_type} — {risk.name}",
                    description=risk.description,
                    file_path=fp,
                    recommendation="Verify package names and URLs against known legitimate sources.",
                ))

        risks_url = _check_suspicious_urls(text, fp)
        for risk in risks_url:
            dep_risks.append(risk.model_dump())
            findings.append(Finding(
                finding_id=_next_id(counter), severity=risk.severity,
                category="supply_chain", layer="L4",
                title=f"Suspicious domain reference: {risk.name}",
                description=risk.description,
                file_path=fp,
                recommendation="Remove or replace references to untrusted domains.",
            ))

    # Cross-reference checks
    xref_findings = _check_cross_references(contents)
    for f in xref_findings:
        f.finding_id = _next_id(counter)
    findings.extend(xref_findings)

    critical_high = sum(1 for f in findings if f.severity in ("critical", "high"))
    score = 1.0 if critical_high == 0 else max(0.0, 1.0 - (critical_high * 0.2))

    return LayerResult(
        layer="L4", layer_name="供应链溯源", status="done",
        score=score, findings=findings,
        metadata={
            "provenances": provenances,
            "dependency_risks": dep_risks,
        },
        elapsed_ms=int((time.time() - t0) * 1000),
    )
