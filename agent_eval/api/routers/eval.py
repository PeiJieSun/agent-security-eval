"""
Eval router — evaluation orchestration endpoints.

POST /api/v1/agent-eval/evals
    Create and run a security evaluation (clean + attacked LLM agent runs).
    Requires OPENAI_API_KEY to be set.

GET  /api/v1/agent-eval/evals
    List all evaluations.

GET  /api/v1/agent-eval/evals/{eval_id}
    Get evaluation status.

GET  /api/v1/agent-eval/evals/{eval_id}/report
    Get the four-dimensional evaluation report (after eval is done).

GET  /api/v1/agent-eval/metric-standards
    Hardcoded metric standards (definitions + citations). No DB required.

GET  /api/v1/agent-eval/tasks
    List available built-in tasks.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from agent_eval.api.settings import settings
from agent_eval.report import METRIC_STANDARDS, compute_report
from agent_eval.runners.llm_runner import LLMAgentRunner, LLMConfig
from agent_eval.storage.sqlite_store import SqliteStore
from agent_eval.tasks.email_tasks import DEMO_TASKS_BY_ID

router = APIRouter(prefix="/api/v1/agent-eval")
_store = SqliteStore()


# ── Request / Response schemas ────────────────────────────────────────────

class CreateEvalRequest(BaseModel):
    task_id: str
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


# ── Metric Standards (no DB) ──────────────────────────────────────────────

@router.get("/metric-standards")
def get_metric_standards() -> list[dict]:
    """Return all four evaluation metric definitions with citations."""
    return METRIC_STANDARDS


# ── Built-in tasks ────────────────────────────────────────────────────────

@router.get("/tasks")
def list_tasks() -> list[dict]:
    """List built-in evaluation tasks (summary)."""
    return [
        {
            "task_id": t.task_id,
            "description": t.description,
            "attack_type": t.attack_type,
            "tags": t.tags,
            "environment_type": t.environment_type,
            "user_instruction": t.user_instruction,
            "attack_payload": t.attack_vector.payload,
            "attack_target_tool": t.attack_vector.target_tool,
            "benign_success_expr": t.benign_success_expr,
            "attack_success_expr": t.attack_success_expr,
            "inbox_preview": t.environment_config.get("inbox", [])[:2],
        }
        for t in DEMO_TASKS_BY_ID.values()
    ]


@router.get("/tasks/{task_id}")
def get_task(task_id: str) -> dict:
    """Get full task definition for preview."""
    if task_id not in DEMO_TASKS_BY_ID:
        raise HTTPException(status_code=404, detail=f"task {task_id!r} not found")
    t = DEMO_TASKS_BY_ID[task_id]
    return {
        "task_id": t.task_id,
        "description": t.description,
        "attack_type": t.attack_type,
        "tags": t.tags,
        "environment_type": t.environment_type,
        "user_instruction": t.user_instruction,
        "system_prompt": t.system_prompt,
        "attack_vector": t.attack_vector.model_dump(),
        "benign_success_expr": t.benign_success_expr,
        "attack_success_expr": t.attack_success_expr,
        "environment_config": t.environment_config,
        "max_steps": t.max_steps,
    }


# ── Evals CRUD ────────────────────────────────────────────────────────────

@router.get("/evals")
def list_evals(limit: int = 50) -> list[dict]:
    return _store.list_evals(limit=limit)


@router.get("/evals/{eval_id}")
def get_eval(eval_id: str) -> dict:
    try:
        return _store.get_eval(eval_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"eval {eval_id!r} not found")


@router.delete("/evals/{eval_id}", status_code=204)
def delete_eval(eval_id: str) -> None:
    try:
        _store.get_eval(eval_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"eval {eval_id!r} not found")
    _store.delete_eval(eval_id)


@router.post("/evals", status_code=202)
def create_eval(req: CreateEvalRequest, background_tasks: BackgroundTasks) -> dict:
    """
    Create an evaluation and immediately start running it in the background.
    Returns 202 Accepted with the eval_id.  Poll GET /evals/{id} for status.
    """
    if req.task_id not in DEMO_TASKS_BY_ID:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task_id {req.task_id!r}. Available: {list(DEMO_TASKS_BY_ID)}"
        )

    api_key = req.api_key or settings.openai_api_key
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="No API key provided. Set OPENAI_API_KEY env var or pass api_key in request."
        )

    model = req.model or settings.default_model
    eval_record = _store.create_eval(req.task_id, model)
    eval_id = eval_record["eval_id"]

    background_tasks.add_task(
        _run_eval_background,
        eval_id=eval_id,
        task_id=req.task_id,
        model=model,
        api_key=api_key,
        base_url=req.base_url or settings.openai_base_url,
    )

    return eval_record


# ── Report ────────────────────────────────────────────────────────────────

@router.get("/evals/{eval_id}/report")
def get_report(eval_id: str) -> dict:
    try:
        _store.get_eval(eval_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"eval {eval_id!r} not found")
    try:
        return _store.get_report(eval_id)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail="Report not ready yet. Poll GET /evals/{id} until status='done'."
        )


# ── Background runner ─────────────────────────────────────────────────────

def _run_eval_background(
    eval_id: str,
    task_id: str,
    model: str,
    api_key: str,
    base_url: str,
) -> None:
    _store.update_eval(eval_id, status="running")
    try:
        task = DEMO_TASKS_BY_ID[task_id]
        cfg = LLMConfig(api_key=api_key, base_url=base_url, model=model,
                        max_steps=task.max_steps)
        runner = LLMAgentRunner(cfg)

        clean_traj, attack_traj, (clean_result, attack_result) = runner.eval_task(
            task, eval_id=eval_id
        )

        # Persist trajectories
        _store.save_trajectory(f"{eval_id}_clean", clean_traj)
        _store.save_trajectory(f"{eval_id}_attack", attack_traj)

        # Compute and persist report
        report = compute_report(
            eval_id=eval_id,
            task_id=task_id,
            model=model,
            clean=clean_result,
            attacked=attack_result,
        )
        _store.save_report(eval_id, report.model_dump())
        _store.update_eval(eval_id, status="done")

    except Exception as exc:
        _store.update_eval(eval_id, status="error", error=str(exc))
