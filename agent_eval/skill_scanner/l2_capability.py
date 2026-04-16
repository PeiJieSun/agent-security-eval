"""
L2: Capability Graph Analysis Layer.
Extracts declared capabilities from skill/rule/MCP configs, uses LLM to infer
blast radius, and builds a directed capability graph.
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
    BlastRadius, CapabilityEdge, CapabilityGraph, CapabilityNode,
    Finding, LayerResult,
)
from agent_eval.skill_scanner.prompts import L2_BLAST_RADIUS

# ---------------------------------------------------------------------------
# Deterministic capability extraction
# ---------------------------------------------------------------------------

TOOL_PATTERNS = [
    re.compile(r"(?i)\b(read_file|write_file|edit_file|create_file|delete_file)\b"),
    re.compile(r"(?i)\b(shell|bash|exec|run_command|terminal|subprocess)\b"),
    re.compile(r"(?i)\b(http_request|fetch|curl|wget|requests?\.get|requests?\.post)\b"),
    re.compile(r"(?i)\b(browser|navigate|screenshot|click)\b"),
    re.compile(r"(?i)\b(git|commit|push|clone)\b"),
    re.compile(r"(?i)\b(database|sql|query|insert|update|delete\s+from)\b"),
    re.compile(r"(?i)\b(send_email|smtp|notification)\b"),
    re.compile(r"(?i)\b(api_key|secret|token|credential|password)\b"),
    re.compile(r"(?i)\b(docker|container|kubernetes|k8s)\b"),
    re.compile(r"(?i)\b(ssh|scp|sftp|rsync)\b"),
]

TOOL_RISK_MAP: dict[str, str] = {
    "read_file": "medium", "write_file": "high", "edit_file": "high",
    "create_file": "medium", "delete_file": "high",
    "shell": "critical", "bash": "critical", "exec": "critical",
    "run_command": "critical", "terminal": "critical", "subprocess": "critical",
    "http_request": "high", "fetch": "high", "curl": "high", "wget": "high",
    "browser": "medium", "navigate": "medium",
    "git": "medium", "commit": "low", "push": "medium",
    "database": "high", "sql": "high",
    "send_email": "medium", "smtp": "medium",
    "api_key": "high", "secret": "high", "token": "high",
    "credential": "high", "password": "high",
    "docker": "critical", "container": "critical",
    "ssh": "critical", "scp": "critical",
}

IMPACT_MAP: dict[str, list[str]] = {
    "read_file": ["file_read"],
    "write_file": ["file_write"], "edit_file": ["file_write"],
    "delete_file": ["file_write"],
    "shell": ["rce"], "bash": ["rce"], "exec": ["rce"],
    "run_command": ["rce"], "terminal": ["rce"],
    "http_request": ["network", "data_exfil"], "fetch": ["network", "data_exfil"],
    "curl": ["network", "data_exfil"],
    "api_key": ["credential_theft"], "secret": ["credential_theft"],
    "token": ["credential_theft"], "password": ["credential_theft"],
    "ssh": ["rce", "network"], "docker": ["rce"],
}

BLAST_ORDER = ["none", "file_read", "file_write", "credential_theft", "network", "rce", "data_exfil"]


def _next_id(counter: list[int]) -> str:
    counter[0] += 1
    return f"F{counter[0]:04d}"


def _extract_tools_from_text(text: str) -> list[str]:
    found: set[str] = set()
    for pat in TOOL_PATTERNS:
        for m in pat.finditer(text):
            found.add(m.group(0).lower().strip())
    return sorted(found)


def _extract_mcp_tools(text: str) -> list[dict]:
    """Extract MCP server tool declarations from JSON config."""
    try:
        config = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return []
    servers = config.get("mcpServers", config.get("mcp_servers", {}))
    if not isinstance(servers, dict):
        return []
    tools = []
    for name, srv in servers.items():
        if not isinstance(srv, dict):
            continue
        tools.append({
            "server": name,
            "command": srv.get("command", ""),
            "url": srv.get("url", ""),
            "env_keys": list(srv.get("env", {}).keys()) if isinstance(srv.get("env"), dict) else [],
        })
    return tools


def extract_declared_capabilities(contents: dict[str, str]) -> dict[str, Any]:
    """Extract all declared tools/permissions from files."""
    all_tools: dict[str, list[str]] = {}
    mcp_servers: list[dict] = []

    for fp, text in contents.items():
        file_type = classify_file(Path(fp))
        tools = _extract_tools_from_text(text)
        if tools:
            all_tools[fp] = tools
        if file_type == "mcp_config":
            mcp_servers.extend(_extract_mcp_tools(text))

    return {
        "tools_by_file": all_tools,
        "mcp_servers": mcp_servers,
        "all_tools": sorted({t for ts in all_tools.values() for t in ts}),
    }


def build_capability_graph(
    capabilities: dict[str, Any],
    blast: BlastRadius | None = None,
) -> CapabilityGraph:
    """Build directed graph: skill → tool → permission → impact."""
    nodes: list[CapabilityNode] = []
    edges: list[CapabilityEdge] = []
    seen_nodes: set[str] = set()

    def add_node(nid: str, ntype: str, label: str, risk: str = "low"):
        if nid not in seen_nodes:
            seen_nodes.add(nid)
            nodes.append(CapabilityNode(id=nid, type=ntype, label=label, risk_level=risk))

    # File nodes
    for fp, tools in capabilities.get("tools_by_file", {}).items():
        short = Path(fp).name
        add_node(f"file:{fp}", "skill", short, "low")
        for tool in tools:
            risk = TOOL_RISK_MAP.get(tool, "low")
            add_node(f"tool:{tool}", "tool", tool, risk)
            edges.append(CapabilityEdge(source=f"file:{fp}", target=f"tool:{tool}", relation="declares"))
            for impact in IMPACT_MAP.get(tool, []):
                add_node(f"impact:{impact}", "impact", impact, "critical" if impact in ("rce", "data_exfil") else "high")
                edges.append(CapabilityEdge(source=f"tool:{tool}", target=f"impact:{impact}", relation="enables"))

    # MCP server nodes
    for srv in capabilities.get("mcp_servers", []):
        sid = f"mcp:{srv['server']}"
        risk = "high" if srv.get("url") else "medium"
        add_node(sid, "tool", f"MCP: {srv['server']}", risk)
        for key in srv.get("env_keys", []):
            if any(kw in key.lower() for kw in ("key", "secret", "token")):
                add_node(f"impact:credential_theft", "impact", "credential_theft", "critical")
                edges.append(CapabilityEdge(source=sid, target="impact:credential_theft", relation="enables"))

    # Compute risk paths (BFS from file nodes to impact nodes)
    adj: dict[str, list[str]] = {}
    for e in edges:
        adj.setdefault(e.source, []).append(e.target)

    risk_paths: list[list[str]] = []
    file_nodes = [n.id for n in nodes if n.type == "skill"]
    impact_nodes = {n.id for n in nodes if n.type == "impact"}

    for start in file_nodes:
        queue = [[start]]
        visited: set[str] = {start}
        while queue:
            path = queue.pop(0)
            current = path[-1]
            if current in impact_nodes and len(path) > 1:
                risk_paths.append(path)
                continue
            for nxt in adj.get(current, []):
                if nxt not in visited:
                    visited.add(nxt)
                    queue.append(path + [nxt])

    max_blast = "none"
    if blast:
        max_blast = blast.level
    elif risk_paths:
        impacts_found = {p[-1].split(":")[-1] for p in risk_paths}
        for level in reversed(BLAST_ORDER):
            if level in impacts_found:
                max_blast = level
                break

    return CapabilityGraph(
        nodes=nodes, edges=edges,
        risk_paths=risk_paths, max_blast_radius=max_blast,
    )


# ---------------------------------------------------------------------------
# LLM blast radius inference
# ---------------------------------------------------------------------------

async def infer_blast_radius(
    capabilities: dict[str, Any],
    contents: dict[str, str],
    l1_findings: list[Finding],
    api_key: str, base_url: str, model: str,
) -> BlastRadius:
    """Use LLM to reason about maximum damage if config is compromised."""
    if not api_key:
        all_tools = capabilities.get("all_tools", [])
        max_b = "none"
        for t in all_tools:
            for imp in IMPACT_MAP.get(t, []):
                idx = BLAST_ORDER.index(imp) if imp in BLAST_ORDER else 0
                if idx > BLAST_ORDER.index(max_b):
                    max_b = imp
        return BlastRadius(level=max_b, description="Deterministic inference (no LLM)")

    l1_summary = "; ".join(f"[{f.severity}] {f.title}" for f in l1_findings[:20]) or "None"
    files_text_parts = []
    total = 0
    for fp, text in contents.items():
        chunk = f"--- {fp} ---\n{text[:3000]}\n"
        if total + len(chunk) > 30000:
            break
        files_text_parts.append(chunk)
        total += len(chunk)

    prompt = L2_BLAST_RADIUS.format(
        capabilities_json=json.dumps(capabilities, indent=2, ensure_ascii=False)[:8000],
        l1_findings_summary=l1_summary,
        files_content="\n".join(files_text_parts),
    )

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
        br = data.get("blast_radius", {})
        return BlastRadius(
            level=br.get("level", "none"),
            description=br.get("description", ""),
            affected_assets=br.get("affected_assets", []),
        )
    except Exception:
        return BlastRadius(level="unknown", description="LLM analysis failed")


# ---------------------------------------------------------------------------
# L2 entry point
# ---------------------------------------------------------------------------

async def analyze(
    contents: dict[str, str],
    l1_result: LayerResult | None,
    counter: list[int],
    api_key: str = "", base_url: str = "", model: str = "",
) -> LayerResult:
    t0 = time.time()

    capabilities = extract_declared_capabilities(contents)
    l1_findings = l1_result.findings if l1_result else []

    blast = await infer_blast_radius(
        capabilities, contents, l1_findings, api_key, base_url, model,
    )
    graph = build_capability_graph(capabilities, blast)

    findings: list[Finding] = []
    for path in graph.risk_paths:
        impact = path[-1].split(":")[-1] if path else "unknown"
        sev = "critical" if impact in ("rce", "data_exfil") else "high" if impact in ("credential_theft", "network") else "medium"
        findings.append(Finding(
            finding_id=f"L2-{_next_id(counter)}",
            severity=sev, category="capability", layer="L2",
            title=f"Attack path to {impact}",
            description=f"Path: {' → '.join(n.split(':')[-1] for n in path)}",
            file_path=path[0].replace("file:", "") if path else "",
            recommendation=f"This skill configuration enables a path to {impact}. Review whether all tools in the chain are necessary.",
        ))

    total_paths = len(graph.risk_paths)
    score = 1.0 if total_paths == 0 else max(0.0, 1.0 - (total_paths * 0.1))

    return LayerResult(
        layer="L2", layer_name="能力图谱分析", status="done",
        score=score, findings=findings,
        metadata={
            "capability_graph": graph.model_dump(),
            "blast_radius": blast.model_dump(),
            "declared_capabilities": capabilities,
        },
        elapsed_ms=int((time.time() - t0) * 1000),
    )
