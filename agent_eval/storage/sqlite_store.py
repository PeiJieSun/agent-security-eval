"""
SQLite-backed persistence for evaluation runs and trajectories.

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
"""
from __future__ import annotations

import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator, Optional

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
