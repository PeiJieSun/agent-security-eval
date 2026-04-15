"""
Agent Security Eval — FastAPI service.

Run
---
    python -m agent_eval.api.main            # port 18002
    python -m agent_eval.api.main --port 18003
"""
from __future__ import annotations

import argparse

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent_eval.api.routers import trajectories
from agent_eval.api.routers import eval as eval_router
from agent_eval.api.routers import safety_evals as safety_router
from agent_eval.api.routers import mcp_eval as mcp_router
from agent_eval.api.routers import sandbox as sandbox_router
from agent_eval.api.routers import report as report_router
from agent_eval.api.routers import verticals as verticals_router
from agent_eval.api.routers import framework_fp as fp_router
from agent_eval.api.routers import delta_audit as delta_router
from agent_eval.api.routers import defense as defense_router
from agent_eval.api.routers import compliance as compliance_router
from agent_eval.api.routers import taint as taint_router
from agent_eval.api.routers import source_audit as audit_router
from agent_eval.api.routers import deep_analysis as deep_router
from agent_eval.api.routers import formal as formal_router
from agent_eval.storage.sqlite_store import SqliteStore

app = FastAPI(
    title="Agent Security Eval API",
    version="0.1.0",
    description="Evaluation runs, trajectory recording, and security scoring for LLM agents.",
)


@app.on_event("startup")
def _cleanup_stale_batches() -> None:
    """Mark any batch still marked 'running' in DB as interrupted (thread was killed by restart)."""
    store = SqliteStore()
    for batch in store.list_batches(limit=100):
        if batch["status"] == "running":
            store.update_batch(batch["batch_id"], status="interrupted")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trajectories.router)
app.include_router(eval_router.router)
app.include_router(safety_router.router)
app.include_router(mcp_router.router)
app.include_router(sandbox_router.router)
app.include_router(report_router.router)
app.include_router(verticals_router.router)
app.include_router(fp_router.router)
app.include_router(delta_router.router)
app.include_router(defense_router.router)
app.include_router(compliance_router.router)
app.include_router(audit_router.router)
app.include_router(taint_router.router)
app.include_router(deep_router.router)
app.include_router(formal_router.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "agent-security-eval"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18002)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()
    uvicorn.run("agent_eval.api.main:app", host=args.host, port=args.port, reload=True)
