"""
FileSystemEnvironment — in-memory file system simulation.

Models a user's local file system with read/write/delete/list operations.
File content can carry IPI payloads — returned by read_file, injected by
InjectionRuntime targeting the "body" field_path on a virtual path.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Optional

from agent_eval.environments.base import (
    AgentTaskEnvironment,
    EnvironmentState,
    FieldSnapshot,
)


class FileSystemEnvironment(AgentTaskEnvironment):
    """
    Stateful in-memory file system environment.

    Files are stored as {path: content} dicts. Supports read, write,
    append, delete, list_dir, and search_files operations.
    """

    def __init__(
        self,
        files: Optional[dict[str, str]] = None,
    ) -> None:
        self._initial: dict[str, str] = deepcopy(files or {})
        self.files: dict[str, str] = deepcopy(self._initial)

    # ── AgentTaskEnvironment interface ────────────────────────────────────

    def snapshot(self) -> EnvironmentState:
        fields: list[FieldSnapshot] = []
        for path, content in sorted(self.files.items()):
            fields.append(FieldSnapshot.from_value(f"file:{path}:exists", True))
            fields.append(FieldSnapshot.from_value(f"file:{path}:content", content))
        return EnvironmentState(fields=fields)

    def reset(self) -> None:
        self.files = deepcopy(self._initial)

    # ── Tool actions ──────────────────────────────────────────────────────

    def read_file(self, path: str) -> dict[str, Any]:
        """Read the content of a file at the given path."""
        if path not in self.files:
            return {"status": "error", "detail": f"File not found: {path}"}
        return {"status": "ok", "path": path, "content": self.files[path]}

    def write_file(self, path: str, content: str) -> dict[str, Any]:
        """Write content to a file (creates or overwrites)."""
        self.files[path] = content
        return {"status": "ok", "path": path, "bytes_written": len(content)}

    def append_file(self, path: str, content: str) -> dict[str, Any]:
        """Append content to an existing file."""
        if path not in self.files:
            self.files[path] = content
        else:
            self.files[path] += content
        return {"status": "ok", "path": path, "bytes_appended": len(content)}

    def delete_file(self, path: str) -> dict[str, Any]:
        """Delete a file by path."""
        if path not in self.files:
            return {"status": "error", "detail": f"File not found: {path}"}
        del self.files[path]
        return {"status": "ok", "deleted_path": path}

    def list_dir(self, directory: str = "/") -> dict[str, Any]:
        """List files in a directory (prefix match on path)."""
        prefix = directory.rstrip("/") + "/"
        if directory in ("/", ""):
            matching = list(self.files.keys())
        else:
            matching = [p for p in self.files if p.startswith(prefix)]
        return {"status": "ok", "directory": directory, "files": matching}

    def search_files(self, query: str, directory: str = "/") -> dict[str, Any]:
        """Search for files whose content contains the query string."""
        prefix = directory.rstrip("/") + "/"
        results = []
        for path, content in self.files.items():
            if directory not in ("/", "") and not path.startswith(prefix):
                continue
            if query.lower() in content.lower():
                results.append({"path": path, "snippet": content[:200]})
        return {"status": "ok", "query": query, "matches": results}

    def move_file(self, source: str, destination: str) -> dict[str, Any]:
        """Move (rename) a file from source to destination path."""
        if source not in self.files:
            return {"status": "error", "detail": f"File not found: {source}"}
        self.files[destination] = self.files.pop(source)
        return {"status": "ok", "source": source, "destination": destination}


FILESYSTEM_TOOLS = [
    "read_file", "write_file", "append_file", "delete_file",
    "list_dir", "search_files", "move_file",
]
