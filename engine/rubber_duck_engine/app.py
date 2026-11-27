"""The HTTP service of the engine: GET /health and POST /extract.

The worker sends the passages of one lesson and gets the candidate topics and relations.
The engine writes one log line for each request: the job id and the lesson position (when the worker sends
them), the result, the token counts and the duration. It never logs the lesson text, the prompt, a quote,
a topic name, the secret or the key.

Run it with: uv run python -m rubber_duck_engine.app
"""

from __future__ import annotations

import hmac
import json
import os
import re
import sys
import time
from collections.abc import Awaitable, Callable
from typing import Annotated, Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from rubber_duck_engine.extract import (
    ExtractError,
    ExtractResult,
    LessonInput,
    Usage,
    extract_lesson,
    prepare_cognee,
)
from rubber_duck_engine.prompt import PROMPT_VERSION, KnownTopic, PassageInput
from rubber_duck_engine.settings import Settings, SettingsError, load_settings

ENGINE_NAME = "cognee-extract/1"
# The most characters of passage text in one request. Above it the engine answers 413.
MAX_PASSAGE_CHARACTERS = 200_000
# The most bytes of one request body. JSON escapes can make a body much longer than its text.
MAX_BODY_BYTES = 8_000_000

_JOB_ID = re.compile(r"^[A-Za-z0-9-]{1,64}$")


class LessonRef(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    title: str = Field(max_length=1000)


class PassageRequest(BaseModel):
    # The reference goes into a marker line of the content, so it is short and has no space.
    ref: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,32}$")]
    headingPath: list[Annotated[str, Field(max_length=1000)]] = Field(max_length=10)
    text: str


class KnownTopicRequest(BaseModel):
    ref: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=500)
    aliases: list[Annotated[str, Field(max_length=500)]] = Field(default_factory=list, max_length=50)


class ExtractRequest(BaseModel):
    lesson: LessonRef
    passages: list[PassageRequest] = Field(min_length=1)
    knownTopics: list[KnownTopicRequest] = Field(default_factory=list, max_length=1000)


Extractor = Callable[[LessonInput], Awaitable[ExtractResult]]


def _write_log(line: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(line) + "\n")
    sys.stdout.flush()


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": code})


def _usage_json(usage: Usage | None) -> dict[str, int] | None:
    if usage is None:
        return None
    return {"inputTokens": usage.input_tokens, "outputTokens": usage.output_tokens}


def _is_authorized(request: Request, secret: str) -> bool:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer":
        return False
    # compare_digest takes the same time for each wrong token of the same length.
    return hmac.compare_digest(token.strip().encode("utf-8"), secret.encode("utf-8"))


def _log_context(request: Request) -> dict[str, Any]:
    """The job id and the lesson position from the optional headers of the worker."""
    job_id = request.headers.get("x-job-id", "")
    position = request.headers.get("x-lesson-position", "")
    return {
        "jobId": job_id if _JOB_ID.match(job_id) else None,
        "lessonPosition": int(position) if position.isdigit() and len(position) <= 6 else None,
    }


def _to_lesson_input(body: ExtractRequest) -> LessonInput:
    return LessonInput(
        title=body.lesson.title,
        passages=[
            PassageInput(ref=passage.ref, heading_path=tuple(passage.headingPath), text=passage.text)
            for passage in body.passages
        ],
        known_topics=[
            KnownTopic(ref=topic.ref, name=topic.name, aliases=tuple(topic.aliases)) for topic in body.knownTopics
        ],
    )


def create_app(settings: Settings, extractor: Extractor = extract_lesson) -> FastAPI:
    app = FastAPI(title="Rubber Duck topic engine", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "engine": ENGINE_NAME, "promptVersion": PROMPT_VERSION}

    @app.post("/extract")
    async def extract(request: Request) -> JSONResponse:
        started = time.monotonic()
        context = _log_context(request)

        def log(result: str, usage: Usage | None = None, calls: int = 0, **extra: Any) -> None:
            _write_log(
                {
                    "event": "extract",
                    **context,
                    "result": result,
                    "inputTokens": usage.input_tokens if usage else None,
                    "outputTokens": usage.output_tokens if usage else None,
                    "calls": calls,
                    "durationMs": round((time.monotonic() - started) * 1000),
                    **extra,
                }
            )

        if not _is_authorized(request, settings.engine_secret):
            log("unauthorized")
            return _error(401, "unauthorized")
        length = request.headers.get("content-length", "")
        if length.isdigit() and int(length) > MAX_BODY_BYTES:
            log("too_large")
            return _error(413, "too_large")
        raw = await request.body()
        if len(raw) > MAX_BODY_BYTES:
            log("too_large")
            return _error(413, "too_large")
        try:
            body = ExtractRequest.model_validate_json(raw)
        except ValidationError:
            log("bad_request")
            return _error(400, "bad_request")
        if sum(len(passage.text) for passage in body.passages) > MAX_PASSAGE_CHARACTERS:
            log("too_large")
            return _error(413, "too_large")

        try:
            result = await extractor(_to_lesson_input(body))
        except ExtractError as error:
            cause = type(error.__cause__).__name__ if error.__cause__ is not None else None
            log(error.code, error.usage, error.calls, errorType=cause)
            if error.code == "model_error":
                return _error(502, error.code)
            return _error(422, error.code)

        log("ok", result.usage, result.calls, topics=len(result.topics), relations=len(result.relations))
        return JSONResponse(
            {
                "engine": ENGINE_NAME,
                "promptVersion": PROMPT_VERSION,
                "model": settings.model_name,
                "usage": _usage_json(result.usage),
                "topics": result.topics,
                "relations": result.relations,
            }
        )

    return app


def main() -> None:
    try:
        settings = load_settings(os.environ)
    except SettingsError as error:
        sys.stderr.write(f"The engine cannot start. {error}\n")
        raise SystemExit(1) from None
    prepare_cognee()
    import uvicorn

    source = "the model address in LLM_ENDPOINT" if settings.llm_endpoint else "the Anthropic API"
    _write_log({"event": "listening", "port": settings.port, "model": settings.model_name, "source": source})
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
