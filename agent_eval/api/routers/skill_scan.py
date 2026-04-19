"""
Skill / Rules / Agent Config Security Scan API.
Supports both quick (static-only) and deep (five-layer) scanning.
"""
from __future__ import annotations

import asyncio
import json
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent_eval.api.settings import settings
from agent_eval.skill_scanner import (
    scan_directory, scan_content,
    ScanReport, DeepScanReport, SkillSecurityPipeline,
)
from agent_eval.skill_scanner.models import LayerResult

router = APIRouter(prefix="/api/v1/agent-eval/skill-scan")

_history: list[ScanReport] = []
_deep_history: list[DeepScanReport] = []


# ---------------------------------------------------------------------------
# Quick scan endpoints (backward compatible)
# ---------------------------------------------------------------------------

class ScanPathRequest(BaseModel):
    path: str


class ScanContentRequest(BaseModel):
    content: str
    file_name: str = "<input>"
    file_type: str = "unknown"


@router.post("/directory", response_model=ScanReport)
def scan_path(req: ScanPathRequest):
    import os
    if not os.path.isdir(req.path):
        raise HTTPException(400, f"Not a directory: {req.path}")
    report = scan_directory(req.path)
    _history.append(report)
    return report


@router.post("/content")
def scan_raw_content(req: ScanContentRequest):
    result = scan_content(req.content, req.file_name, req.file_type)
    return result.model_dump()


@router.get("/reports")
def list_reports():
    return [
        {
            "scan_id": r.scan_id, "target_path": r.target_path,
            "files_scanned": r.files_scanned, "total_findings": r.total_findings,
            "critical_count": r.critical_count, "high_count": r.high_count,
            "summary": r.summary, "type": "quick",
        }
        for r in reversed(_history[-50:])
    ]


@router.get("/reports/{scan_id}", response_model=ScanReport)
def get_report(scan_id: str):
    for r in _history:
        if r.scan_id == scan_id:
            return r
    raise HTTPException(404, f"Report {scan_id} not found")


@router.get("/common-paths")
def common_scan_paths():
    import os
    home = os.path.expanduser("~")
    paths = [
        {"path": f"{home}/.cursor/skills", "label": "Cursor Skills (全局)", "exists": os.path.isdir(f"{home}/.cursor/skills")},
        {"path": f"{home}/.cursor/rules", "label": "Cursor Rules (全局)", "exists": os.path.isdir(f"{home}/.cursor/rules")},
    ]
    cwd = os.getcwd()
    project_paths = [
        {"path": f"{cwd}/.cursor/rules", "label": "项目 Rules", "exists": os.path.isdir(f"{cwd}/.cursor/rules")},
        {"path": cwd, "label": "项目根目录", "exists": True},
    ]
    return {"global_paths": paths, "project_paths": project_paths}


# ---------------------------------------------------------------------------
# Deep scan endpoints (five-layer)
# ---------------------------------------------------------------------------

class DeepScanRequest(BaseModel):
    path: str
    layers: list[str] = ["L1", "L2", "L3", "L4", "L5"]
    model: str = ""


