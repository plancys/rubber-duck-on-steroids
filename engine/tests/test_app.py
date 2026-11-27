"""Tests of the HTTP service. A fake extractor replaces the model call."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from rubber_duck_engine.app import ENGINE_NAME, MAX_PASSAGE_CHARACTERS, create_app
from rubber_duck_engine.extract import ExtractError, ExtractResult, LessonInput, Usage
from rubber_duck_engine.prompt import PROMPT_VERSION
from rubber_duck_engine.settings import WORK_DIRECTORY, Settings, SettingsError, load_settings

SECRET = "test-engine-secret"
SETTINGS = Settings(
    engine_secret=SECRET,
    llm_model="anthropic/claude-haiku-5-5",
    llm_api_key="test-key",
    llm_endpoint=None,
    port=8790,
)
FIXTURE = Path(__file__).parent / "fixtures" / "lesson.md"

REQUEST: dict[str, Any] = {
    "lesson": {"url": "https://example.com/docs/transactions", "title": "Transactions"},
    "passages": [
        {"ref": "P1", "headingPath": ["Transactions", "Isolation levels"], "text": "Repeatable read is a level."}
    ],
    "knownTopics": [{"ref": 1, "name": "ACID", "aliases": ["ACID properties"]}],
}

TOPICS = [
    {
        "name": "Repeatable read",
        "description": "An isolation level.",
        "sameAs": None,
        "links": [{"passage": "P1", "role": "explains", "quote": "Repeatable read is a level."}],
    }
]
RELATIONS = [{"kind": "prerequisite", "from": "ACID", "to": "Repeatable read", "reason": "Why.", "passage": "P1"}]


class FakeExtractor:
    def __init__(self, error: ExtractError | None = None) -> None:
        self.error = error
        self.inputs: list[LessonInput] = []

    async def __call__(self, lesson: LessonInput) -> ExtractResult:
        self.inputs.append(lesson)
        if self.error is not None:
            raise self.error
        return ExtractResult(topics=TOPICS, relations=RELATIONS, usage=Usage(1200, 400), calls=1)


def client_for(extractor: FakeExtractor) -> TestClient:
    return TestClient(create_app(SETTINGS, extractor))


def auth(secret: str = SECRET) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}"}


def test_health_answers_200() -> None:
    response = client_for(FakeExtractor()).get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_extract_returns_the_contract() -> None:
    extractor = FakeExtractor()
    response = client_for(extractor).post("/extract", json=REQUEST, headers=auth())
    assert response.status_code == 200
    assert response.json() == {
        "engine": ENGINE_NAME,
        "promptVersion": PROMPT_VERSION,
        "model": "claude-haiku-5-5",
        "usage": {"inputTokens": 1200, "outputTokens": 400},
        "topics": TOPICS,
        "relations": RELATIONS,
    }
    lesson = extractor.inputs[0]
    assert lesson.title == "Transactions"
    assert lesson.passages[0].ref == "P1"
    assert list(lesson.passages[0].heading_path) == ["Transactions", "Isolation levels"]
    assert lesson.known_topics[0].ref == 1
    assert list(lesson.known_topics[0].aliases) == ["ACID properties"]


def test_usage_is_null_without_numbers() -> None:
    class NoUsage(FakeExtractor):
        async def __call__(self, lesson: LessonInput) -> ExtractResult:
            return ExtractResult(topics=[], relations=[], usage=None, calls=1)

    response = client_for(NoUsage()).post("/extract", json=REQUEST, headers=auth())
    assert response.status_code == 200
    assert response.json()["usage"] is None


@pytest.mark.parametrize("headers", [{}, auth("wrong-secret"), {"Authorization": SECRET}, auth("")])
def test_a_wrong_secret_gives_401(headers: dict[str, str]) -> None:
    extractor = FakeExtractor()
    response = client_for(extractor).post("/extract", json=REQUEST, headers=headers)
    assert response.status_code == 401
    assert response.json() == {"error": "unauthorized"}
    assert extractor.inputs == []


def test_a_request_above_the_size_limit_gives_413() -> None:
    extractor = FakeExtractor()
    half = MAX_PASSAGE_CHARACTERS // 2
    body = {
        **REQUEST,
        "passages": [
            {"ref": "P1", "headingPath": [], "text": "a" * half},
            {"ref": "P2", "headingPath": [], "text": "b" * (half + 1)},
        ],
    }
    response = client_for(extractor).post("/extract", json=body, headers=auth())
    assert response.status_code == 413
    assert response.json() == {"error": "too_large"}
    assert extractor.inputs == []


def test_a_request_at_the_size_limit_passes() -> None:
    body = {**REQUEST, "passages": [{"ref": "P1", "headingPath": [], "text": "a" * MAX_PASSAGE_CHARACTERS}]}
    response = client_for(FakeExtractor()).post("/extract", json=body, headers=auth())
    assert response.status_code == 200


@pytest.mark.parametrize(
    "body",
    [
        {"lesson": {"url": "https://example.com", "title": "T"}, "passages": []},
        {**REQUEST, "passages": [{"ref": "P 1", "headingPath": [], "text": "x"}]},
        {"passages": REQUEST["passages"]},
    ],
)
def test_a_request_outside_the_contract_gives_400(body: dict[str, Any]) -> None:
    response = client_for(FakeExtractor()).post("/extract", json=body, headers=auth())
    assert response.status_code == 400
    assert response.json() == {"error": "bad_request"}


def test_a_body_that_is_not_json_gives_400() -> None:
    response = client_for(FakeExtractor()).post("/extract", content=b"{not json", headers=auth())
    assert response.status_code == 400


@pytest.mark.parametrize("code", ["refusal", "truncated", "invalid_answer"])
def test_no_valid_answer_gives_422_with_the_code(code: str) -> None:
    extractor = FakeExtractor(ExtractError(code, Usage(10, 5), 1))
    response = client_for(extractor).post("/extract", json=REQUEST, headers=auth())
    assert response.status_code == 422
    assert response.json() == {"error": code}


def test_a_failed_model_call_gives_502() -> None:
    extractor = FakeExtractor(ExtractError("model_error", None, 1))
    response = client_for(extractor).post("/extract", json=REQUEST, headers=auth())
    assert response.status_code == 502
    assert response.json() == {"error": "model_error"}


def test_the_log_line_holds_counts_and_no_text(capsys: pytest.CaptureFixture[str]) -> None:
    headers = {**auth(), "X-Job-Id": "4f6c1e2a-0000-4000-8000-000000000001", "X-Lesson-Position": "3"}
    client_for(FakeExtractor()).post("/extract", json=REQUEST, headers=headers)
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines() if line.startswith("{")]
    assert lines[-1]["event"] == "extract"
    assert lines[-1]["jobId"] == "4f6c1e2a-0000-4000-8000-000000000001"
    assert lines[-1]["lessonPosition"] == 3
    assert lines[-1]["result"] == "ok"
    assert (lines[-1]["inputTokens"], lines[-1]["outputTokens"]) == (1200, 400)
    assert isinstance(lines[-1]["durationMs"], int)
    text = json.dumps(lines)
    for secret_or_text in (SECRET, "Repeatable read", "ACID", "Transactions"):
        assert secret_or_text not in text


def test_the_fixture_lesson_fits_one_request() -> None:
    assert 0 < len(FIXTURE.read_text(encoding="utf-8")) < MAX_PASSAGE_CHARACTERS


def test_settings_need_the_secret_and_the_key() -> None:
    with pytest.raises(SettingsError, match="ENGINE_SECRET"):
        load_settings({"LLM_API_KEY": "k"})
    with pytest.raises(SettingsError, match="LLM_API_KEY"):
        load_settings({"ENGINE_SECRET": "s"})
    with pytest.raises(SettingsError, match="PORT"):
        load_settings({"ENGINE_SECRET": "s", "LLM_API_KEY": "k", "PORT": "port"})


def test_settings_have_defaults() -> None:
    settings = load_settings({"ENGINE_SECRET": "s", "LLM_API_KEY": "k"})
    assert settings.llm_model == "anthropic/claude-haiku-5-5"
    assert settings.model_name == "claude-haiku-5-5"
    assert settings.port == 8790
    assert settings.llm_endpoint is None


def test_cognee_reads_a_pinned_env_file_outside_the_repository() -> None:
    env_file = Path(os.environ["COGNEE_ENV_FILE"])
    assert env_file.parent == WORK_DIRECTORY
    assert env_file.is_file()
    repository = Path(__file__).resolve().parents[2]
    assert repository not in env_file.resolve().parents
    assert os.environ["TELEMETRY_DISABLED"]
