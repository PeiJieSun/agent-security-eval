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
_SANDBOX_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "..", "sandbox")

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

    # Check if local build context exists
    build_ctx = os.path.realpath(_SANDBOX_DIR)
    dockerfile_exists = os.path.exists(os.path.join(build_ctx, "Dockerfile"))

    return {
        "docker_cli":         docker_cli,
        "docker_version":     docker_version,
        "daemon_running":     daemon_running,
        "runtime":            runtime,
        "image_present":      image_present,
        "image_tag":          SANDBOX_IMAGE,
        "image_size":         image_size,
        "dockerfile_exists":  dockerfile_exists,
        "build_context_path": build_ctx,
    }


@router.get("/env-status")
def get_env_status() -> dict:
    """Check Docker environment readiness for real sandbox execution."""
    return _detect_env_status()


# ── Image build / pull ────────────────────────────────────────────────────────

# Classify docker build output lines into phases
_BUILD_PHASE_KEYWORDS = [
    ("resolving",  ["FROM", "resolve image", "[internal]"]),
    ("fetching",   ["fetch", "sha256:", "http://", "https://"]),
    ("installing", ["RUN", "pip install", "apt-get", "npm"]),
    ("copying",    ["COPY", "ADD"]),
    ("finishing",  ["exporting", "writing image", "naming", "Successfully built", "Successfully tagged"]),
]

_build_state: dict = {
    "status": "idle",   # idle | running | done | error
    "mode":   "",       # "build" | "pull"
    "phase":  "",
    "message": "",
    "log": [],
    "error": "",
    "started_at": "",
}
_build_lock = threading.Lock()


def _classify_build_phase(line: str) -> Optional[str]:
    for phase_id, keywords in _BUILD_PHASE_KEYWORDS:
        if any(kw.lower() in line.lower() for kw in keywords):
            return phase_id
    return None


def _do_build(build_context: str) -> None:
    with _build_lock:
        _build_state.update({
            "status": "running", "mode": "build", "phase": "preparing",
            "message": f"准备构建上下文：{build_context}",
            "log": [], "error": "",
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
    try:
        proc = subprocess.Popen(
            ["docker", "build", "--progress=plain", "-t", SANDBOX_IMAGE, build_context],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1,
        )
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip()
            if not line:
                continue
            phase = _classify_build_phase(line) or _build_state["phase"]
            phase_label = {
                "preparing":  "准备构建上下文",
                "resolving":  "解析基础镜像",
                "fetching":   "拉取基础层",
                "installing": "安装依赖",
                "copying":    "拷贝脚本",
                "finishing":  "打标签完成",
            }.get(phase, phase)
            with _build_lock:
                _build_state["phase"] = phase
                _build_state["message"] = f"{phase_label}：{line[:120]}"
                _build_state["log"] = (_build_state["log"] + [line])[-60:]
        proc.wait()
        with _build_lock:
            if proc.returncode == 0:
                _build_state.update({"status": "done", "phase": "done",
                                     "message": "镜像构建完成，沙箱已就绪 ✓"})
            else:
                _build_state.update({
                    "status": "error",
                    "message": "构建失败，见日志",
                    "error": "\n".join(_build_state["log"][-8:]),
                })
    except Exception as exc:
        with _build_lock:
            _build_state.update({"status": "error", "message": str(exc), "error": str(exc)})


@router.post("/build-image", status_code=202)
def build_image() -> dict:
    """Build the sandbox Docker image from the local Dockerfile."""
    with _build_lock:
        if _build_state["status"] == "running":
            return {"started": False, "reason": "already_running"}
    build_ctx = os.path.realpath(_SANDBOX_DIR)
    if not os.path.exists(os.path.join(build_ctx, "Dockerfile")):
        raise HTTPException(status_code=400, detail=f"Dockerfile not found in {build_ctx}")
    t = threading.Thread(target=_do_build, args=(build_ctx,), daemon=True)
    t.start()
    return {"started": True, "build_context": build_ctx}


@router.get("/build-status")
def get_build_status() -> dict:
    """Return current state of the image build operation."""
    with _build_lock:
        return dict(_build_state)


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
