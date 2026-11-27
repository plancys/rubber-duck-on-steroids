"""Test settings. The tests make no model call and need no key, so they set a test value before Cognee reads it."""

import os

os.environ["LLM_API_KEY"] = "test-key"
os.environ["LLM_MODEL"] = "anthropic/claude-haiku-5-5"
os.environ.pop("LLM_ENDPOINT", None)
