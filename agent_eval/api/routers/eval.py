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

import asyncio
import uuid
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent_eval.api.settings import settings
from agent_eval.monitor import MonitorEvent, RuntimeMonitor, format_sse
from agent_eval.report import METRIC_STANDARDS, compute_report
from agent_eval.runners.llm_runner import LLMAgentRunner, LLMConfig
from agent_eval.storage.sqlite_store import SqliteStore
from agent_eval.tasks.email_tasks import DEMO_TASKS_BY_ID as _EMAIL_TASKS
from agent_eval.tasks.research_tasks import RESEARCH_TASKS_BY_ID as _RESEARCH_TASKS
from agent_eval.tasks.chinese_tasks import CHINESE_TASKS_BY_ID as _CHINESE_TASKS

DEMO_TASKS_BY_ID = {**_EMAIL_TASKS, **_RESEARCH_TASKS, **_CHINESE_TASKS}

import time

_mon = RuntimeMonitor()

router = APIRouter(prefix="/api/v1/agent-eval")
_store = SqliteStore()


# ── Request / Response schemas ────────────────────────────────────────────

class CreateEvalRequest(BaseModel):
    task_id: str
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class CreateBatchRequest(BaseModel):
    task_ids: Optional[list[str]] = None          # None = all tasks
    domains: Optional[list[str]] = None           # "email" | "research" | "chinese"
    injection_styles: Optional[list[str]] = None  # None = all styles
    model: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class TestConnectionRequest(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None


# ── Connectivity test ────────────────────────────────────────────────────

@router.post("/test-connection")
def test_connection(req: TestConnectionRequest) -> dict:
    """
    Test LLM connectivity by sending a minimal chat request.
    Returns latency_ms and model info on success; error detail on failure.
    """
    api_key = req.api_key or settings.openai_api_key
    base_url = req.base_url or settings.openai_base_url
    model = req.model or settings.default_model

    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="未提供 API Key，请填写 api_key 或设置 OPENAI_API_KEY 环境变量。",
        )

    try:
        from openai import OpenAI
    except ImportError:
        raise HTTPException(status_code=500, detail="openai 包未安装，请运行 pip install openai")

    try:
        client = OpenAI(api_key=api_key, base_url=base_url)
        t0 = time.monotonic()
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": "Reply with the single word: pong"}],
            max_tokens=5,
            temperature=0,
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
        return {
            "ok": True,
            "model": resp.model,
            "latency_ms": latency_ms,
            "reply": resp.choices[0].message.content.strip() if resp.choices else "",
        }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


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
            "injection_style": t.attack_vector.style.value,
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


@router.get("/batch-evals")
def list_batches() -> list[dict]:
    """List recent batch evaluation jobs."""
    return _store.list_batches()


@router.get("/batch-evals/{batch_id}")
def get_batch(batch_id: str) -> dict:
    try:
        return _store.get_batch(batch_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"batch {batch_id!r} not found")


@router.post("/batch-evals", status_code=202)
def create_batch(req: CreateBatchRequest, background_tasks: BackgroundTasks) -> dict:
    """
    Start a batch evaluation across multiple tasks × injection styles.
    Returns immediately with batch_id; poll GET /batch-evals/{id} for progress.
    """
    from agent_eval.task_spec import InjectionStyle

    api_key = req.api_key or settings.openai_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="未提供 API Key")

    model = req.model or settings.default_model
    base_url = req.base_url or settings.openai_base_url

    # Build task list filtered by domain
    domain_filter = set(req.domains) if req.domains else None
    all_tasks = list(DEMO_TASKS_BY_ID.values())
    tasks = []
    for t in all_tasks:
        if domain_filter is None:
            tasks.append(t)
        else:
            task_domains = set()
            for tag in t.tags:
                if tag in ("email", "research", "chinese"):
                    task_domains.add(tag)
            if task_domains & domain_filter:
                tasks.append(t)
    if req.task_ids:
        tasks = [t for t in tasks if t.task_id in req.task_ids]

    # Build style list
    all_styles = [s for s in InjectionStyle]
    if req.injection_styles:
        styles = [s for s in all_styles if s.value in req.injection_styles]
    else:
        styles = all_styles

    if not tasks or not styles:
        raise HTTPException(status_code=400, detail="No tasks or styles selected")

    combos = [(t, s) for t in tasks for s in styles]
    batch_id = "batch_" + uuid.uuid4().hex[:10]
    config = {
        "model": model,
        "domains": req.domains,
        "injection_styles": [s.value for s in styles],
        "task_ids": [t.task_id for t in tasks],
    }
    batch = _store.create_batch(batch_id, model, len(combos), config)

    background_tasks.add_task(
        _run_batch_background,
        batch_id=batch_id,
        combos=[(t.task_id, s.value) for t, s in combos],
        model=model,
        api_key=api_key,
        base_url=base_url,
    )
    return batch


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


