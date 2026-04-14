"""
M1-1 acceptance tests for TaskEnvironment.

Covers all subtasks:
  st-01/02  FieldSnapshot + EnvironmentState
  st-03     AgentTaskEnvironment.diff()
  st-04     EmailEnvironment skeleton + snapshot
  st-05     send_email action
  st-06     get_emails + delete_email actions
  st-07/08  FunctionsRuntime register + call
  st-09     dump_env / load_env round-trip
"""
import pytest

from agent_eval.environments.base import (
    AgentTaskEnvironment,
    EnvironmentState,
    FieldSnapshot,
    StateDiff,
    dump_env,
    load_env,
)
from agent_eval.environments.email_env import Email, EmailEnvironment
from agent_eval.environments.functions_runtime import FunctionsRuntime


# ── st-01 / st-02: FieldSnapshot + EnvironmentState ──────────────────────

def test_field_snapshot_creation():
    fs = FieldSnapshot.from_value("inbox.count", 3)
    assert fs.path == "inbox.count"
    assert fs.value == 3
    assert len(fs.hash) == 32  # md5 hex

def test_field_snapshot_hash_deterministic():
    a = FieldSnapshot.from_value("x", "hello")
    b = FieldSnapshot.from_value("x", "hello")
    assert a.hash == b.hash

def test_environment_state_get_hit_and_miss():
    fs = FieldSnapshot.from_value("a.b", 42)
    state = EnvironmentState(fields=[fs])
    assert state.get("a.b") is fs
    assert state.get("missing") is None

def test_environment_state_as_dict():
    state = EnvironmentState(fields=[
        FieldSnapshot.from_value("x", 1),
        FieldSnapshot.from_value("y", 2),
    ])
    assert state.as_dict() == {"x": 1, "y": 2}


# ── st-03: AgentTaskEnvironment.diff() ───────────────────────────────────

def test_diff_empty_states():
    pre = EnvironmentState()
    post = EnvironmentState()
    d = AgentTaskEnvironment.diff(pre, post)
    assert d == StateDiff()

def test_diff_detects_added_and_removed():
    pre = EnvironmentState(fields=[FieldSnapshot.from_value("a", 1)])
    post = EnvironmentState(fields=[FieldSnapshot.from_value("b", 2)])
    d = AgentTaskEnvironment.diff(pre, post)
    assert "a" in d.removed
    assert "b" in d.added
    assert d.modified == []

def test_diff_detects_modified():
    pre = EnvironmentState(fields=[FieldSnapshot.from_value("x", "old")])
    post = EnvironmentState(fields=[FieldSnapshot.from_value("x", "new")])
    d = AgentTaskEnvironment.diff(pre, post)
    assert "x" in d.modified
    assert d.added == []
    assert d.removed == []


# ── st-04: EmailEnvironment snapshot ─────────────────────────────────────

def test_email_env_empty_snapshot():
    env = EmailEnvironment()
    state = env.snapshot()
    assert len(state.fields) == 0

def test_email_env_snapshot_captures_inbox():
    env = EmailEnvironment(inbox=[{"sender": "alice", "to": "bob", "subject": "Hi", "body": "Hello"}])
    state = env.snapshot()
    paths = [f.path for f in state.fields]
    assert any("inbox[0].subject" in p for p in paths)


# ── st-05: send_email ─────────────────────────────────────────────────────

def test_send_email_appends_to_outbox():
    env = EmailEnvironment()
    pre = env.snapshot()
    obs = env.send_email(to="bob@example.com", subject="Meeting", body="Let's meet")
    post = env.snapshot()
    assert obs["status"] == "ok"
    assert len(env.outbox) == 1
    assert env.outbox[0].subject == "Meeting"
    diff = AgentTaskEnvironment.diff(pre, post)
    assert any("outbox" in p for p in diff.added)

def test_send_email_returns_sent_id():
    env = EmailEnvironment()
    obs = env.send_email(to="x@y.com", subject="S", body="B")
    assert "sent_id" in obs
    assert obs["sent_id"] == env.outbox[-1].id


