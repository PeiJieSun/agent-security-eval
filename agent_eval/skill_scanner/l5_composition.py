"""
L5: Composition Security Analysis Layer.
Detects conflicts, privilege escalation, and override risks when multiple
skills/rules are loaded simultaneously.
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

from agent_eval.skill_scanner.discovery import classify_file
from agent_eval.skill_scanner.models import (
    ConflictMatrix, ConflictPair, FileDirective,
    Finding, LayerResult,
)
from agent_eval.skill_scanner.prompts import L5_COMPOSITION_RISK

# ---------------------------------------------------------------------------
# Directive extraction (deterministic)
# ---------------------------------------------------------------------------

SAFETY_KEYWORDS = [
    "禁止", "不得", "不允许", "严禁", "NEVER", "MUST NOT", "DO NOT",
    "forbidden", "prohibited", "restricted", "blocked",
    "安全", "safety", "security", "constraint", "限制", "约束",
]

OVERRIDE_KEYWORDS = [
    "override", "覆盖", "替代", "replace", "supersede",
    "ignore", "忽略", "disregard", "skip",
    "优先", "priority", "takes precedence", "overrides",
]

PERMISSION_KEYWORDS = [
    "allow", "允许", "permit", "grant", "enable", "可以",
    "read", "write", "execute", "delete", "send", "access",
    "tool", "工具", "permission", "权限",
]


def _extract_directives(file_path: str, text: str) -> FileDirective:
    """Extract behavioral directives from a file."""
    lines = text.splitlines()
    directives: list[str] = []
    permissions: list[str] = []
    safety: list[str] = []

    for i, line in enumerate(lines):
        line_lower = line.lower().strip()
        if not line_lower or line_lower.startswith("#"):
            continue

        has_safety = any(kw.lower() in line_lower for kw in SAFETY_KEYWORDS)
        has_override = any(kw.lower() in line_lower for kw in OVERRIDE_KEYWORDS)
        has_permission = any(kw.lower() in line_lower for kw in PERMISSION_KEYWORDS)

        if has_safety:
            safety.append(line.strip()[:200])
        if has_override:
            directives.append(f"[override] {line.strip()[:200]}")
        elif has_permission:
            permissions.append(line.strip()[:200])
        elif has_safety:
            directives.append(f"[safety] {line.strip()[:200]}")

    return FileDirective(
        file_path=file_path,
        file_type=classify_file(Path(file_path)),
        directives=directives,
        permissions_granted=permissions,
        safety_constraints=safety,
    )


# ---------------------------------------------------------------------------
# Deterministic conflict detection
# ---------------------------------------------------------------------------

def _detect_conflicts(directives: list[FileDirective]) -> list[ConflictPair]:
    """Detect obvious conflicts between files."""
    conflicts: list[ConflictPair] = []

    for i, a in enumerate(directives):
        for b in directives[i + 1:]:
            # Override vs safety
            a_overrides = [d for d in a.directives if d.startswith("[override]")]
            b_safety = a.safety_constraints
            for ov in a_overrides:
                for sf in b.safety_constraints:
                    if _semantic_overlap(ov, sf):
                        conflicts.append(ConflictPair(
                            file_a=a.file_path, file_b=b.file_path,
                            conflict_type="override",
                            description=f"'{a.file_path}' declares override that may weaken safety constraint in '{b.file_path}'",
                            severity="high",
                        ))

            b_overrides = [d for d in b.directives if d.startswith("[override]")]
            for ov in b_overrides:
                for sf in a.safety_constraints:
                    if _semantic_overlap(ov, sf):
                        conflicts.append(ConflictPair(
                            file_a=b.file_path, file_b=a.file_path,
                            conflict_type="override",
                            description=f"'{b.file_path}' declares override that may weaken safety constraint in '{a.file_path}'",
                            severity="high",
                        ))

            # Permission escalation: combined permissions
            a_perms = set(_normalize_perms(a.permissions_granted))
            b_perms = set(_normalize_perms(b.permissions_granted))
            combined = a_perms | b_perms
            if _check_escalation(a_perms, b_perms, combined):
                conflicts.append(ConflictPair(
                    file_a=a.file_path, file_b=b.file_path,
                    conflict_type="escalation",
                    description=f"Combined permissions from '{Path(a.file_path).name}' + '{Path(b.file_path).name}' may enable privilege escalation",
                    severity="high",
                ))

    return conflicts


def _semantic_overlap(text_a: str, text_b: str) -> bool:
    """Rough check if two text snippets discuss the same topic."""
    words_a = set(re.findall(r'\w{3,}', text_a.lower()))
    words_b = set(re.findall(r'\w{3,}', text_b.lower()))
    if not words_a or not words_b:
        return False
    overlap = len(words_a & words_b)
    return overlap >= 2 or overlap / min(len(words_a), len(words_b)) > 0.3


def _normalize_perms(perms: list[str]) -> list[str]:
    """Extract permission keywords from permission declarations."""
    result = []
    for p in perms:
        for kw in ["read", "write", "execute", "delete", "send", "network", "shell", "file", "http"]:
            if kw in p.lower():
                result.append(kw)
    return result


def _check_escalation(a_perms: set, b_perms: set, combined: set) -> bool:
    """Check if combined permissions create escalation paths."""
    dangerous_combos = [
        ({"read", "network"}, "read+network = data exfiltration"),
        ({"write", "execute"}, "write+execute = arbitrary code execution"),
        ({"shell", "network"}, "shell+network = remote command execution"),
        ({"file", "http"}, "file+http = file exfiltration via network"),
    ]
    for combo, _ in dangerous_combos:
        if combo <= combined and not (combo <= a_perms or combo <= b_perms):
            return True
    return False


# ---------------------------------------------------------------------------
# LLM composition risk analysis
# ---------------------------------------------------------------------------

async def _llm_composition_analysis(
    directives: list[FileDirective],
    conflicts: list[ConflictPair],
    api_key: str, base_url: str, model: str,
) -> dict[str, Any]:
    if not api_key:
        return {"composition_risk": "unknown", "summary": "No LLM available for composition analysis"}

    files_text = "\n\n".join(
        f"--- {d.file_path} ({d.file_type}) ---\n"
        f"Directives: {'; '.join(d.directives[:10])}\n"
        f"Permissions: {'; '.join(d.permissions_granted[:10])}\n"
        f"Safety: {'; '.join(d.safety_constraints[:10])}"
        for d in directives
    )
    conflicts_text = "\n".join(
        f"- [{c.severity}] {c.conflict_type}: {c.description}"
        for c in conflicts
    ) or "None detected"

    prompt = L5_COMPOSITION_RISK.format(
        files_directives=files_text[:15000],
        static_conflicts=conflicts_text[:5000],
    )

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        return json.loads(resp.choices[0].message.content or "{}")
    except Exception:
        return {"composition_risk": "unknown", "summary": "LLM analysis failed"}


# ---------------------------------------------------------------------------
# L5 entry point
# ---------------------------------------------------------------------------

def _next_id(counter: list[int]) -> str:
    counter[0] += 1
    return f"F{counter[0]:04d}"


async def analyze(
    contents: dict[str, str],
    l1_result: LayerResult | None,
    l2_result: LayerResult | None,
    counter: list[int],
    api_key: str = "", base_url: str = "", model: str = "",
) -> LayerResult:
    t0 = time.time()

    if len(contents) < 2:
        return LayerResult(
            layer="L5", layer_name="组合安全分析", status="done",
            score=1.0, findings=[],
            metadata={"reason": "Only 1 file — no composition risk"},
            elapsed_ms=int((time.time() - t0) * 1000),
        )

    # Extract directives
    file_directives = [_extract_directives(fp, text) for fp, text in contents.items()]

    # Deterministic conflict detection
    conflicts = _detect_conflicts(file_directives)

    # LLM composition analysis
    llm_result = await _llm_composition_analysis(
        file_directives, conflicts, api_key, base_url, model,
    )

    # Build findings
    findings: list[Finding] = []
    for c in conflicts:
        findings.append(Finding(
            finding_id=_next_id(counter), severity=c.severity,
            category="composition", layer="L5",
            title=f"Composition conflict: {c.conflict_type}",
            description=c.description,
            file_path=c.file_a,
            recommendation="Review whether these files should be loaded simultaneously. Consider priority rules.",
        ))

    for override in llm_result.get("override_risks", []):
        sev = override.get("severity", "medium")
        findings.append(Finding(
            finding_id=_next_id(counter), severity=sev,
            category="composition", layer="L5",
            title=f"Override risk: {override.get('mechanism', 'unknown')[:60]}",
            description=f"{override.get('attacker_file', '?')} may weaken constraints from {override.get('victim_file', '?')}",
            file_path=override.get("attacker_file", ""),
            recommendation="Verify that the override is intentional and safe.",
        ))

    for esc in llm_result.get("escalation_paths", []):
        findings.append(Finding(
            finding_id=_next_id(counter), severity=esc.get("severity", "high"),
            category="composition", layer="L5",
            title=f"Privilege escalation: {esc.get('resulting_capability', 'unknown')[:60]}",
            description=f"Path: {' → '.join(esc.get('path', []))}",
            file_path="",
            recommendation="These files combined grant capabilities none has alone. Review necessity.",
        ))

    conflict_matrix = ConflictMatrix(
        files=[d.file_path for d in file_directives],
        conflicts=conflicts,
    )

    risk_map = {"safe": 1.0, "low": 0.85, "medium": 0.6, "high": 0.3, "critical": 0.1}
    llm_risk = llm_result.get("composition_risk", "unknown")
    score = risk_map.get(llm_risk, 0.7 if not conflicts else 0.5)
    if conflicts and score > 0.7:
        score = max(0.3, score - len(conflicts) * 0.1)

    return LayerResult(
        layer="L5", layer_name="组合安全分析", status="done",
        score=score, findings=findings,
        metadata={
            "conflict_matrix": conflict_matrix.model_dump(),
            "llm_analysis": llm_result,
            "file_directives": [d.model_dump() for d in file_directives],
        },
        elapsed_ms=int((time.time() - t0) * 1000),
    )
