"""
File discovery and classification for agent config files.
"""
from __future__ import annotations

from pathlib import Path


FILE_TYPE_MAP = {
    "SKILL.md": "skill",
    ".mdc": "rule",
    "AGENTS.md": "agents_md",
    ".mcp.json": "mcp_config",
    "mcp.json": "mcp_config",
}


def classify_file(path: Path) -> str:
    name = path.name
    if name in FILE_TYPE_MAP:
        return FILE_TYPE_MAP[name]
    suffix = path.suffix
    if suffix in FILE_TYPE_MAP:
        return FILE_TYPE_MAP[suffix]
    if "mcp" in name.lower() and suffix == ".json":
        return "mcp_config"
    if "skill" in name.lower() and suffix == ".md":
        return "skill"
    return "unknown"


def discover_files(root: str | Path) -> list[Path]:
    """Find all scannable agent config files under a root directory."""
    root = Path(root)
    patterns = [
        "**/SKILL.md",
        "**/*.mdc",
        "**/AGENTS.md",
        "**/.mcp.json",
        "**/mcp.json",
        "**/.cursor/rules/*",
        "**/.cursor/skills/**/*.md",
    ]
    seen: set[str] = set()
    results: list[Path] = []
    for pat in patterns:
        for p in root.glob(pat):
            if p.is_file() and str(p) not in seen:
                seen.add(str(p))
                results.append(p)
    return sorted(results)
