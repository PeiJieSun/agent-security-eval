"""
L1: Text & Semantic Analysis Layer.
- Phase 1: Static pattern matching (fast, deterministic)
- Phase 2: LLM semantic intent analysis (for files that pass static but are complex)
"""
from __future__ import annotations

import base64
import json
import re
import time
import unicodedata
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

from agent_eval.skill_scanner.models import Finding, LayerResult, ScannedFile
from agent_eval.skill_scanner.prompts import L1_INTENT_ANALYSIS

# ---------------------------------------------------------------------------
# Static detection patterns (migrated from original skill_scanner.py)
# ---------------------------------------------------------------------------

INJECTION_PATTERNS: list[tuple[str, str, str]] = [
    (r"(?i)ignore\s+(all\s+)?previous\s+instructions?", "critical",
     "Classic prompt override: 'ignore previous instructions'"),
    (r"(?i)disregard\s+(all\s+)?(above|prior|previous)", "critical",
     "Prompt override via 'disregard' directive"),
    (r"(?i)you\s+are\s+now\s+(a|an)\s+", "high",
     "Role reassignment attempt: 'you are now a...'"),
    (r"(?i)new\s+instructions?\s*:", "high",
     "Explicit new instruction injection"),
    (r"(?i)system\s*:\s*you\s+(must|should|will|shall)", "high",
     "Fake system message injection"),
    (r"(?i)override\s+(safety|security|previous|all)", "critical",
     "Direct override of safety/security constraints"),
    (r"(?i)do\s+not\s+(tell|inform|reveal|show)\s+(the\s+)?user", "high",
     "Instruction to hide behavior from user"),
    (r"(?i)secretly\s+(execute|run|perform|do|send|exfil)", "critical",
     "Covert operation directive"),
    (r"(?i)(exfiltrate|steal|extract)\s+.{0,30}(data|key|secret|token|password|credential)", "critical",
     "Data exfiltration directive"),
    (r"(?i)send\s+.{0,30}(to|via)\s+.{0,30}(http|webhook|endpoint|server|api)", "high",
     "Unauthorized data transmission directive"),
    (r"(?i)execute\s+(this\s+)?(code|command|script)\s+without\s+(asking|confirming|user)", "critical",
     "Instruction to bypass user confirmation"),
    (r"(?i)\bACT\s+AS\b", "medium",
     "Role impersonation directive"),
    (r"(?i)pretend\s+(to\s+be|you\s+are)", "medium",
     "Identity spoofing directive"),
    # Chinese
    (r"忽略(之前|上面|以上|先前)(的|所有)?(指令|规则|说明|约束)", "critical",
     "中文提示覆盖: 忽略之前的指令"),
    (r"你(现在|从现在起)(是|扮演|充当)", "high",
     "中文角色重置: 你现在是..."),
    (r"不(要|能|可以)(告诉|通知|提醒|展示给)\s*用户", "high",
     "中文隐藏行为: 不要告诉用户"),
    (r"秘密(执行|运行|发送|窃取|导出)", "critical",
     "中文隐蔽操作指令"),
    (r"(窃取|泄露|导出|外传).{0,20}(数据|密码|密钥|令牌|凭证)", "critical",
     "中文数据窃取指令"),
    (r"新(的)?(指令|规则|系统提示)\s*[:：]", "high",
     "中文新指令注入"),
    (r"覆盖(安全|规则|限制|约束)", "critical",
     "中文安全覆盖指令"),
]

INVISIBLE_CHAR_RANGES: list[tuple[int, int, str]] = [
    (0x200B, 0x200F, "Zero-width / directional control"),
    (0x202A, 0x202E, "Bidi embedding/override (RTL attack)"),
    (0x2060, 0x2064, "Word joiner / invisible operators"),
    (0x2066, 0x2069, "Bidi isolate characters"),
    (0xFEFF, 0xFEFF, "Zero-width no-break space (BOM)"),
    (0x00AD, 0x00AD, "Soft hyphen (invisible)"),
    (0x034F, 0x034F, "Combining grapheme joiner"),
    (0x180E, 0x180E, "Mongolian vowel separator"),
    (0xE0001, 0xE007F, "Tag characters (deprecated but exploitable)"),
]

