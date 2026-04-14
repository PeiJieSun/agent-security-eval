"""
API settings — reads LLM credentials from environment variables.

Environment variables
---------------------
OPENAI_API_KEY    (required for real eval runs)
OPENAI_BASE_URL   (default: https://api.openai.com/v1)
DEFAULT_MODEL     (default: gpt-4o-mini)
"""
from __future__ import annotations

import os


class Settings:
    @property
    def openai_api_key(self) -> str:
        return os.environ.get("OPENAI_API_KEY", "")

    @property
    def openai_base_url(self) -> str:
        return os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")

    @property
    def default_model(self) -> str:
        return os.environ.get("DEFAULT_MODEL", "gpt-4o-mini")

    @property
    def has_api_key(self) -> bool:
        return bool(self.openai_api_key)


settings = Settings()
