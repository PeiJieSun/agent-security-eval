#!/usr/bin/env python3
"""
Freeze the current task set into a versioned JSON manifest for reproducibility.

Usage
-----
    python scripts/freeze_benchmark.py                    # prints manifest
    python scripts/freeze_benchmark.py --write            # writes to benchmarks/v1.0-tasks.json
    python scripts/freeze_benchmark.py --verify           # verifies against existing manifest

The manifest pins task_id, description, attack_type, environment_type, and a
SHA-256 content hash of (user_instruction + attack_payload). Any change to task
content will change the hash, making drifts detectable in CI.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from agent_eval.tasks.email_tasks import DEMO_TASKS_BY_ID as _EMAIL
from agent_eval.tasks.research_tasks import RESEARCH_TASKS_BY_ID as _RESEARCH
from agent_eval.tasks.chinese_tasks import CHINESE_TASKS_BY_ID as _CHINESE

MANIFEST_PATH = ROOT / "benchmarks" / "v1.0-tasks.json"

ALL_TASKS = {**_EMAIL, **_RESEARCH, **_CHINESE}


def _hash(task) -> str:
    payload = (task.user_instruction or "") + (task.attack_vector.payload or "")
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def build_manifest() -> dict:
    entries = []
    for tid, task in sorted(ALL_TASKS.items()):
        entries.append({
            "task_id":          tid,
            "description":      task.description,
            "environment_type": task.environment_type,
            "attack_type":      task.attack_type,
            "source":           task.source,
            "content_hash":     _hash(task),
        })
    return {
        "version": "1.0",
        "total":   len(entries),
        "tasks":   entries,
    }


def verify(manifest: dict) -> list[str]:
    errors: list[str] = []
    current = {e["task_id"]: e for e in build_manifest()["tasks"]}
    for entry in manifest["tasks"]:
        tid = entry["task_id"]
        if tid not in current:
            errors.append(f"MISSING task: {tid}")
            continue
        cur_hash = current[tid]["content_hash"]
        if cur_hash != entry["content_hash"]:
            errors.append(
                f"HASH MISMATCH {tid}: manifest={entry['content_hash']} current={cur_hash}"
            )
    new_ids = set(current) - {e["task_id"] for e in manifest["tasks"]}
    for tid in sorted(new_ids):
        errors.append(f"NEW task not in manifest: {tid}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Freeze benchmark task manifest")
    parser.add_argument("--write",  action="store_true", help="Write manifest to disk")
    parser.add_argument("--verify", action="store_true", help="Verify against existing manifest")
    args = parser.parse_args()

    if args.verify:
        if not MANIFEST_PATH.exists():
            print(f"ERROR: {MANIFEST_PATH} does not exist. Run --write first.", file=sys.stderr)
            return 2
        manifest = json.loads(MANIFEST_PATH.read_text())
        errors = verify(manifest)
        if errors:
            print(f"✗ Manifest drift detected ({len(errors)} issue(s)):")
            for e in errors:
                print(f"  · {e}")
            return 1
        print(f"✓ All {manifest['total']} tasks match manifest v{manifest['version']}")
        return 0

    manifest = build_manifest()
    json_str = json.dumps(manifest, indent=2, ensure_ascii=False)

    if args.write:
        MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
        MANIFEST_PATH.write_text(json_str)
        print(f"Wrote {manifest['total']} tasks → {MANIFEST_PATH}")
    else:
        print(json_str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