# ── Real-time SSE stream ───────────────────────────────────────────────────

@router.get("/evals/{eval_id}/stream")
async def stream_eval(eval_id: str, request: Request):
    """
    SSE endpoint — stream real-time tool-call events and OnlineJudge alerts
    for a running eval.  Connect before or during the eval run.

    Events:
      tool_call_step  — each tool call the agent makes
      policy_alert    — OnlineJudge fired a rule violation
      eval_done       — eval completed (clean + attack)
      eval_error      — eval failed
    """
    try:
        _store.get_eval(eval_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"eval {eval_id!r} not found")

    loop = asyncio.get_event_loop()
    q = _mon.open(eval_id, loop)

    async def event_generator():
        try:
            # Send initial heartbeat
            yield f"event: connected\ndata: {{\"eval_id\": \"{eval_id}\"}}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event: MonitorEvent = await asyncio.wait_for(q.get(), timeout=30.0)
                    yield format_sse(event)
                    if event.event_type in ("eval_done", "eval_error"):
                        break
                except asyncio.TimeoutError:
                    # Send keep-alive ping
                    yield ": ping\n\n"
        finally:
            _mon.close(eval_id)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Background runner ─────────────────────────────────────────────────────

def _make_step_callback(eval_id: str):
    """Return a thread-safe callback that publishes step events + runs OnlineJudge."""
    from agent_eval.monitor import EVENT_TYPES

    def callback(step: dict):
        judge = _mon.get_judge(eval_id)

        # Publish the tool-call step event
        _mon.publish_sync(eval_id, MonitorEvent(
            event_type=EVENT_TYPES["step"],
            eval_id=eval_id,
            data=step,
        ))

        # Run online judge if available
        if judge:
            alerts = judge.inspect(step)
            for alert_event in alerts:
                _mon.publish_sync(eval_id, alert_event)

    return callback


def _run_batch_background(
    batch_id: str,
    combos: list[tuple[str, str]],  # [(task_id, style_value), ...]
    model: str,
    api_key: str,
    base_url: str,
) -> None:
    """Run all (task, style) combinations sequentially and update batch progress."""
    import time as _time
    from agent_eval.task_spec import InjectionStyle

    done = 0
    failed = 0
    for task_id, style_value in combos:
        try:
            # Override the task's injection style
            base_task = DEMO_TASKS_BY_ID[task_id]
            # Build a modified task with the requested style
            from agent_eval.task_spec import EvalTask, InjectionVector
            av = base_task.attack_vector
            new_av = InjectionVector(
                target_tool=av.target_tool,
                field_path=av.field_path,
                payload=av.payload,
                inject_index=av.inject_index,
                style=InjectionStyle(style_value),
            )
            task = EvalTask(
                task_id=base_task.task_id,
                description=base_task.description,
                environment_type=base_task.environment_type,
                environment_config=base_task.environment_config,
                user_instruction=base_task.user_instruction,
                attack_vector=new_av,
                benign_success_expr=base_task.benign_success_expr,
                attack_success_expr=base_task.attack_success_expr,
                attack_type=base_task.attack_type,
                tags=base_task.tags,
                max_steps=base_task.max_steps,
            )
            eval_record = _store.create_eval(task_id, model)
            eval_id = eval_record["eval_id"]
            _run_eval_background(eval_id, task_id, model, api_key, base_url, override_task=task)
            done += 1
        except Exception:
            failed += 1
        _store.update_batch(batch_id, done_count=done, failed_count=failed)
        _time.sleep(0.5)  # brief pause between calls

    final_status = "done" if failed == 0 else ("failed" if done == 0 else "done_with_errors")
    _store.update_batch(batch_id, status=final_status, done_count=done, failed_count=failed)


