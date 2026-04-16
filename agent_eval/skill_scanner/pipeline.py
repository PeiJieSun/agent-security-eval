"""
SkillSecurityPipeline — orchestrates the five-layer deep scan.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from agent_eval.skill_scanner.discovery import classify_file, discover_files
from agent_eval.skill_scanner.models import (
    DeepScanReport, LayerResult, ScannedFile,
)


class PipelineContext:
    """Carries shared state between layers."""

    def __init__(self, files: list[Path], contents: dict[str, str]):
        self.files = files
        self.contents = contents
        self.counter: list[int] = [0]
        self.l1: Optional[LayerResult] = None
        self.l2: Optional[LayerResult] = None
        self.l3: Optional[LayerResult] = None
        self.l4: Optional[LayerResult] = None
        self.l5: Optional[LayerResult] = None


class SkillSecurityPipeline:
    """Unified entry point for the five-layer skill security scan."""

    def __init__(
        self,
        api_key: str = "",
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-4o-mini",
    ):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model

    async def run(
        self,
        target: str,
        layers: list[str] | None = None,
        on_layer_done: Callable[[LayerResult], Any] | None = None,
    ) -> DeepScanReport:
        if layers is None:
            layers = ["L1", "L2", "L3", "L4", "L5"]

        root = Path(target)
        files = discover_files(root)
        contents: dict[str, str] = {}
        for f in files:
            try:
                contents[str(f)] = f.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pass

        ctx = PipelineContext(files, contents)

        def _notify(lr: LayerResult):
            if on_layer_done:
                on_layer_done(lr)

        # L1: Text & Semantic
        if "L1" in layers:
            from agent_eval.skill_scanner.l1_text import analyze as l1_analyze
            ctx.l1 = await l1_analyze(
                ctx.contents, ctx.counter,
                self.api_key, self.base_url, self.model,
            )
            _notify(ctx.l1)

        # L2: Capability Graph
        if "L2" in layers:
            from agent_eval.skill_scanner.l2_capability import analyze as l2_analyze
            ctx.l2 = await l2_analyze(
                ctx.contents, ctx.l1, ctx.counter,
                self.api_key, self.base_url, self.model,
            )
            _notify(ctx.l2)

        # L3 (slow, optional) and L4 can run in parallel
        async def _run_l3():
            if "L3" not in layers:
                return
            from agent_eval.skill_scanner.l3_behavior import analyze as l3_analyze
            ctx.l3 = await l3_analyze(
                ctx.contents, ctx.l1, ctx.l2, ctx.counter,
                self.api_key, self.base_url, self.model,
            )
            _notify(ctx.l3)

        async def _run_l4():
            if "L4" not in layers:
                return
            from agent_eval.skill_scanner.l4_supply_chain import analyze as l4_analyze
            ctx.l4 = await l4_analyze(ctx.contents, ctx.counter)
            _notify(ctx.l4)

        await asyncio.gather(_run_l3(), _run_l4())

        # L5: Composition (needs L1+L2)
        if "L5" in layers:
            from agent_eval.skill_scanner.l5_composition import analyze as l5_analyze
            ctx.l5 = await l5_analyze(
                ctx.contents, ctx.l1, ctx.l2, ctx.counter,
                self.api_key, self.base_url, self.model,
            )
            _notify(ctx.l5)

        return self._build_report(target, layers, ctx)

    def _build_report(
        self, target: str, layers: list[str], ctx: PipelineContext,
    ) -> DeepScanReport:
        layer_results = [
            lr for lr in [ctx.l1, ctx.l2, ctx.l3, ctx.l4, ctx.l5]
            if lr is not None
        ]
        scanned_files = [
            ScannedFile(
                path=str(f),
                file_type=classify_file(f),
                size_bytes=len(ctx.contents.get(str(f), "").encode("utf-8")),
                findings=[
                    finding for lr in layer_results
                    for finding in lr.findings
                    if finding.file_path == str(f)
                ],
            )
            for f in ctx.files
        ]

        report = DeepScanReport(
            scan_id=uuid.uuid4().hex[:12],
            target_path=target,
            layers_requested=layers,
            layer_results=layer_results,
            files_discovered=scanned_files,
        )
        report.compute_overall()
        return report
