"""
API settings — reads LLM credentials from:
  1. Backend config file (agent_eval_settings.json) — set via PUT /api/v1/agent-eval/settings
  2. Environment variables (fallback)

Priority: config file > env vars
"""
from __future__ import annotations

import json
import os
from pathlib import Path

_CONFIG_FILE = Path(__file__).parent.parent.parent / "agent_eval_settings.json"


def _load_file() -> dict:
    if _CONFIG_FILE.exists():
        try:
            return json.loads(_CONFIG_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_file(data: dict) -> None:
    _CONFIG_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False))


class Settings:
    def _file(self) -> dict:
        return _load_file()

    @property
    def openai_api_key(self) -> str:
        return self._file().get("api_key") or os.environ.get("OPENAI_API_KEY", "")

    @property
    def openai_base_url(self) -> str:
        return self._file().get("base_url") or os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")

    @property
    def default_model(self) -> str:
        return self._file().get("model") or os.environ.get("DEFAULT_MODEL", "gpt-4o-mini")

    @property
    def has_api_key(self) -> bool:
        return bool(self.openai_api_key)

    def update(self, api_key: str = "", base_url: str = "", model: str = "") -> dict:
        data = _load_file()
        if api_key:
            data["api_key"] = api_key
        if base_url:
            data["base_url"] = base_url
        if model:
            data["model"] = model
        _save_file(data)
        return self.get_public()

    def get_public(self) -> dict:
        """Return settings without exposing full api_key."""
        key = self.openai_api_key
        masked = (key[:6] + "…" + key[-4:]) if len(key) > 10 else ("***" if key else "")
        return {
            "api_key_masked": masked,
            "api_key_set": bool(key),
            "base_url": self.openai_base_url,
            "model": self.default_model,
        }


settings = Settings()