def _run_eval_background(
    eval_id: str,
    task_id: str,
    model: str,
    api_key: str,
    base_url: str,
    override_task=None,
) -> None:
    from agent_eval.monitor import EVENT_TYPES
    _store.update_eval(eval_id, status="running")
    step_cb = _make_step_callback(eval_id)
    try:
        task = override_task if override_task is not None else DEMO_TASKS_BY_ID[task_id]
        cfg = LLMConfig(api_key=api_key, base_url=base_url, model=model,
                        max_steps=task.max_steps)
        runner = LLMAgentRunner(cfg)

        clean_traj, attack_traj, (clean_result, attack_result) = runner.eval_task(
            task, eval_id=eval_id, step_callback=step_cb
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
            injection_style=task.attack_vector.style,
        )
        report_dict = report.model_dump()
        _store.save_report(eval_id, report_dict)
        _store.update_eval(eval_id, status="done")

        # M3-5: Record behavior snapshot for long-term tracking
        try:
            from agent_eval.behavior_tracker import BehaviorTracker
            tracker = BehaviorTracker(_store)
            tracker.record_snapshot(
                eval_id=eval_id,
                task_id=task_id,
                model=model,
                report=report_dict,
                trajectories=[clean_traj, attack_traj],
            )
        except Exception:
            pass  # Non-critical; don't fail the eval

        _mon.publish_sync(eval_id, MonitorEvent(
            event_type=EVENT_TYPES["done"],
            eval_id=eval_id,
            data={"eval_id": eval_id, "report_summary": {
                "benign_utility": report.benign_utility.value,
                "targeted_asr": report.targeted_asr.value,
                "utility_under_attack": report.utility_under_attack.value,
            }},
        ))

    except Exception as exc:
        from agent_eval.monitor import EVENT_TYPES as _ET
        _store.update_eval(eval_id, status="error", error=str(exc))
        _mon.publish_sync(eval_id, MonitorEvent(
            event_type=_ET["error"],
            eval_id=eval_id,
            data={"error": str(exc)},
        ))


# ── M2-3: Tool Call Graph ─────────────────────────────────────────────────

@router.get("/tool-call-graph")
def get_tool_call_graph() -> dict:
    """
    Build and return a directed weighted Tool Call Graph from all stored trajectories.
    Useful for identifying high-risk tool transition paths across evaluated agents.
    """
    from agent_eval.tool_call_graph import build_graph

    # Load all trajectories from DB
    trajectories = []
    with _store._conn() as con:
        rows = con.execute(
            "SELECT run_id FROM trajectories ORDER BY updated_at DESC LIMIT 500"
        ).fetchall()
    for row in rows:
        try:
            traj = _store.get_trajectory(row["run_id"])
            trajectories.append(traj)
        except Exception:
            continue

    graph = build_graph(trajectories)
    return graph.model_dump()


# ── M3-3: Release Gate ────────────────────────────────────────────────────

@router.get("/release-gate/{eval_id}")
def get_release_gate(eval_id: str) -> dict:
    """Check whether a completed eval meets the release criteria (M3-3)."""
    from agent_eval.release_gate import evaluate_gate

    try:
        _store.get_eval(eval_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"eval {eval_id!r} not found")
    try:
        report = _store.get_report(eval_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Report not ready. Eval must be 'done'.")

    result = evaluate_gate(report)
    return result.model_dump()


@router.get("/release-history")
def get_release_history() -> list[dict]:
    """Return a summary of all completed evals for historical comparison (M3-3)."""
    evals = _store.list_evals(limit=100)
    history = []
    for ev in evals:
        if ev["status"] != "done":
            continue
        try:
            report = _store.get_report(ev["eval_id"])
            history.append({
                "eval_id": ev["eval_id"],
                "task_id": ev["task_id"],
                "model": ev["model"],
                "created_at": ev["created_at"],
                "benign_utility": report.get("benign_utility", {}).get("value", 0),
                "targeted_asr": report.get("targeted_asr", {}).get("value", 0),
                "utility_under_attack": report.get("utility_under_attack", {}).get("value", 0),
            })
        except Exception:
            continue
    return history


# ── M3-5: Behavior Trend ──────────────────────────────────────────────────

@router.get("/behavior-trend/tasks")
def list_behavior_tasks() -> list[dict]:
    """List tasks that have behavior snapshots recorded."""
    from agent_eval.behavior_tracker import BehaviorTracker
    tracker = BehaviorTracker(_store)
    return tracker.list_tracked_tasks()


@router.get("/behavior-trend/{task_id}")
def get_behavior_trend(task_id: str) -> dict:
    """Return behavioral trend data for a task (M3-5)."""
    from agent_eval.behavior_tracker import BehaviorTracker
    tracker = BehaviorTracker(_store)
    return tracker.get_trend(task_id).model_dump()
