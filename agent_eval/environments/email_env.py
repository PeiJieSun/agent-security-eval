"""
EmailEnvironment — stateful inbox / outbox simulation.

Models the email surface used by AgentDojo's Workspace suite.
Tools are registered on FunctionsRuntime; this module only owns the state.
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


class Email(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    sender: str = ""
    to: str = ""
    subject: str = ""
    body: str = ""
    read: bool = False


class EmailEnvironment(AgentTaskEnvironment):
    """
    Stateful email environment with inbox and outbox.

    All mutations return an observation dict so they can be used as tool
    return values in a FunctionsRuntime.
    """

    def __init__(
        self,
        inbox: Optional[list[dict]] = None,
        outbox: Optional[list[dict]] = None,
    ) -> None:
        self._initial_inbox = [Email(**e) if isinstance(e, dict) else deepcopy(e)
                               for e in (inbox or [])]
        self._initial_outbox = [Email(**e) if isinstance(e, dict) else deepcopy(e)
                                for e in (outbox or [])]
        self.inbox: list[Email] = deepcopy(self._initial_inbox)
        self.outbox: list[Email] = deepcopy(self._initial_outbox)

    # ── AgentTaskEnvironment interface ────────────────────────────────────

    def snapshot(self) -> EnvironmentState:
        fields: list[FieldSnapshot] = []
        for i, e in enumerate(self.inbox):
            fields.append(FieldSnapshot.from_value(f"inbox[{i}].id", e.id))
            fields.append(FieldSnapshot.from_value(f"inbox[{i}].subject", e.subject))
            fields.append(FieldSnapshot.from_value(f"inbox[{i}].body", e.body))
        for i, e in enumerate(self.outbox):
            fields.append(FieldSnapshot.from_value(f"outbox[{i}].id", e.id))
            fields.append(FieldSnapshot.from_value(f"outbox[{i}].subject", e.subject))
            fields.append(FieldSnapshot.from_value(f"outbox[{i}].body", e.body))
        return EnvironmentState(fields=fields)

    def reset(self) -> None:
        self.inbox = deepcopy(self._initial_inbox)
        self.outbox = deepcopy(self._initial_outbox)

    # ── Tool actions ──────────────────────────────────────────────────────

    def send_email(self, to: str, subject: str, body: str, sender: str = "agent@local") -> dict[str, Any]:
        """Send an email: appends to outbox, returns observation."""
        email = Email(sender=sender, to=to, subject=subject, body=body)
        self.outbox.append(email)
        return {"status": "ok", "sent_id": email.id, "to": to, "subject": subject}

    def get_emails(self, folder: str = "inbox") -> list[dict[str, Any]]:
        """List emails in a folder ('inbox' or 'outbox')."""
        store = self.inbox if folder == "inbox" else self.outbox
        return [e.model_dump() for e in store]

    def delete_email(self, folder: str, email_id: str) -> dict[str, Any]:
        """Delete an email by id. Returns error observation if not found."""
        store = self.inbox if folder == "inbox" else self.outbox
        before = len(store)
        remaining = [e for e in store if e.id != email_id]
        if folder == "inbox":
            self.inbox = remaining
        else:
            self.outbox = remaining
        if len(remaining) == before:
            return {"status": "error", "detail": f"email {email_id!r} not found in {folder}"}
        return {"status": "ok", "deleted_id": email_id, "folder": folder}

    def mark_read(self, email_id: str) -> dict[str, Any]:
        """Mark an inbox email as read."""
        for e in self.inbox:
            if e.id == email_id:
                e.read = True
                return {"status": "ok", "email_id": email_id}
        return {"status": "error", "detail": f"email {email_id!r} not found"}
