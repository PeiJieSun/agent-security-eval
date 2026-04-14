"""
SQLite-backed persistence for evaluation runs, trajectories, evals, and reports.

Schema
------
  runs:
    run_id       TEXT PRIMARY KEY
    task_id      TEXT NOT NULL
    status       TEXT NOT NULL  -- "running" | "done" | "error"
    steps_count  INTEGER NOT NULL DEFAULT 0
    created_at   TEXT NOT NULL   -- ISO-8601
    updated_at   TEXT NOT NULL

  trajectories:
    run_id       TEXT PRIMARY KEY
    yaml_blob    TEXT NOT NULL   -- AgentTrajectory.to_yaml()
    updated_at   TEXT NOT NULL

  evals:
    eval_id      TEXT PRIMARY KEY
    task_id      TEXT NOT NULL
    model        TEXT NOT NULL
    status       TEXT NOT NULL  -- "pending" | "running" | "done" | "error"
    error        TEXT
    created_at   TEXT NOT NULL
    updated_at   TEXT NOT NULL

  reports:
    eval_id      TEXT PRIMARY KEY
    json_blob    TEXT NOT NULL   -- AgentEvalReport.model_dump_json()
    created_at   TEXT NOT NULL

  safety_evals:
    safety_id    TEXT PRIMARY KEY
    eval_type    TEXT NOT NULL   -- "consistency" | "eval_awareness" | "cot_audit" | "backdoor_scan"
    task_id      TEXT NOT NULL
    model        TEXT NOT NULL
    status       TEXT NOT NULL  -- "pending" | "running" | "done" | "error"
    error        TEXT
    created_at   TEXT NOT NULL
    updated_at   TEXT NOT NULL

  safety_results:
    safety_id    TEXT PRIMARY KEY
    json_blob    TEXT NOT NULL   -- result model_dump_json()
    created_at   TEXT NOT NULL
"""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Optional

import json

from agent_eval.trajectory import AgentTrajectory

