"""
M5-1: Docker Sandbox API endpoints.

Provides scenario management and run execution for sandboxed agent evaluation.
Runs in mock mode by default; set DOCKER_AVAILABLE=true for real Docker execution.
"""
from __future__ import annotations

import os
import subprocess
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from agent_eval.docker_sandbox import (
    SANDBOX_SCENARIOS,
    SANDBOX_SCENARIOS_BY_ID,
    DockerSandboxRunner,
    DockerSandboxSpec,
    SandboxRunResult,
    AgentFramework,
)

router = APIRouter(prefix="/api/v1/sandbox")


SANDBOX_IMAGE = "agent-security-eval/sandbox:latest"

# ── Environment status helpers ────────────────────────────────────────────────

def _run(cmd: list[str], timeout: int = 8) -> tuple[int, str, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except FileNotFoundError:
        return -1, "", "command not found"
    except subprocess.TimeoutExpired:
        return -2, "", "timeout"


def _detect_env_status() -> dict:
    # Docker CLI present?
    rc, ver_out, _ = _run(["docker", "--version"])
    docker_cli = rc == 0
    docker_version: Optional[str] = None
    if docker_cli and ver_out:
        # "Docker version 27.3.1, build ..."
        parts = ver_out.split()
        docker_version = parts[2].rstrip(",") if len(parts) >= 3 else ver_out[:20]

    # Daemon running?
    rc2, info_out, _ = _run(["docker", "info", "--format", "{{.ServerVersion}}"], timeout=6)
    daemon_running = rc2 == 0

    # OrbStack vs Docker Desktop
    runtime = "unknown"
    if daemon_running:
        rc3, ctx_out, _ = _run(["docker", "context", "show"])
        if rc3 == 0:
            ctx = ctx_out.lower()
            if "orbstack" in ctx or "orb" in ctx:
                runtime = "orbstack"
            elif "desktop" in ctx:
                runtime = "docker_desktop"
            else:
                runtime = ctx.strip() or "docker"
        # Fallback: check info for OrbStack signature
        if runtime == "unknown":
            rc4, full_info, _ = _run(["docker", "info"])
            if "orbstack" in full_info.lower():
                runtime = "orbstack"

    # Image present?
    rc5, img_id, _ = _run(["docker", "images", "-q", SANDBOX_IMAGE])
    image_present = rc5 == 0 and bool(img_id.strip())

    # Image size
    image_size: Optional[str] = None
    if image_present:
        rc6, size_out, _ = _run([
            "docker", "image", "inspect", SANDBOX_IMAGE,
            "--format", "{{.Size}}"
        ])
        if rc6 == 0 and size_out:
            try:
                sz = int(size_out.strip())
                image_size = f"{sz / 1e9:.1f} GB" if sz > 1e9 else f"{sz / 1e6:.0f} MB"
            except ValueError:
                pass

    return {
        "docker_cli":     docker_cli,
        "docker_version": docker_version,
        "daemon_running": daemon_running,
        "runtime":        runtime,
        "image_present":  image_present,
        "image_tag":      SANDBOX_IMAGE,
        "image_size":     image_size,
    }


@router.get("/env-status")
def get_env_status() -> dict:
    """Check Docker environment readiness for real sandbox execution."""
    return _detect_env_status()


# ── Image pull ────────────────────────────────────────────────────────────────

# Phase labels used to classify docker pull output lines
_PULL_PHASES = [
    ("pulling_manifest", ["Pulling from", "Digest:", "Status:"]),
    ("pulling_layers",   ["Pulling fs layer", "Waiting", "Downloading"]),
    ("extracting",       ["Extracting", "Pull complete", "Already exists", "Verifying Checksum"]),
    ("finalizing",       ["Digest:", "Status:", "docker.io"]),
]

_pull_state: dict = {
    "status": "idle",      # idle | running | done | error
    "phase":  "",
    "message": "",
    "log": [],
    "error": "",
    "started_at": "",
}
_pull_lock = threading.Lock()


def _classify_phase(line: str) -> Optional[str]:
    for phase_id, keywords in _PULL_PHASES:
        if any(kw in line for kw in keywords):
            return phase_id
    return None


def _do_pull() -> None:
    global _pull_state
    with _pull_lock:
        _pull_state.update({"status": "running", "phase": "connecting",
                            "message": "连接镜像仓库…", "log": [], "error": "",
                            "started_at": datetime.now(timezone.utc).isoformat()})
    try:
        proc = subprocess.Popen(
            ["docker", "pull", SANDBOX_IMAGE],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip()
            if not line:
                continue
            phase = _classify_phase(line) or _pull_state["phase"]
            phase_label = {
                "connecting":        "连接镜像仓库",
                "pulling_manifest":  "解析镜像清单",
                "pulling_layers":    "拉取镜像层",
                "extracting":        "解压缩镜像层",
                "finalizing":        "校验完整性",
            }.get(phase, phase)
            with _pull_lock:
                _pull_state["phase"] = phase
                _pull_state["message"] = f"{phase_label}：{line[:120]}"
                _pull_state["log"] = (_pull_state["log"] + [line])[-40:]

        proc.wait()
        with _pull_lock:
            if proc.returncode == 0:
                _pull_state.update({"status": "done", "phase": "done",
                                    "message": "镜像拉取完成，沙箱已就绪 ✓"})
            else:
                _pull_state.update({"status": "error",
                                    "message": "拉取失败，见日志",
                                    "error": "\n".join(_pull_state["log"][-5:])})
    except Exception as exc:
        with _pull_lock:
            _pull_state.update({"status": "error", "message": str(exc), "error": str(exc)})


@router.post("/pull-image", status_code=202)
def pull_image() -> dict:
    """Start pulling the sandbox Docker image in the background."""
    with _pull_lock:
        if _pull_state["status"] == "running":
            return {"started": False, "reason": "already_running"}
    t = threading.Thread(target=_do_pull, daemon=True)
    t.start()
    return {"started": True}


@router.get("/pull-status")
def get_pull_status() -> dict:
    """Return current state of the image pull operation."""
    with _pull_lock:
        return dict(_pull_state)


# ── In-memory run store ───────────────────────────────────────────────────────

class SandboxRun(BaseModel):
    run_id: str
    spec_ids: list[str]
    status: str  # "pending" | "running" | "done" | "error"
    total: int
    done: int
    results: list[dict] = []
    created_at: str = ""
    model: str = ""
    use_docker: bool = False


_sandbox_runs: dict[str, SandboxRun] = {}


# ── Request schemas ───────────────────────────────────────────────────────────

class RunSandboxRequest(BaseModel):
    spec_ids: Optional[list[str]] = None  # None → all scenarios
    model: str = "gpt-4o-mini"
    api_key: str = ""
    base_url: str = "https://api.openai.com/v1"
    use_docker: bool = False


# ── Scenario endpoints ────────────────────────────────────────────────────────

@router.get("/scenarios")
def list_scenarios() -> list[dict]:
    """List all sandbox evaluation scenarios."""
    return [
        {
            "spec_id": s.spec_id,
            "name": s.name,
            "description": s.description,
            "framework": s.framework.value,
            "tool_count": len(s.tools),
            "injectable_tools": sum(1 for t in s.tools if t.inject_payload),
            "attack_type": s.attack_type,
            "user_instruction": s.user_instruction,
            "benign_success_check": s.benign_success_check,
            "attack_success_check": s.attack_success_check,
            "timeout_sec": s.timeout_sec,
            "network_disabled": s.network_disabled,
            "tags": s.tags,
        }
        for s in SANDBOX_SCENARIOS
    ]


@router.get("/scenarios/{spec_id}")
def get_scenario(spec_id: str) -> dict:
    if spec_id not in SANDBOX_SCENARIOS_BY_ID:
        raise HTTPException(status_code=404, detail=f"scenario {spec_id!r} not found")
    return SANDBOX_SCENARIOS_BY_ID[spec_id].model_dump()


@router.get("/frameworks")
def list_frameworks() -> list[dict]:
    """List supported agent frameworks."""
    return [
        {"id": f.value, "name": f.value.replace("_", " ").title()}
        for f in AgentFramework
    ]


# ── Run endpoints ─────────────────────────────────────────────────────────────

@router.post("/runs", status_code=202)
def create_sandbox_run(req: RunSandboxRequest, background_tasks: BackgroundTasks) -> dict:
    """Start a sandbox evaluation run (mock or real Docker)."""
    spec_ids = req.spec_ids or [s.spec_id for s in SANDBOX_SCENARIOS]
    run_id = "sb_" + str(uuid.uuid4())[:8]
    run = SandboxRun(
        run_id=run_id,
        spec_ids=spec_ids,
        status="pending",
        total=len(spec_ids),
        done=0,
        created_at=datetime.now(timezone.utc).isoformat(),
        model=req.model,
        use_docker=req.use_docker,
    )
    _sandbox_runs[run_id] = run
    background_tasks.add_task(
        _run_sandbox_background,
        run_id=run_id,
        spec_ids=spec_ids,
        model=req.model,
        api_key=req.api_key,
        base_url=req.base_url,
        use_docker=req.use_docker,
    )
    return run.model_dump()


@router.get("/runs")
def list_runs() -> list[dict]:
    return [r.model_dump() for r in sorted(
        _sandbox_runs.values(), key=lambda r: r.created_at, reverse=True
    )]


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    if run_id not in _sandbox_runs:
        raise HTTPException(status_code=404, detail=f"run {run_id!r} not found")
    return _sandbox_runs[run_id].model_dump()


# ── Background task ───────────────────────────────────────────────────────────

def _run_sandbox_background(
    run_id: str,
    spec_ids: list[str],
    model: str,
    api_key: str,
    base_url: str,
    use_docker: bool,
) -> None:
    run = _sandbox_runs[run_id]
    run.status = "running"

    runner = DockerSandboxRunner(
        api_key=api_key,
        base_url=base_url,
        model=model,
        use_docker=use_docker,
    )

    for sid in spec_ids:
        spec = SANDBOX_SCENARIOS_BY_ID.get(sid)
        if not spec:
            continue
        result: SandboxRunResult = runner.run(spec)
        run.results.append(result.model_dump())
        run.done += 1

    run.status = "done"
