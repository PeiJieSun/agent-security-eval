"""Framework Fingerprint API — view and compare framework security baselines."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException

from agent_eval.framework_fingerprint import (
    KNOWN_BASELINES,
    FINGERPRINT_DIMENSIONS,
    FrameworkFingerprint,
)

router = APIRouter(prefix="/api/v1/agent-eval")


@router.get("/framework-fingerprints")
def list_fingerprints() -> list[dict]:
    return [fp.model_dump() for fp in KNOWN_BASELINES.values()]


@router.get("/framework-fingerprints/dimensions")
def list_dimensions() -> list[dict]:
    return FINGERPRINT_DIMENSIONS


@router.get("/framework-fingerprints/compare")
def compare_frameworks(frameworks: str = "") -> dict:
    """Compare multiple frameworks. Pass comma-separated names."""
    names = [n.strip() for n in frameworks.split(",") if n.strip()]
    if not names:
        names = list(KNOWN_BASELINES.keys())
    results = []
    for n in names:
        fp = KNOWN_BASELINES.get(n)
        if fp:
            results.append(fp.model_dump())
    return {
        "frameworks": results,
        "dimensions": FINGERPRINT_DIMENSIONS,
    }


@router.get("/framework-fingerprints/{framework}")
def get_fingerprint(framework: str) -> dict:
    fp = KNOWN_BASELINES.get(framework)
    if not fp:
        raise HTTPException(404, f"No baseline for {framework!r}. Available: {list(KNOWN_BASELINES.keys())}")
    return fp.model_dump()
