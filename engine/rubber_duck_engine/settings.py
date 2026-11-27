"""The settings of the engine, and the environment that Cognee reads.

The engine reads its settings from the environment. It never logs a secret or a key.
Cognee reads a .env file and its log settings when Python imports it. So the package pins these values
before any module imports Cognee (see __init__.py).
"""

from __future__ import annotations

import os
import tempfile
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MODEL = "anthropic/claude-haiku-5-5"
DEFAULT_PORT = 8790

# The engine keeps each file that Cognee can write in this folder, outside the repository.
WORK_DIRECTORY = Path(tempfile.gettempdir()) / "rubber-duck-engine"


class SettingsError(Exception):
    """A setting is missing or wrong. The message names the setting, never its value."""


@dataclass(frozen=True)
class Settings:
    engine_secret: str
    # The model in the LiteLLM form, for example anthropic/claude-haiku-5-5.
    llm_model: str
    llm_api_key: str
    # The model address. None means the Anthropic API.
    llm_endpoint: str | None
    port: int
    # The address to listen on. A container needs all addresses. npm run engine sets 127.0.0.1.
    host: str = "0.0.0.0"

    @property
    def model_name(self) -> str:
        """The model name without the provider part, for example claude-haiku-5-5."""
        return self.llm_model.split("/", 1)[-1]


def _required(environ: Mapping[str, str], name: str) -> str:
    value = environ.get(name, "").strip()
    if not value:
        raise SettingsError(f"Set the environment variable {name}.")
    return value


def load_settings(environ: Mapping[str, str]) -> Settings:
    """Read the settings from the environment. Raises SettingsError when a setting is missing or wrong."""
    port_text = environ.get("PORT", "").strip()
    port = DEFAULT_PORT
    if port_text:
        if not port_text.isdigit() or not 1 <= int(port_text) <= 65_535:
            raise SettingsError("PORT must be a port number.")
        port = int(port_text)
    endpoint = environ.get("LLM_ENDPOINT", "").strip() or None
    if endpoint is not None and not endpoint.startswith(("http://", "https://")):
        raise SettingsError("LLM_ENDPOINT must be an http or https address.")
    return Settings(
        engine_secret=_required(environ, "ENGINE_SECRET"),
        llm_model=environ.get("LLM_MODEL", "").strip() or DEFAULT_MODEL,
        llm_api_key=_required(environ, "LLM_API_KEY"),
        llm_endpoint=endpoint,
        port=port,
        host=environ.get("HOST", "").strip() or "0.0.0.0",
    )


def pin_cognee_environment(environ: MutableMapping[str, str] = os.environ) -> None:
    """Set the values that Cognee reads when Python imports it.

    The engine pins the env file of Cognee to an empty file. Without this pin, Cognee loads the .env file
    of the repository and lets its values replace the values of the environment.
    """
    WORK_DIRECTORY.mkdir(parents=True, exist_ok=True)
    env_file = WORK_DIRECTORY / "cognee.env"
    env_file.write_text("# The topic engine pins Cognee to this empty file.\n", encoding="utf-8")
    environ["COGNEE_ENV_FILE"] = str(env_file)
    environ["TELEMETRY_DISABLED"] = "1"
    # The engine works only with the litellm_native path of Cognee. extract.py depends on it.
    environ["STRUCTURED_OUTPUT_FRAMEWORK"] = "litellm_native"
    # LiteLLM reads its model list from the package, not from the internet. So the model features stay fixed.
    environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
    # Cognee can log fragments of a model answer in a warning. The engine never logs lesson text.
    environ.setdefault("LOG_LEVEL", "ERROR")
    environ.setdefault("COGNEE_LOG_FILE", "false")
    environ.setdefault("COGNEE_LOGS_DIR", str(WORK_DIRECTORY / "logs"))
    environ.setdefault("DATA_ROOT_DIRECTORY", str(WORK_DIRECTORY / "data"))
    environ.setdefault("SYSTEM_ROOT_DIRECTORY", str(WORK_DIRECTORY / "system"))
    environ.setdefault("LLM_PROVIDER", "anthropic")
    if not environ.get("LLM_MODEL", "").strip():
        environ["LLM_MODEL"] = DEFAULT_MODEL
