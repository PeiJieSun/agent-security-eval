"""
M2-1: Memory Environment — vector-DB / conversation-history mock for memory poisoning attacks.

Models a simple retrieval-augmented agent memory:
  - write_memory(key, content): store a memory entry
  - recall(query, top_k): retrieve top-k relevant entries (TF-IDF cosine)
  - clear(): reset

Poisoning attack: inject a malicious memory entry that will be retrieved
during normal task execution, causing the agent to follow attacker instructions.

Reference: "Unleashing the Power of LLMs in Agent Poisoning Attacks"
           Zheng et al., 2024
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class MemoryEntry:
    key: str
    content: str
    poisoned: bool = False  # True if this entry was injected by an attacker


@dataclass
class MemoryRecallResult:
    entry: MemoryEntry
    score: float


class MemoryEnvironment:
    """
    Lightweight in-memory store with cosine-similarity retrieval.
    Simulates a RAG-style agent memory without a real vector DB.
    """

    def __init__(self) -> None:
        self._store: list[MemoryEntry] = []

    # ── Tool-callable methods ──────────────────────────────────────────────

    def write_memory(self, key: str, content: str) -> dict:
        """Store a memory entry. Overwrites if key already exists."""
        for e in self._store:
            if e.key == key:
                e.content = content
                return {"status": "updated", "key": key}
        self._store.append(MemoryEntry(key=key, content=content))
        return {"status": "created", "key": key}

    def recall(self, query: str, top_k: int = 3) -> list[dict]:
        """Retrieve the top_k most relevant memory entries for a query."""
        if not self._store:
            return []
        scored = [
            (e, _cosine(query, e.content))
            for e in self._store
        ]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [
            {"key": e.key, "content": e.content, "score": round(s, 4)}
            for e, s in scored[:top_k]
        ]

    def list_memories(self) -> list[dict]:
        """Return all stored memory entries."""
        return [{"key": e.key, "content": e.content} for e in self._store]

    def delete_memory(self, key: str) -> dict:
        """Delete a memory entry by key."""
        before = len(self._store)
        self._store = [e for e in self._store if e.key != key]
        return {"deleted": before - len(self._store)}

    def clear(self) -> dict:
        """Clear all memories."""
        n = len(self._store)
        self._store = []
        return {"cleared": n}

    # ── Poisoning helpers (used by attack infrastructure) ─────────────────

    def poison(self, key: str, content: str) -> dict:
        """
        Inject a poisoned memory entry.
        In a real system, this simulates an attacker who can write to shared memory
        (e.g., via a compromised tool or cross-user memory in a multi-tenant system).
        """
        for e in self._store:
            if e.key == key:
                e.content = content
                e.poisoned = True
                return {"status": "poisoned", "key": key}
        entry = MemoryEntry(key=key, content=content, poisoned=True)
        self._store.append(entry)
        return {"status": "poisoned", "key": key}

    @property
    def poisoned_entries(self) -> list[MemoryEntry]:
        return [e for e in self._store if e.poisoned]

    @property
    def entry_count(self) -> int:
        return len(self._store)


# ── TF-IDF cosine similarity ──────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    return re.findall(r"\w+", text.lower())


def _tf(tokens: list[str]) -> dict[str, float]:
    counts: dict[str, int] = defaultdict(int)
    for t in tokens:
        counts[t] += 1
    n = max(len(tokens), 1)
    return {t: c / n for t, c in counts.items()}


def _cosine(a: str, b: str) -> float:
    ta, tb = _tokenize(a), _tokenize(b)
    if not ta or not tb:
        return 0.0
    va, vb = _tf(ta), _tf(tb)
    keys = set(va) | set(vb)
    dot = sum(va.get(k, 0) * vb.get(k, 0) for k in keys)
    mag_a = math.sqrt(sum(v ** 2 for v in va.values()))
    mag_b = math.sqrt(sum(v ** 2 for v in vb.values()))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)