# ── st-06: get_emails + delete_email ─────────────────────────────────────

def test_get_emails_inbox():
    env = EmailEnvironment(inbox=[{"subject": "Test", "sender": "a", "to": "b", "body": "x"}])
    emails = env.get_emails("inbox")
    assert len(emails) == 1
    assert emails[0]["subject"] == "Test"

def test_get_emails_outbox_empty():
    env = EmailEnvironment()
    assert env.get_emails("outbox") == []

def test_delete_email_removes_from_inbox():
    env = EmailEnvironment(inbox=[{"id": "abc123", "subject": "Del me", "sender": "a", "to": "b", "body": "x"}])
    obs = env.delete_email("inbox", "abc123")
    assert obs["status"] == "ok"
    assert len(env.inbox) == 0

def test_delete_email_not_found_returns_error():
    env = EmailEnvironment()
    obs = env.delete_email("inbox", "nonexistent")
    assert obs["status"] == "error"


# ── st-07/08: FunctionsRuntime ────────────────────────────────────────────

def test_register_and_call_tool():
    rt = FunctionsRuntime()
    rt.register_tool("add", lambda a, b: a + b)
    obs = rt.call_tool("add", a=3, b=4)
    assert obs["status"] == "ok"
    assert obs["result"] == 7

def test_call_unknown_tool_returns_error():
    rt = FunctionsRuntime()
    obs = rt.call_tool("nonexistent")
    assert obs["status"] == "error"
    assert "not registered" in obs["error"]

def test_register_env_bulk():
    env = EmailEnvironment()
    rt = FunctionsRuntime()
    rt.register_env(env, ["send_email", "get_emails", "delete_email"])
    assert set(["send_email", "get_emails", "delete_email"]).issubset(set(rt.available_tools()))

def test_tool_exception_returns_error_observation():
    rt = FunctionsRuntime()
    rt.register_tool("boom", lambda: 1 / 0)
    obs = rt.call_tool("boom")
    assert obs["status"] == "error"
    assert "ZeroDivisionError" in obs["error"]

def test_email_env_via_runtime():
    env = EmailEnvironment()
    rt = FunctionsRuntime()
    rt.register_env(env, ["send_email", "get_emails", "delete_email"])
    obs = rt.call_tool("send_email", to="x@y.com", subject="Via RT", body="test")
    assert obs["status"] == "ok"
    emails = rt.call_tool("get_emails", folder="outbox")
    # get_emails returns a list, wrapped in result key
    outbox = emails.get("result", emails)
    assert isinstance(outbox, list) and len(outbox) == 1


# ── st-09: environment.yaml round-trip ───────────────────────────────────

def test_dump_env_produces_valid_yaml():
    import yaml
    env = EmailEnvironment(inbox=[{"subject": "S", "sender": "a", "to": "b", "body": "x"}])
    state = env.snapshot()
    yaml_str = dump_env(state)
    parsed = yaml.safe_load(yaml_str)
    assert "fields" in parsed

def test_load_env_round_trip():
    env = EmailEnvironment(inbox=[{"subject": "RT test", "sender": "a", "to": "b", "body": "body"}])
    state = env.snapshot()
    loaded = load_env(dump_env(state))
    assert len(loaded.fields) == len(state.fields)
    for orig, restored in zip(state.fields, loaded.fields):
        assert orig.path == restored.path
        assert orig.hash == restored.hash

def test_load_env_empty():
    state = load_env(dump_env(EnvironmentState()))
    assert state.fields == []


# ── reset() ──────────────────────────────────────────────────────────────

def test_email_env_reset():
    env = EmailEnvironment(inbox=[{"subject": "Keep", "sender": "a", "to": "b", "body": "x"}])
    env.send_email(to="z", subject="Sent", body="hi")
    env.reset()
    assert len(env.outbox) == 0
    assert len(env.inbox) == 1
    assert env.inbox[0].subject == "Keep"