_DEFAULT_DB = Path(__file__).parent.parent.parent / "agent_eval.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SqliteStore:
    def __init__(self, db_path: Path | str = _DEFAULT_DB) -> None:
        self.db_path = Path(db_path)
        self._init_db()

    @contextmanager
    def _conn(self) -> Generator[sqlite3.Connection, None, None]:
        con = sqlite3.connect(self.db_path)
        con.row_factory = sqlite3.Row
        try:
            yield con
            con.commit()
        finally:
            con.close()

    def _init_db(self) -> None:
        with self._conn() as con:
            con.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                    run_id      TEXT PRIMARY KEY,
                    task_id     TEXT NOT NULL,
                    status      TEXT NOT NULL DEFAULT 'running',
                    steps_count INTEGER NOT NULL DEFAULT 0,
                    created_at  TEXT NOT NULL,
                    updated_at  TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS trajectories (
                    run_id      TEXT PRIMARY KEY,
                    yaml_blob   TEXT NOT NULL,
                    updated_at  TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS evals (
                    eval_id     TEXT PRIMARY KEY,
                    task_id     TEXT NOT NULL,
                    model       TEXT NOT NULL,
                    status      TEXT NOT NULL DEFAULT 'pending',
                    error       TEXT,
                    created_at  TEXT NOT NULL,
                    updated_at  TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS reports (
                    eval_id     TEXT PRIMARY KEY,
                    json_blob   TEXT NOT NULL,
                    created_at  TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS safety_evals (
                    safety_id   TEXT PRIMARY KEY,
                    eval_type   TEXT NOT NULL,
                    task_id     TEXT NOT NULL,
                    model       TEXT NOT NULL,
                    status      TEXT NOT NULL DEFAULT 'pending',
                    error       TEXT,
                    created_at  TEXT NOT NULL,
                    updated_at  TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS safety_results (
                    safety_id   TEXT PRIMARY KEY,
                    json_blob   TEXT NOT NULL,
                    created_at  TEXT NOT NULL
                );
            """)

    # ── Runs ──────────────────────────────────────────────────────────────

    def create_run(self, task_id: str, run_id: Optional[str] = None) -> dict:
        rid = run_id or ("run_" + uuid.uuid4().hex[:8])
        now = _now()
        with self._conn() as con:
            con.execute(
                "INSERT INTO runs (run_id, task_id, status, steps_count, created_at, updated_at) "
                "VALUES (?, ?, 'running', 0, ?, ?)",
                (rid, task_id, now, now),
            )
        return self.get_run(rid)

    def update_run(
        self,
        run_id: str,
        status: Optional[str] = None,
        steps_count: Optional[int] = None,
    ) -> dict:
        now = _now()
        with self._conn() as con:
            if status is not None:
                con.execute(
                    "UPDATE runs SET status=?, updated_at=? WHERE run_id=?",
                    (status, now, run_id),
                )
            if steps_count is not None:
                con.execute(
                    "UPDATE runs SET steps_count=?, updated_at=? WHERE run_id=?",
                    (steps_count, now, run_id),
                )
        return self.get_run(run_id)

    def get_run(self, run_id: str) -> dict:
        with self._conn() as con:
            row = con.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError(f"run {run_id!r} not found")
        return dict(row)

    def list_runs(self, limit: int = 50) -> list[dict]:
        with self._conn() as con:
            rows = con.execute(
                "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_run(self, run_id: str) -> None:
        with self._conn() as con:
            con.execute("DELETE FROM runs WHERE run_id=?", (run_id,))
            con.execute("DELETE FROM trajectories WHERE run_id=?", (run_id,))

    # ── Trajectories ──────────────────────────────────────────────────────

    def save_trajectory(self, run_id: str, traj: AgentTrajectory) -> None:
        now = _now()
        blob = traj.to_yaml()
        with self._conn() as con:
            con.execute(
                "INSERT OR REPLACE INTO trajectories (run_id, yaml_blob, updated_at) VALUES (?, ?, ?)",
                (run_id, blob, now),
            )
            con.execute(
                "UPDATE runs SET steps_count=?, updated_at=? WHERE run_id=?",
                (len(traj.steps), now, run_id),
            )

    def get_trajectory(self, run_id: str) -> AgentTrajectory:
        with self._conn() as con:
            row = con.execute(
                "SELECT yaml_blob FROM trajectories WHERE run_id=?", (run_id,)
            ).fetchone()
        if row is None:
            raise KeyError(f"trajectory for run {run_id!r} not found")
        return AgentTrajectory.from_yaml(row["yaml_blob"])

    # ── Evals ─────────────────────────────────────────────────────────────

    def create_eval(
        self, task_id: str, model: str, eval_id: Optional[str] = None
    ) -> dict:
        eid = eval_id or ("eval_" + uuid.uuid4().hex[:8])
        now = _now()
        with self._conn() as con:
            con.execute(
                "INSERT INTO evals (eval_id, task_id, model, status, created_at, updated_at) "
                "VALUES (?, ?, ?, 'pending', ?, ?)",
                (eid, task_id, model, now, now),
            )
        return self.get_eval(eid)

    def update_eval(
        self,
        eval_id: str,
        status: Optional[str] = None,
        error: Optional[str] = None,
    ) -> dict:
        now = _now()
        with self._conn() as con:
            if status is not None:
                con.execute(
                    "UPDATE evals SET status=?, updated_at=? WHERE eval_id=?",
                    (status, now, eval_id),
                )
            if error is not None:
                con.execute(
                    "UPDATE evals SET error=?, updated_at=? WHERE eval_id=?",
                    (error, now, eval_id),
                )
        return self.get_eval(eval_id)

    def get_eval(self, eval_id: str) -> dict:
        with self._conn() as con:
            row = con.execute("SELECT * FROM evals WHERE eval_id=?", (eval_id,)).fetchone()
        if row is None:
            raise KeyError(f"eval {eval_id!r} not found")
        return dict(row)

    def list_evals(self, limit: int = 50) -> list[dict]:
        with self._conn() as con:
            rows = con.execute(
                "SELECT * FROM evals ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_eval(self, eval_id: str) -> None:
        with self._conn() as con:
            con.execute("DELETE FROM evals WHERE eval_id=?", (eval_id,))
            con.execute("DELETE FROM reports WHERE eval_id=?", (eval_id,))

    # ── Reports ───────────────────────────────────────────────────────────

    def save_report(self, eval_id: str, report_dict: dict) -> None:
        now = _now()
        blob = json.dumps(report_dict, ensure_ascii=False)
        with self._conn() as con:
            con.execute(
                "INSERT OR REPLACE INTO reports (eval_id, json_blob, created_at) VALUES (?, ?, ?)",
                (eval_id, blob, now),
            )

    def get_report(self, eval_id: str) -> dict:
        with self._conn() as con:
            row = con.execute(
                "SELECT json_blob FROM reports WHERE eval_id=?", (eval_id,)
            ).fetchone()
        if row is None:
            raise KeyError(f"report for eval {eval_id!r} not found")
        return json.loads(row["json_blob"])

    # ── Safety Evals (M1-6, M2-5, M2-6, M2-7) ────────────────────────────

    def create_safety_eval(
        self,
        eval_type: str,
        task_id: str,
        model: str,
        safety_id: Optional[str] = None,
    ) -> dict:
        sid = safety_id or (eval_type[:4] + "_" + uuid.uuid4().hex[:8])
        now = _now()
        with self._conn() as con:
            con.execute(
                "INSERT INTO safety_evals "
                "(safety_id, eval_type, task_id, model, status, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
                (sid, eval_type, task_id, model, now, now),
            )
        return self.get_safety_eval(sid)

    def update_safety_eval(
        self,
        safety_id: str,
        status: Optional[str] = None,
        error: Optional[str] = None,
    ) -> dict:
        now = _now()
        with self._conn() as con:
            if status is not None:
                con.execute(
                    "UPDATE safety_evals SET status=?, updated_at=? WHERE safety_id=?",
                    (status, now, safety_id),
                )
            if error is not None:
                con.execute(
                    "UPDATE safety_evals SET error=?, updated_at=? WHERE safety_id=?",
                    (error, now, safety_id),
                )
        return self.get_safety_eval(safety_id)

    def get_safety_eval(self, safety_id: str) -> dict:
        with self._conn() as con:
            row = con.execute(
                "SELECT * FROM safety_evals WHERE safety_id=?", (safety_id,)
            ).fetchone()
        if row is None:
            raise KeyError(f"safety_eval {safety_id!r} not found")
        return dict(row)

    def list_safety_evals(self, eval_type: Optional[str] = None, limit: int = 50) -> list[dict]:
        with self._conn() as con:
            if eval_type:
                rows = con.execute(
                    "SELECT * FROM safety_evals WHERE eval_type=? ORDER BY created_at DESC LIMIT ?",
                    (eval_type, limit),
                ).fetchall()
            else:
                rows = con.execute(
                    "SELECT * FROM safety_evals ORDER BY created_at DESC LIMIT ?", (limit,)
                ).fetchall()
        return [dict(r) for r in rows]

    def delete_safety_eval(self, safety_id: str) -> None:
        with self._conn() as con:
            con.execute("DELETE FROM safety_evals WHERE safety_id=?", (safety_id,))
            con.execute("DELETE FROM safety_results WHERE safety_id=?", (safety_id,))

    def save_safety_result(self, safety_id: str, result_dict: dict) -> None:
        now = _now()
        blob = json.dumps(result_dict, ensure_ascii=False)
        with self._conn() as con:
            con.execute(
                "INSERT OR REPLACE INTO safety_results (safety_id, json_blob, created_at) "
                "VALUES (?, ?, ?)",
                (safety_id, blob, now),
            )

    def get_safety_result(self, safety_id: str) -> dict:
        with self._conn() as con:
            row = con.execute(
                "SELECT json_blob FROM safety_results WHERE safety_id=?", (safety_id,)
            ).fetchone()
        if row is None:
            raise KeyError(f"safety result for {safety_id!r} not found")
        return json.loads(row["json_blob"])
