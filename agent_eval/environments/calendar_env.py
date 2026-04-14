"""
CalendarEnvironment — stateful calendar / meeting simulation.

Models a user's calendar with meetings. Tools are registered on
FunctionsRuntime; this module owns state only.
"""
from __future__ import annotations

import uuid
from copy import deepcopy
from typing import Any, Optional

from pydantic import BaseModel, Field

from agent_eval.environments.base import (
    AgentTaskEnvironment,
    EnvironmentState,
    FieldSnapshot,
)


class Meeting(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    title: str = ""
    date: str = ""        # ISO-8601 date string e.g. "2025-06-01"
    time: str = ""        # e.g. "14:00"
    duration_min: int = 60
    attendees: list[str] = Field(default_factory=list)
    location: str = ""
    notes: str = ""
    organizer: str = "user@local"


class CalendarEnvironment(AgentTaskEnvironment):
    """
    Stateful calendar environment.

    Supports create / list / get / update / delete meeting operations.
    All mutations return observation dicts suitable as tool return values.
    """

    def __init__(
        self,
        meetings: Optional[list[dict]] = None,
    ) -> None:
        self._initial = [
            Meeting(**m) if isinstance(m, dict) else deepcopy(m)
            for m in (meetings or [])
        ]
        self.meetings: list[Meeting] = deepcopy(self._initial)

    # ── AgentTaskEnvironment interface ────────────────────────────────────

    def snapshot(self) -> EnvironmentState:
        fields: list[FieldSnapshot] = []
        for i, m in enumerate(self.meetings):
            fields.append(FieldSnapshot.from_value(f"meetings[{i}].id", m.id))
            fields.append(FieldSnapshot.from_value(f"meetings[{i}].title", m.title))
            fields.append(FieldSnapshot.from_value(f"meetings[{i}].date", m.date))
            fields.append(FieldSnapshot.from_value(f"meetings[{i}].attendees",
                                                   ",".join(m.attendees)))
        return EnvironmentState(fields=fields)

    def reset(self) -> None:
        self.meetings = deepcopy(self._initial)

    # ── Tool actions ──────────────────────────────────────────────────────

    def list_meetings(self, date: str = "") -> list[dict[str, Any]]:
        """List calendar meetings, optionally filtered by date."""
        if date:
            items = [m for m in self.meetings if m.date == date]
        else:
            items = list(self.meetings)
        return [m.model_dump() for m in items]

    def get_meeting(self, meeting_id: str) -> dict[str, Any]:
        """Get details of a meeting by ID."""
        for m in self.meetings:
            if m.id == meeting_id:
                return m.model_dump()
        return {"status": "error", "detail": f"meeting {meeting_id!r} not found"}

    def create_meeting(
        self,
        title: str,
        date: str,
        time: str = "09:00",
        duration_min: str = "60",
        attendees: str = "",
        location: str = "",
        notes: str = "",
    ) -> dict[str, Any]:
        """Create a new calendar meeting."""
        meeting = Meeting(
            title=title,
            date=date,
            time=time,
            duration_min=int(duration_min) if str(duration_min).isdigit() else 60,
            attendees=[a.strip() for a in attendees.split(",") if a.strip()],
            location=location,
            notes=notes,
        )
        self.meetings.append(meeting)
        return {"status": "ok", "meeting_id": meeting.id, "title": title, "date": date}

    def update_meeting(
        self,
        meeting_id: str,
        title: str = "",
        date: str = "",
        time: str = "",
        attendees: str = "",
        notes: str = "",
    ) -> dict[str, Any]:
        """Update fields of an existing meeting."""
        for m in self.meetings:
            if m.id == meeting_id:
                if title:
                    m.title = title
                if date:
                    m.date = date
                if time:
                    m.time = time
                if attendees:
                    m.attendees = [a.strip() for a in attendees.split(",") if a.strip()]
                if notes:
                    m.notes = notes
                return {"status": "ok", "meeting_id": meeting_id, "updated": True}
        return {"status": "error", "detail": f"meeting {meeting_id!r} not found"}

    def delete_meeting(self, meeting_id: str) -> dict[str, Any]:
        """Delete a meeting by ID."""
        before = len(self.meetings)
        self.meetings = [m for m in self.meetings if m.id != meeting_id]
        if len(self.meetings) == before:
            return {"status": "error", "detail": f"meeting {meeting_id!r} not found"}
        return {"status": "ok", "deleted_id": meeting_id}

    def send_meeting_invite(self, meeting_id: str, recipient: str) -> dict[str, Any]:
        """Send a meeting invitation to a recipient."""
        for m in self.meetings:
            if m.id == meeting_id:
                if recipient not in m.attendees:
                    m.attendees.append(recipient)
                return {"status": "ok", "meeting_id": meeting_id, "invited": recipient}
        return {"status": "error", "detail": f"meeting {meeting_id!r} not found"}


CALENDAR_TOOLS = [
    "list_meetings", "get_meeting", "create_meeting",
    "update_meeting", "delete_meeting", "send_meeting_invite",
]
