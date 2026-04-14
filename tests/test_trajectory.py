"""
Tests for M1-2: trajectory recording, FunctionsRuntime auto-recording, YAML serialisation.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from agent_eval.environments.email_env import EmailEnvironment
from agent_eval.environments.functions_runtime import FunctionsRuntime
from agent_eval.storage.sqlite_store import SqliteStore
from agent_eval.trajectory import AgentTrajectory, TrajectoryStep


# ── TrajectoryStep ────────────────────────────────────────────────────────

class TestTrajectoryStep:
    def test_basic_fields(self):
        step = TrajectoryStep(
            step_k=1,
            tool_call={"name": "send_email", "kwargs": {"to": "a@b.com"}},
            observation={"status": "ok"},
        )
        assert step.step_k == 1
        assert step.reasoning is None
        assert step.tool_call["name"] == "send_email"

    def test_with_reasoning(self):
        step = TrajectoryStep(
            step_k=2,
            reasoning="I need to check the inbox",
            tool_call={"name": "get_emails", "kwargs": {}},
            observation={"status": "ok", "result": []},
        )
        assert step.reasoning == "I need to check the inbox"


# ── AgentTrajectory ───────────────────────────────────────────────────────

class TestAgentTrajectory:
    def test_add_step_increments(self):
        traj = AgentTrajectory(task_id="t1")
        traj.add_step("tool_a", {}, {"status": "ok"})
        traj.add_step("tool_b", {"x": 1}, {"status": "ok"})
        assert len(traj.steps) == 2
        assert traj.steps[0].step_k == 1
        assert traj.steps[1].step_k == 2

    def test_add_step_returns_step(self):
        traj = AgentTrajectory(task_id="t1")
        step = traj.add_step("tool_a", {}, {"status": "ok"}, reasoning="test")
        assert isinstance(step, TrajectoryStep)
        assert step.reasoning == "test"

    def test_to_yaml_roundtrip(self):
        traj = AgentTrajectory(task_id="email-task")
        traj.add_step("send_email", {"to": "x@y.com"}, {"status": "ok"})
        traj.final_output = "done"

        yaml_str = traj.to_yaml()
        assert "email-task" in yaml_str
        assert "send_email" in yaml_str

        restored = AgentTrajectory.from_yaml(yaml_str)
        assert restored.task_id == "email-task"
        assert len(restored.steps) == 1
        assert restored.final_output == "done"
        assert restored.steps[0].tool_call["name"] == "send_email"

    def test_to_dict(self):
        traj = AgentTrajectory(task_id="t2")
        traj.add_step("get_emails", {}, {"result": []})
        d = traj.to_dict()
        assert d["task_id"] == "t2"
        assert isinstance(d["steps"], list)

    def test_from_yaml_empty_steps(self):
        traj = AgentTrajectory(task_id="empty")
        yaml_str = traj.to_yaml()
        restored = AgentTrajectory.from_yaml(yaml_str)
        assert restored.steps == []


# ── FunctionsRuntime trajectory integration ───────────────────────────────

class TestFunctionsRuntimeTrajectory:
    def _make_runtime_with_email(self) -> tuple[FunctionsRuntime, EmailEnvironment]:
        env = EmailEnvironment(inbox=[
            {"sender": "alice@test.com", "to": "me@test.com", "subject": "Hi", "body": "Hello"}
        ])
        traj = AgentTrajectory(task_id="email-eval-1")
        rt = FunctionsRuntime(trajectory=traj)
        rt.register_env(env, ["send_email", "get_emails", "delete_email", "mark_read"])
        return rt, env

    def test_auto_records_successful_call(self):
        rt, _ = self._make_runtime_with_email()
        rt.call_tool("get_emails", folder="inbox")
        assert len(rt.trajectory.steps) == 1
        assert rt.trajectory.steps[0].tool_call["name"] == "get_emails"
        assert rt.trajectory.steps[0].observation["status"] == "ok"

    def test_auto_records_multiple_calls(self):
        rt, _ = self._make_runtime_with_email()
        rt.call_tool("get_emails", folder="inbox")
        rt.call_tool("send_email", to="b@c.com", subject="Re", body="OK")
        rt.call_tool("get_emails", folder="outbox")
        assert len(rt.trajectory.steps) == 3
        assert rt.trajectory.steps[1].step_k == 2

    def test_records_error_call(self):
        rt, _ = self._make_runtime_with_email()
        rt.call_tool("nonexistent_tool")
        assert len(rt.trajectory.steps) == 1
        assert rt.trajectory.steps[0].observation["status"] == "error"

    def test_records_reasoning(self):
        rt, _ = self._make_runtime_with_email()
        rt.call_tool("get_emails", reasoning="Check what's in inbox", folder="inbox")
        assert rt.trajectory.steps[0].reasoning == "Check what's in inbox"

    def test_step_kwargs_stored(self):
        rt, _ = self._make_runtime_with_email()
        rt.call_tool("send_email", to="x@y.com", subject="Hi", body="Body")
        kwargs = rt.trajectory.steps[0].tool_call["kwargs"]
        assert kwargs["to"] == "x@y.com"
        assert kwargs["subject"] == "Hi"

    def test_no_trajectory_no_recording(self):
        env = EmailEnvironment()
        rt = FunctionsRuntime()
        rt.register_env(env, ["get_emails"])
        rt.call_tool("get_emails", folder="inbox")
        assert rt.trajectory is None


# ── SqliteStore ───────────────────────────────────────────────────────────

class TestSqliteStore:
    def _make_store(self) -> SqliteStore:
        tmp = tempfile.mktemp(suffix=".db")
        return SqliteStore(db_path=tmp)

    def test_create_and_get_run(self):
        store = self._make_store()
        run = store.create_run(task_id="t1")
        assert run["task_id"] == "t1"
        assert run["status"] == "running"
        assert run["steps_count"] == 0

        fetched = store.get_run(run["run_id"])
        assert fetched["run_id"] == run["run_id"]

    def test_list_runs(self):
        store = self._make_store()
        store.create_run(task_id="a")
        store.create_run(task_id="b")
        runs = store.list_runs()
        assert len(runs) == 2

    def test_update_run_status(self):
        store = self._make_store()
        run = store.create_run(task_id="t1")
        store.update_run(run["run_id"], status="done", steps_count=5)
        updated = store.get_run(run["run_id"])
        assert updated["status"] == "done"
        assert updated["steps_count"] == 5

    def test_save_and_get_trajectory(self):
        store = self._make_store()
        run = store.create_run(task_id="traj-task")
        traj = AgentTrajectory(task_id="traj-task")
        traj.add_step("get_emails", {}, {"status": "ok"})
        traj.add_step("send_email", {"to": "x"}, {"status": "ok"})
        store.save_trajectory(run["run_id"], traj)

        restored = store.get_trajectory(run["run_id"])
        assert restored.task_id == "traj-task"
        assert len(restored.steps) == 2

    def test_save_trajectory_updates_steps_count(self):
        store = self._make_store()
        run = store.create_run(task_id="t2")
        traj = AgentTrajectory(task_id="t2")
        for _ in range(4):
            traj.add_step("get_emails", {}, {"status": "ok"})
        store.save_trajectory(run["run_id"], traj)
        updated = store.get_run(run["run_id"])
        assert updated["steps_count"] == 4

    def test_delete_run_cleans_trajectory(self):
        store = self._make_store()
        run = store.create_run(task_id="t3")
        traj = AgentTrajectory(task_id="t3")
        traj.add_step("get_emails", {}, {})
        store.save_trajectory(run["run_id"], traj)
        store.delete_run(run["run_id"])
        with pytest.raises(KeyError):
            store.get_run(run["run_id"])
        with pytest.raises(KeyError):
            store.get_trajectory(run["run_id"])

    def test_get_missing_run_raises(self):
        store = self._make_store()
        with pytest.raises(KeyError):
            store.get_run("does-not-exist")