@router.post("/deep")
async def deep_scan_sse(req: DeepScanRequest):
    """Five-layer deep scan with SSE streaming."""
    import os
    if not os.path.isdir(req.path):
        raise HTTPException(400, f"Not a directory: {req.path}")

    valid_layers = {"L1", "L2", "L3", "L4", "L5"}
    layers = [l for l in req.layers if l in valid_layers]
    if not layers:
        raise HTTPException(400, "No valid layers specified")

    model = req.model or settings.default_model
    pipeline = SkillSecurityPipeline(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        model=model,
    )

    layer_events: list[dict] = []
    event_ready = asyncio.Event()

    def on_layer_done(lr: LayerResult):
        layer_events.append({
            "event": "layer_done",
            "data": {
                "layer": lr.layer,
                "layer_name": lr.layer_name,
                "status": lr.status,
                "score": lr.score,
                "findings_count": len(lr.findings),
                "elapsed_ms": lr.elapsed_ms,
            },
        })
        event_ready.set()

    async def generate():
        task = asyncio.create_task(
            pipeline.run(req.path, layers, on_layer_done)
        )

        yield f"event: scan_start\ndata: {json.dumps({'layers': layers, 'path': req.path})}\n\n"

        sent = 0
        while not task.done():
            event_ready.clear()
            try:
                await asyncio.wait_for(event_ready.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass
            while sent < len(layer_events):
                ev = layer_events[sent]
                yield f"event: {ev['event']}\ndata: {json.dumps(ev['data'], ensure_ascii=False)}\n\n"
                sent += 1

        # Drain remaining events
        while sent < len(layer_events):
            ev = layer_events[sent]
            yield f"event: {ev['event']}\ndata: {json.dumps(ev['data'], ensure_ascii=False)}\n\n"
            sent += 1

        report = task.result()
        _deep_history.append(report)

        complete_data = {
            "scan_id": report.scan_id,
            "overall_score": report.overall_score,
            "overall_verdict": report.overall_verdict,
            "files_scanned": len(report.files_discovered),
            "total_findings": sum(len(lr.findings) for lr in report.layer_results),
        }
        yield f"event: complete\ndata: {json.dumps(complete_data, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@router.get("/deep/reports")
def list_deep_reports():
    return [
        {
            "scan_id": r.scan_id, "target_path": r.target_path,
            "layers": r.layers_requested,
            "overall_score": r.overall_score,
            "overall_verdict": r.overall_verdict,
            "files_scanned": len(r.files_discovered),
            "total_findings": sum(len(lr.findings) for lr in r.layer_results),
            "type": "deep",
        }
        for r in reversed(_deep_history[-50:])
    ]


@router.get("/deep/reports/{scan_id}")
def get_deep_report(scan_id: str):
    for r in _deep_history:
        if r.scan_id == scan_id:
            return r.model_dump()
    raise HTTPException(404, f"Deep scan report {scan_id} not found")


@router.get("/deep/reports/{scan_id}/layer/{layer}")
def get_deep_layer(scan_id: str, layer: str):
    for r in _deep_history:
        if r.scan_id == scan_id:
            for lr in r.layer_results:
                if lr.layer == layer:
                    return lr.model_dump()
            raise HTTPException(404, f"Layer {layer} not found in report {scan_id}")
    raise HTTPException(404, f"Deep scan report {scan_id} not found")


# ---------------------------------------------------------------------------
# Batch testing endpoints
# ---------------------------------------------------------------------------

_batch_history: list[dict] = []


class BatchTestRequest(BaseModel):
    layers: list[str] = ["L1", "L2", "L4", "L5"]
    include_adversarial: bool = True
    include_benign: bool = True
    model: str = ""


@router.post("/benchmark/run")
async def run_benchmark(req: BatchTestRequest):
    """Run batch benchmark on built-in adversarial + benign samples."""
    from agent_eval.skill_scanner.benchmark import (
        run_batch, ADVERSARIAL_SAMPLES, BENIGN_SAMPLES,
    )
    samples = []
    if req.include_adversarial:
        samples.extend(ADVERSARIAL_SAMPLES)
    if req.include_benign:
        samples.extend(BENIGN_SAMPLES)
    if not samples:
        raise HTTPException(400, "No samples selected")

    model = req.model or settings.default_model
    result = await run_batch(
        samples=samples, layers=req.layers,
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        model=model,
    )
    result_dict = result.model_dump()
    _batch_history.append(result_dict)
    return result_dict


@router.get("/benchmark/samples")
def list_samples():
    """List all built-in benchmark samples."""
    from agent_eval.skill_scanner.benchmark import ALL_SAMPLES
    return [s.model_dump() for s in ALL_SAMPLES]


@router.get("/benchmark/history")
def list_batch_history():
    return list(reversed(_batch_history[-20:]))
