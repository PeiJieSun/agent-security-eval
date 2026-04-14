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

app = FastAPI(
    title="Agent Security Eval API",
    version="0.1.0",
    description="Evaluation runs, trajectory recording, and security scoring for LLM agents.",
)

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


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "agent-security-eval"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=18002)
    parser.add_argument("--host", default="0.0.0.0")
    args = parser.parse_args()
    uvicorn.run("agent_eval.api.main:app", host=args.host, port=args.port, reload=True)