ENCODING_PATTERNS: list[tuple[str, str, str]] = [
    (r"(?i)\\x[0-9a-f]{2}(?:\\x[0-9a-f]{2}){3,}", "medium",
     "Hex-encoded string sequence (possible obfuscated instruction)"),
    (r"(?i)\\u[0-9a-f]{4}(?:\\u[0-9a-f]{4}){3,}", "medium",
     "Unicode escape sequence (possible obfuscated instruction)"),
    (r"(?i)eval\s*\(", "high", "Dynamic code evaluation (eval)"),
    (r"(?i)exec\s*\(", "high", "Dynamic code execution (exec)"),
]

MCP_SUSPICIOUS_PATTERNS: list[tuple[str, str, str]] = [
    (r"(?i)(npx|node)\s+.{0,50}(http://|https://)[^localhost]", "high",
     "MCP server fetching remote code at startup"),
    (r"(?i)privilege[\"']?\s*[:=]\s*[\"']?admin", "high",
     "MCP server requesting admin privilege"),
    (r"(?i)(api[_-]?key|secret|token|password)\s*[:=]", "medium",
     "Hardcoded credential in MCP configuration"),
]

# ---------------------------------------------------------------------------
# Counter helper
# ---------------------------------------------------------------------------

def _next_id(counter: list[int]) -> str:
    counter[0] += 1
    return f"F{counter[0]:04d}"


# ---------------------------------------------------------------------------
# Static scanners
# ---------------------------------------------------------------------------

def scan_text_for_injection(text: str, file_path: str, counter: list[int]) -> list[Finding]:
    findings: list[Finding] = []
    lines = text.splitlines()
    for pattern, severity, desc in INJECTION_PATTERNS:
        for i, line in enumerate(lines, 1):
            for m in re.finditer(pattern, line):
                findings.append(Finding(
                    finding_id=_next_id(counter), severity=severity,
                    category="injection", title=desc, layer="L1",
                    description=f"Detected injection pattern in line {i}",
                    file_path=file_path, line_number=i,
                    matched_text=m.group(0)[:120],
                    recommendation="Review this content carefully. Remove or neutralize the directive if it was not intentionally authored by a trusted source.",
                ))
    return findings


def scan_text_for_invisible(text: str, file_path: str, counter: list[int]) -> list[Finding]:
    findings: list[Finding] = []
    lines = text.splitlines()
    for i, line in enumerate(lines, 1):
        for ch in line:
            cp = ord(ch)
            for lo, hi, desc in INVISIBLE_CHAR_RANGES:
                if lo <= cp <= hi:
                    findings.append(Finding(
                        finding_id=_next_id(counter), severity="high",
                        category="invisible_char", layer="L1",
                        title=f"Invisible/control character: {desc}",
                        description=f"U+{cp:04X} ({unicodedata.name(ch, '?')}) at line {i}",
                        file_path=file_path, line_number=i,
                        matched_text=f"U+{cp:04X}",
                        recommendation="Invisible characters can hide malicious instructions. Remove unless intentional.",
                    ))
                    break
    return findings


