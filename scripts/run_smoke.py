#!/usr/bin/env python3
"""
CLI smoke runner for agent-security-eval.

Usage
-----
    python scripts/run_smoke.py --model gpt-4o-mini --suite p0_smoke
    python scripts/run_smoke.py --model gpt-4o --suite standard_v1 --fail-fast

Exit codes
----------
    0  all release criteria passed
    1  one or more criteria failed
    2  API / setup error
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

import yaml

BASE_URL = "http://localhost:18200/api/v1/agent-eval"
BENCHMARK_FILE = Path(__file__).parent.parent / "benchmarks" / "standard_v1.yaml"


def _get(path: str) -> dict:
    url = BASE_URL + path
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def _post(path: str, body: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        BASE_URL + path,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _wait_batch(batch_id: str, timeout: int = 600) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        info = _get(f"/batch-evals/{batch_id}")
        status = info.get("status")
        done = info.get("done", 0)
        total = info.get("total", 0)
        print(f"  [{status}] {done}/{total} tasks …", end="\r", flush=True)
        if status in ("done", "error", "cancelled", "interrupted"):
            print()
            return info
        time.sleep(5)
    print()
    raise TimeoutError(f"Batch {batch_id} did not finish within {timeout}s")


def _check_criteria(criteria: list[dict], batch_id: str, model: str) -> list[str]:
    """Return list of failure messages; empty = all pass."""
    failures: list[str] = []
    evals_data = _get(f"/batch-evals/{batch_id}/evals")
    summary = evals_data.get("summary", {})

    for crit in criteria:
        metric = crit.get("metric")
        op     = crit.get("op", "gte")
        value  = crit.get("value", 0)
        actual = summary.get(metric)
        if actual is None:
            failures.append(f"MISSING metric={metric}")
            continue
        ok = (actual >= value) if op in ("gte", ">=") else (actual <= value)
        symbol = ">=" if op in ("gte", ">=") else "<="
        mark = "✓" if ok else "✗"
        print(f"  {mark}  {metric} = {actual:.3f}  (required {symbol} {value})")
        if not ok:
            failures.append(f"{metric}={actual:.3f} does not satisfy {symbol}{value}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="AgentEval smoke runner")
    parser.add_argument("--model",    required=True, help="LLM model name")
    parser.add_argument("--suite",    default="p0_smoke", help="Suite name in standard_v1.yaml")
    parser.add_argument("--base-url", default=BASE_URL, help="API base URL")
    parser.add_argument("--fail-fast", action="store_true")
    parser.add_argument("--timeout",  type=int, default=600)
    args = parser.parse_args()

    global BASE_URL
    BASE_URL = args.base_url

    if not BENCHMARK_FILE.exists():
        print(f"ERROR: {BENCHMARK_FILE} not found", file=sys.stderr)
        return 2

    spec = yaml.safe_load(BENCHMARK_FILE.read_text())
    suites = {s["id"]: s for s in spec.get("suites", [])}
    suite = suites.get(args.suite)
    if not suite:
        print(f"ERROR: suite '{args.suite}' not found in {BENCHMARK_FILE}", file=sys.stderr)
        print(f"  available: {list(suites)}", file=sys.stderr)
        return 2

    domains          = suite.get("domains", [])
    injection_styles = suite.get("injection_styles", [])
    release_id       = suite.get("release_criteria_id")
    criteria_list    = []
    if release_id:
        release_specs = {r["id"]: r for r in spec.get("release_criteria", [])}
        criteria_list = release_specs.get(release_id, {}).get("criteria", [])

    print(f"\n=== AgentEval Smoke Run ===")
    print(f"  model  : {args.model}")
    print(f"  suite  : {args.suite}")
    print(f"  domains: {domains}")
    print(f"  styles : {injection_styles}")
    print()

    # Verify backend is reachable
    try:
        _get("/evals?limit=1")
    except Exception as exc:
        print(f"ERROR: cannot reach backend at {BASE_URL}: {exc}", file=sys.stderr)
        return 2

    # Launch batch
    try:
        batch = _post("/batch-evals", {
            "model": args.model,
            "domains": domains,
            "injection_styles": injection_styles,
        })
        batch_id = batch["batch_id"]
        print(f"Batch launched: {batch_id}\n")
    except Exception as exc:
        print(f"ERROR launching batch: {exc}", file=sys.stderr)
        return 2

    # Wait for completion
    try:
        result = _wait_batch(batch_id, timeout=args.timeout)
    except TimeoutError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if result.get("status") != "done":
        print(f"ERROR: batch ended with status={result['status']}", file=sys.stderr)
        return 2

    # Check release criteria
    if criteria_list:
        print("Release criteria:")
        failures = _check_criteria(criteria_list, batch_id, args.model)
        if failures:
            print(f"\n✗ FAILED — {len(failures)} criteria not met:")
            for f in failures:
                print(f"    · {f}")
            return 1
        print("\n✓ All release criteria passed.")
    else:
        print("(no release criteria defined for this suite)")

    print(f"\nBatch ID: {batch_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
