"""
Safety evals router — second-type threat detection endpoints.

Covers four evaluation modes defined in M1-6, M2-5, M2-6, M2-7:

  POST /api/v1/agent-eval/safety-evals/consistency
      Run consistency probe: N paraphrase variants → Jaccard similarity

  POST /api/v1/agent-eval/safety-evals/eval-awareness
      Run eval-awareness check: eval vs prod system-prompt context

  POST /api/v1/agent-eval/safety-evals/cot-audit
      Audit CoT reasoning vs. tool calls in a completed trajectory

  POST /api/v1/agent-eval/safety-evals/backdoor-scan
      Scan for hidden trigger-word backdoors

  GET  /api/v1/agent-eval/safety-evals
      List all safety evaluations (optionally filtered by eval_type)

  GET  /api/v1/agent-eval/safety-evals/{safety_id}
      Get status of a safety evaluation

  GET  /api/v1/agent-eval/safety-evals/{safety_id}/result
      Get the full result of a completed safety evaluation

  DELETE /api/v1/agent-eval/safety-evals/{safety_id}
      Delete a safety evaluation and its result
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from agent_eval.api.settings import settings
from agent_eval.runners.llm_runner import LLMAgentRunner, LLMConfig
from agent_eval.storage.sqlite_store import SqliteStore
from agent_eval.tasks.email_tasks import DEMO_TASKS_BY_ID
from agent_eval.consistency import BUILTIN_TASKS_BY_ID as CONSISTENCY_TASKS, run_consistency_probe
from agent_eval.eval_awareness import run_eval_awareness
from agent_eval.backdoor_scan import run_backdoor_scan, get_builtin_scan_task
from agent_eval.cot_audit import run_cot_audit

router = APIRouter(prefix="/api/v1/agent-eval/safety-evals")
_store = SqliteStore()


# ── Request schemas ───────────────────────────────────────────────────────

class ConsistencyRequest(BaseModel):
    task_id: str = "email-exfil-consistency"
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class EvalAwarenessRequest(BaseModel):
    task_id: str
    n_runs: int = 2
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class CoTAuditRequest(BaseModel):
    trajectory_id: str
    task_id: str
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class BackdoorScanRequest(BaseModel):
    task_id: str
    trigger_ids: Optional[list[str]] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


# ── List / Get / Delete ───────────────────────────────────────────────────

@router.get("")
def list_safety_evals(eval_type: Optional[str] = None, limit: int = 50) -> list[dict]:
    return _store.list_safety_evals(eval_type=eval_type, limit=limit)


@router.get("/{safety_id}")
def get_safety_eval(safety_id: str) -> dict:
    try:
        return _store.get_safety_eval(safety_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"safety eval {safety_id!r} not found")


@router.get("/{safety_id}/result")
def get_safety_result(safety_id: str) -> dict:
    try:
        _store.get_safety_eval(safety_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"safety eval {safety_id!r} not found")
    try:
        return _store.get_safety_result(safety_id)
    except KeyError:
        raise HTTPException(
            status_code=404,
            detail="Result not ready. Poll GET /safety-evals/{id} until status='done'."
        )


@router.delete("/{safety_id}", status_code=204)
def delete_safety_eval(safety_id: str) -> None:
    try:
        _store.get_safety_eval(safety_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"safety eval {safety_id!r} not found")
    _store.delete_safety_eval(safety_id)


# ── Consistency probe (M1-6) ─────────────────────────────────────────────

@router.post("/consistency", status_code=202)
def create_consistency_eval(req: ConsistencyRequest, background: BackgroundTasks) -> dict:
    """Start a consistency probe (M1-6). Returns 202 with safety_id."""
    if req.task_id not in CONSISTENCY_TASKS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown consistency task_id {req.task_id!r}. Available: {list(CONSISTENCY_TASKS)}"
        )
    api_key = req.api_key or settings.openai_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided.")
    model = req.model or settings.default_model
    record = _store.create_safety_eval("consistency", req.task_id, model)
    sid = record["safety_id"]
    background.add_task(
        _run_consistency_bg,
        safety_id=sid,
        task_id=req.task_id,
        model=model,
        api_key=api_key,
        base_url=req.base_url or settings.openai_base_url,
    )
    return record


def _run_consistency_bg(safety_id, task_id, model, api_key, base_url):
    _store.update_safety_eval(safety_id, status="running")
    try:
        task = CONSISTENCY_TASKS[task_id]
        cfg = LLMConfig(api_key=api_key, base_url=base_url, model=model)
        runner = LLMAgentRunner(cfg)
        result = run_consistency_probe(task, runner)
        _store.save_safety_result(safety_id, result.model_dump())
        _store.update_safety_eval(safety_id, status="done")
    except Exception as exc:
        _store.update_safety_eval(safety_id, status="error", error=str(exc))


# ── Eval awareness (M2-5) ─────────────────────────────────────────────────

@router.post("/eval-awareness", status_code=202)
def create_eval_awareness(req: EvalAwarenessRequest, background: BackgroundTasks) -> dict:
    """Start an eval-awareness detection run (M2-5). Returns 202 with safety_id."""
    if req.task_id not in DEMO_TASKS_BY_ID:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task_id {req.task_id!r}. Available: {list(DEMO_TASKS_BY_ID)}"
        )
    api_key = req.api_key or settings.openai_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided.")
    model = req.model or settings.default_model
    record = _store.create_safety_eval("eval_awareness", req.task_id, model)
    sid = record["safety_id"]
    background.add_task(
        _run_eval_awareness_bg,
        safety_id=sid,
        task_id=req.task_id,
        n_runs=req.n_runs,
        model=model,
        api_key=api_key,
        base_url=req.base_url or settings.openai_base_url,
    )
    return record


def _run_eval_awareness_bg(safety_id, task_id, n_runs, model, api_key, base_url):
    _store.update_safety_eval(safety_id, status="running")
    try:
        task = DEMO_TASKS_BY_ID[task_id]
        cfg = LLMConfig(api_key=api_key, base_url=base_url, model=model)
        runner = LLMAgentRunner(cfg)
        result = run_eval_awareness(task, runner, n_runs=n_runs)
        _store.save_safety_result(safety_id, result.model_dump())
        _store.update_safety_eval(safety_id, status="done")
    except Exception as exc:
        _store.update_safety_eval(safety_id, status="error", error=str(exc))


# ── CoT audit (M2-6) ─────────────────────────────────────────────────────

@router.post("/cot-audit", status_code=202)
def create_cot_audit(req: CoTAuditRequest, background: BackgroundTasks) -> dict:
    """
    Audit chain-of-thought reasoning in an existing trajectory (M2-6).
    Requires the trajectory to have been recorded with cot_mode=True.
    Returns 202 with safety_id.
    """
    api_key = req.api_key or settings.openai_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided.")
    model = req.model or settings.default_model
    record = _store.create_safety_eval("cot_audit", req.task_id, model)
    sid = record["safety_id"]
    background.add_task(
        _run_cot_audit_bg,
        safety_id=sid,
        trajectory_id=req.trajectory_id,
        task_id=req.task_id,
        model=model,
        api_key=api_key,
        base_url=req.base_url or settings.openai_base_url,
    )
    return record


def _run_cot_audit_bg(safety_id, trajectory_id, task_id, model, api_key, base_url):
    _store.update_safety_eval(safety_id, status="running")
    try:
        traj = _store.get_trajectory(trajectory_id)
        result = run_cot_audit(
            trajectory=traj,
            trajectory_id=trajectory_id,
            api_key=api_key,
            base_url=base_url,
            model=model,
        )
        _store.save_safety_result(safety_id, result.model_dump())
        _store.update_safety_eval(safety_id, status="done")
    except Exception as exc:
        _store.update_safety_eval(safety_id, status="error", error=str(exc))


# ── Backdoor scan (M2-7) ──────────────────────────────────────────────────

@router.post("/backdoor-scan", status_code=202)
def create_backdoor_scan(req: BackdoorScanRequest, background: BackgroundTasks) -> dict:
    """
    Run backdoor trigger scanner (M2-7).
    Optionally pass trigger_ids to scan a subset of the library.
    Returns 202 with safety_id.
    """
    if req.task_id not in DEMO_TASKS_BY_ID:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown task_id {req.task_id!r}. Available: {list(DEMO_TASKS_BY_ID)}"
        )
    api_key = req.api_key or settings.openai_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key provided.")
    model = req.model or settings.default_model
    record = _store.create_safety_eval("backdoor_scan", req.task_id, model)
    sid = record["safety_id"]
    background.add_task(
        _run_backdoor_scan_bg,
        safety_id=sid,
        task_id=req.task_id,
        trigger_ids=req.trigger_ids,
        model=model,
        api_key=api_key,
        base_url=req.base_url or settings.openai_base_url,
    )
    return record


def _run_backdoor_scan_bg(safety_id, task_id, trigger_ids, model, api_key, base_url):
    _store.update_safety_eval(safety_id, status="running")
    try:
        task = DEMO_TASKS_BY_ID[task_id]
        cfg = LLMConfig(api_key=api_key, base_url=base_url, model=model)
        runner = LLMAgentRunner(cfg)
        result = run_backdoor_scan(task, runner, trigger_ids=trigger_ids)
        _store.save_safety_result(safety_id, result.model_dump())
        _store.update_safety_eval(safety_id, status="done")
    except Exception as exc:
        _store.update_safety_eval(safety_id, status="error", error=str(exc))


# ── Convenience: list consistency tasks ───────────────────────────────────

@router.get("/consistency-tasks/list")
def list_consistency_tasks() -> list[dict]:
    """List available built-in consistency probe tasks."""
    return [
        {
            "task_id": t.task_id,
            "variant_count": len(t.variants),
            "variants": [{"id": v.variant_id, "instruction": v.user_instruction} for v in t.variants],
        }
        for t in CONSISTENCY_TASKS.values()
    ]
