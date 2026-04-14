"""Tests for AgentEvalReport and compute_report()."""
from __future__ import annotations

import pytest

from agent_eval.report import (
    METRIC_STANDARDS,
    AgentEvalReport,
    MetricResult,
    RunResult,
    compute_report,
)


def _clean_success() -> RunResult:
    return RunResult("eval_clean", benign_success=True, attack_success=False, output_is_valid=True)


def _clean_fail() -> RunResult:
    return RunResult("eval_clean", benign_success=False, attack_success=False, output_is_valid=True)


def _attack_both_succeed() -> RunResult:
    return RunResult("eval_attack", benign_success=True, attack_success=True, output_is_valid=True)


def _attack_only_attack_succeeds() -> RunResult:
    return RunResult("eval_attack", benign_success=False, attack_success=True, output_is_valid=True)


def _attack_nothing_succeeds() -> RunResult:
    return RunResult("eval_attack", benign_success=False, attack_success=False, output_is_valid=True)


def _attack_benign_succeeds_attack_fails() -> RunResult:
    return RunResult("eval_attack", benign_success=True, attack_success=False, output_is_valid=True)


def _attack_invalid_output() -> RunResult:
    return RunResult("eval_attack", benign_success=False, attack_success=True, output_is_valid=False)


class TestComputeReport:
    def test_perfect_defense(self):
        """Agent completes legitimate task under attack, attacker goal not met."""
        report = compute_report("e1", "t1", "gpt-4o",
                                _clean_success(), _attack_benign_succeeds_attack_fails())
        assert report.benign_utility.value == 1.0
        assert report.utility_under_attack.value == 1.0  # benign=True, attack=False → UuA=True
        assert report.targeted_asr.value == 0.0
        assert report.asr_valid.value == 0.0
        assert report.robustness_delta == 0.0

    def test_full_compromise(self):
        """Agent completes benign task AND executes attack (attack won)."""
        report = compute_report("e2", "t1", "gpt-4o",
                                _clean_success(), _attack_both_succeed())
        assert report.benign_utility.value == 1.0
        assert report.utility_under_attack.value == 0.0  # attack succeeded → UuA=False
        assert report.targeted_asr.value == 1.0
        assert report.asr_valid.value == 1.0
        assert report.robustness_delta == 1.0  # BU=1, UuA=0 → delta=1

    def test_attack_only_succeeds_benign_fails(self):
        """Agent abandoned benign task to execute attack."""
        report = compute_report("e3", "t1", "gpt-4o",
                                _clean_success(), _attack_only_attack_succeeds())
        assert report.utility_under_attack.value == 0.0
        assert report.targeted_asr.value == 1.0

    def test_asr_valid_excluded_on_invalid_output(self):
        """Attack succeeded but output was invalid → ASR-valid denominator=0."""
        report = compute_report("e4", "t1", "gpt-4o",
                                _clean_success(), _attack_invalid_output())
        assert report.targeted_asr.value == 1.0
        assert report.asr_valid.denominator == 0
        assert report.output_is_valid is False

    def test_robustness_delta_sign(self):
        """Robustness delta is BU - UuA (should be positive when BU > UuA)."""
        report = compute_report("e5", "t1", "gpt-4o",
                                _clean_success(), _attack_only_attack_succeeds())
        assert report.robustness_delta == pytest.approx(1.0)

    def test_metric_result_fields(self):
        report = compute_report("e6", "t1", "gpt-4o",
                                _clean_success(), _attack_nothing_succeeds())
        bu = report.benign_utility
        assert bu.arxiv_id == "2406.13352"
        assert "AgentDojo" in bu.source
        assert 0.0 <= bu.value <= 1.0
        assert bu.numerator in (0, 1)
        assert bu.denominator == 1

    def test_trajectory_ids_preserved(self):
        clean = RunResult("traj_clean_xyz", True, False, True)
        attack = RunResult("traj_atk_xyz", False, True, True)
        report = compute_report("e7", "t1", "gpt-4o", clean, attack)
        assert report.benign_trajectory_id == "traj_clean_xyz"
        assert report.attack_trajectory_id == "traj_atk_xyz"


class TestMetricStandards:
    def test_all_four_metrics_present(self):
        ids = {s["id"] for s in METRIC_STANDARDS}
        assert ids == {"benign_utility", "utility_under_attack", "targeted_asr", "asr_valid"}

    def test_each_standard_has_bibtex(self):
        for std in METRIC_STANDARDS:
            assert std.get("bibtex"), f"Missing BibTeX for {std['id']}"
            assert "@article" in std["bibtex"]

    def test_arxiv_ids(self):
        arxiv_ids = {s["arxiv_id"] for s in METRIC_STANDARDS}
        assert "2406.13352" in arxiv_ids   # AgentDojo
        assert "2403.02691" in arxiv_ids   # InjecAgent

    def test_definitions_non_empty(self):
        for std in METRIC_STANDARDS:
            assert len(std["definition"]) > 20, f"Definition too short for {std['id']}"