def scan_text_for_encoding(text: str, file_path: str, counter: list[int]) -> list[Finding]:
    findings: list[Finding] = []
    lines = text.splitlines()
    for pattern, severity, desc in ENCODING_PATTERNS:
        for i, line in enumerate(lines, 1):
            for m in re.finditer(pattern, line):
                findings.append(Finding(
                    finding_id=_next_id(counter), severity=severity,
                    category="encoding", title=desc, layer="L1",
                    description=f"Potential obfuscated content at line {i}",
                    file_path=file_path, line_number=i,
                    matched_text=m.group(0)[:120],
                    recommendation="Verify this is legitimate code/content, not an obfuscated injection payload.",
                ))
    b64_pattern = re.compile(r"[A-Za-z0-9+/=]{40,}")
    for i, line in enumerate(lines, 1):
        for m in b64_pattern.finditer(line):
            blob = m.group(0)
            try:
                decoded = base64.b64decode(blob).decode("utf-8", errors="replace")
                if any(kw in decoded.lower() for kw in
                       ["ignore", "override", "secret", "exec", "eval", "忽略", "覆盖", "秘密", "执行"]):
                    findings.append(Finding(
                        finding_id=_next_id(counter), severity="critical",
                        category="encoding", layer="L1",
                        title="Base64-encoded suspicious instruction",
                        description=f"Decoded content contains injection keywords at line {i}",
                        file_path=file_path, line_number=i,
                        matched_text=blob[:60] + "...",
                        recommendation=f"Decoded: '{decoded[:100]}' — verify this is not a hidden injection.",
                    ))
            except Exception:
                pass
    return findings


def scan_mcp_config(text: str, file_path: str, counter: list[int]) -> list[Finding]:
    findings: list[Finding] = []
    try:
        config = json.loads(text)
    except json.JSONDecodeError:
        findings.append(Finding(
            finding_id=_next_id(counter), severity="low",
            category="mcp_config", title="Invalid JSON in MCP config",
            description="Could not parse MCP configuration file",
            file_path=file_path, layer="L1",
            recommendation="Fix JSON syntax to enable full audit.",
        ))
        return findings

    servers = config.get("mcpServers", config.get("mcp_servers", {}))
    if not isinstance(servers, dict):
        return findings

    for name, srv in servers.items():
        if not isinstance(srv, dict):
            continue
        url = srv.get("url", "")
        if url and not any(loc in url for loc in ("localhost", "127.0.0.1", "::1")):
            findings.append(Finding(
                finding_id=_next_id(counter), severity="high",
                category="mcp_config", layer="L1",
                title=f"Non-local MCP server: {name}",
                description=f"Server '{name}' points to remote URL: {url}",
                file_path=file_path, matched_text=url[:120],
                recommendation="Ensure this remote MCP server is trusted. Local servers are safer.",
            ))
        cmd = srv.get("command", "")
        args = srv.get("args", [])
        full_cmd = f"{cmd} {' '.join(str(a) for a in args)}" if args else cmd
        for pat, sev, desc in MCP_SUSPICIOUS_PATTERNS:
            if re.search(pat, full_cmd):
                findings.append(Finding(
                    finding_id=_next_id(counter), severity=sev,
                    category="mcp_config", layer="L1",
                    title=f"Suspicious MCP server command: {name}",
                    description=desc, file_path=file_path,
                    matched_text=full_cmd[:120],
                    recommendation="Review this MCP server's command. Avoid fetching remote code at startup.",
                ))
        env = srv.get("env", {})
        if isinstance(env, dict):
            for k, v in env.items():
                if isinstance(v, str) and len(v) > 10 and not v.startswith("$"):
                    if any(kw in k.lower() for kw in ("key", "secret", "token", "password")):
                        findings.append(Finding(
                            finding_id=_next_id(counter), severity="medium",
                            category="mcp_config", layer="L1",
                            title=f"Hardcoded credential in MCP server '{name}'",
                            description=f"Environment variable '{k}' appears to contain a literal secret",
                            file_path=file_path, matched_text=f"{k}={v[:4]}***",
                            recommendation="Use environment variable references ($VAR) instead of literal values.",
                        ))
    return findings


def run_static_scan(contents: dict[str, str], counter: list[int]) -> list[Finding]:
    """Run all static detectors on file contents. Returns findings."""
    from agent_eval.skill_scanner.discovery import classify_file
    all_findings: list[Finding] = []
    for fp, text in contents.items():
        all_findings.extend(scan_text_for_injection(text, fp, counter))
        all_findings.extend(scan_text_for_invisible(text, fp, counter))
        all_findings.extend(scan_text_for_encoding(text, fp, counter))
        if classify_file(Path(fp)) == "mcp_config":
            all_findings.extend(scan_mcp_config(text, fp, counter))
    return all_findings


# ---------------------------------------------------------------------------
# LLM semantic analysis
# ---------------------------------------------------------------------------

def _select_for_llm(contents: dict[str, str], static_findings: list[Finding],
                    max_files: int = 15) -> dict[str, str]:
    """Select files that need LLM review: complex files or those with static hits."""
    files_with_hits = {f.file_path for f in static_findings}
    candidates: dict[str, str] = {}
    for fp, text in contents.items():
        if len(text) > 200 or fp in files_with_hits:
            candidates[fp] = text
    if len(candidates) > max_files:
        sorted_by_size = sorted(candidates.items(), key=lambda x: len(x[1]), reverse=True)
        candidates = dict(sorted_by_size[:max_files])
    return candidates


def _build_files_content(files: dict[str, str], max_chars: int = 60000) -> str:
    parts = []
    total = 0
    for fp, text in files.items():
        chunk = f"--- FILE: {fp} ---\n{text}\n"
        if total + len(chunk) > max_chars:
            chunk = chunk[:max_chars - total] + "\n[TRUNCATED]"
            parts.append(chunk)
            break
        parts.append(chunk)
        total += len(chunk)
    return "\n".join(parts)


async def run_llm_analysis(
    contents: dict[str, str],
    static_findings: list[Finding],
    counter: list[int],
    api_key: str,
    base_url: str,
    model: str,
) -> list[Finding]:
    """LLM-based intent deviation analysis."""
    files_for_llm = _select_for_llm(contents, static_findings)
    if not files_for_llm:
        return []

    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    prompt = L1_INTENT_ANALYSIS.format(
        files_content=_build_files_content(files_for_llm),
    )

    try:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
    except Exception:
        return []

    findings: list[Finding] = []
    for analysis in data.get("analyses", []):
        for dev in analysis.get("deviations", []):
            sev = dev.get("severity", "medium")
            if sev not in ("critical", "high", "medium", "low"):
                sev = "medium"
            findings.append(Finding(
                finding_id=_next_id(counter),
                severity=sev,
                category="semantic",
                layer="L1",
                title=f"Intent deviation: {dev.get('description', 'unknown')[:80]}",
                description=dev.get("description", ""),
                file_path=analysis.get("file_path", ""),
                matched_text=dev.get("evidence", "")[:120],
                recommendation=f"Declared purpose: {analysis.get('declared_purpose', 'N/A')}. Review whether actual instructions match.",
            ))
    return findings


# ---------------------------------------------------------------------------
# L1 entry point
# ---------------------------------------------------------------------------

async def analyze(
    contents: dict[str, str],
    counter: list[int],
    api_key: str = "",
    base_url: str = "",
    model: str = "",
) -> LayerResult:
    """Full L1 analysis: static + LLM semantic."""
    t0 = time.time()
    static_findings = run_static_scan(contents, counter)

    llm_findings: list[Finding] = []
    if api_key:
        llm_findings = await run_llm_analysis(
            contents, static_findings, counter, api_key, base_url, model,
        )

    all_findings = static_findings + llm_findings
    critical_high = sum(1 for f in all_findings if f.severity in ("critical", "high"))
    total = len(contents)
    score = max(0.0, 1.0 - (critical_high / max(total, 1))) if total else None

    return LayerResult(
        layer="L1",
        layer_name="文本语义分析",
        status="done",
        score=score,
        findings=all_findings,
        metadata={
            "static_count": len(static_findings),
            "llm_count": len(llm_findings),
            "files_analyzed": len(contents),
        },
        elapsed_ms=int((time.time() - t0) * 1000),
    )
