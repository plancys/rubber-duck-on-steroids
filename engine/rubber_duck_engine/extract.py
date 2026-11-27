"""One model call for one lesson through Cognee, and the map of the answer to the engine contract.

The engine calls extract_content_graph of Cognee and nothing else of Cognee: no add, no cognify, no store.

Cognee does not show the stop reason of the model. So the engine puts a guard around litellm.acompletion,
which the litellm_native path of Cognee calls. The guard reads the stop reason and the token counts of each
response before Cognee reads the content. A refusal and a cut answer stop the call at once, so Cognee does
not send the same lesson again in its JSON fallback.

Cognee retries a failed call until 2 attempts and 240 seconds pass. The worker has its own retry and a
timeout of 300 seconds, so the engine makes one attempt.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable, Sequence
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

import litellm
from cognee.infrastructure.llm.exceptions import ContentPolicyFilterError
from cognee.infrastructure.llm.extraction.knowledge_graph.extract_content_graph import extract_content_graph
from cognee.infrastructure.llm.structured_output_framework.litellm_native.native_adapter import (
    NativeLiteLLMAdapter,
)
from pydantic import ValidationError
from tenacity import stop_after_attempt

from rubber_duck_engine.model import LessonGraph
from rubber_duck_engine.prompt import KnownTopic, PassageInput, build_content, build_system_prompt

# The output token limit of one call. Thinking tokens count as output. LiteLLM sends 4,096 without a limit.
MAX_OUTPUT_TOKENS = 16_000
# The time limit of one model call. The worker stops a request to the engine after 300 seconds.
MODEL_TIMEOUT_SECONDS = 240

REFUSAL = "refusal"
TRUNCATED = "truncated"
INVALID_ANSWER = "invalid_answer"
MODEL_ERROR = "model_error"


@dataclass(frozen=True)
class Usage:
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class CallRecord:
    """The stop reason and the token counts of one model response. It holds no text."""

    stop: str | None
    input_tokens: int | None
    output_tokens: int | None


@dataclass(frozen=True)
class LessonInput:
    title: str
    passages: Sequence[PassageInput]
    known_topics: Sequence[KnownTopic]


@dataclass(frozen=True)
class ExtractResult:
    topics: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    usage: Usage | None
    calls: int


class ModelStop(Exception):
    """The model stopped with a refusal or a cut answer. The guard raises it inside the Cognee call."""

    def __init__(self, code: str) -> None:
        super().__init__(f"The model answer stopped: {code}.")
        self.code = code


class ExtractError(Exception):
    """The lesson has no valid answer. The code is refusal, truncated, invalid_answer or model_error."""

    def __init__(self, code: str, usage: Usage | None, calls: int) -> None:
        super().__init__(f"The extraction failed: {code}.")
        self.code = code
        self.usage = usage
        self.calls = calls


# The responses of the current extraction. None outside an extraction, so the guard changes nothing there.
_calls: ContextVar[list[CallRecord] | None] = ContextVar("rubber_duck_engine_calls", default=None)


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def read_call(response: object) -> CallRecord:
    """Read the stop reason and the token counts of one LiteLLM response.

    LiteLLM maps the Anthropic stop reason to finish_reason: max_tokens gives "length", refusal gives
    "content_filter". In its JSON tool mode LiteLLM sets finish_reason to "stop" and keeps a refusal in
    provider_specific_fields. So the guard reads both.
    """
    stop: str | None = None
    choices = getattr(response, "choices", None) or []
    if choices:
        choice = choices[0]
        finish_reason = getattr(choice, "finish_reason", None)
        message = getattr(choice, "message", None)
        fields = getattr(message, "provider_specific_fields", None)
        raw_stop = fields.get("stop_reason") if isinstance(fields, dict) else None
        if raw_stop == "refusal" or finish_reason == "content_filter" or getattr(message, "refusal", None):
            stop = REFUSAL
        elif finish_reason == "length" or raw_stop in ("max_tokens", "model_context_window_exceeded"):
            stop = TRUNCATED
    usage = getattr(response, "usage", None)
    return CallRecord(
        stop=stop,
        input_tokens=_int_or_none(getattr(usage, "prompt_tokens", None)),
        output_tokens=_int_or_none(getattr(usage, "completion_tokens", None)),
    )


def guard_completion(original: Callable[..., Awaitable[Any]]) -> Callable[..., Awaitable[Any]]:
    """Wrap litellm.acompletion. Inside an extraction, record each response and stop on a refusal or a cut."""

    async def guarded(*args: Any, **kwargs: Any) -> Any:
        response = await original(*args, **kwargs)
        calls = _calls.get()
        if calls is None or kwargs.get("stream"):
            return response
        record = read_call(response)
        calls.append(record)
        if record.stop is not None:
            raise ModelStop(record.stop)
        return response

    guarded.__wrapped__ = original  # type: ignore[attr-defined]
    return guarded


_prepared = False


def prepare_cognee() -> None:
    """Install the guard and the single attempt. Each later call does nothing."""
    global _prepared
    if _prepared:
        return
    retrying = getattr(NativeLiteLLMAdapter.acreate_structured_output, "retry", None)
    if retrying is None or not hasattr(retrying, "stop"):
        raise RuntimeError("Cognee changed the retry of its model call. Check the engine before an upgrade.")
    retrying.stop = stop_after_attempt(1)
    litellm.acompletion = guard_completion(litellm.acompletion)
    _prepared = True


def _usage_of(calls: Sequence[CallRecord]) -> Usage | None:
    """The sum of the token counts of all calls, or None when a call gave no numbers."""
    if not calls or any(call.input_tokens is None or call.output_tokens is None for call in calls):
        return None
    return Usage(
        input_tokens=sum(call.input_tokens or 0 for call in calls),
        output_tokens=sum(call.output_tokens or 0 for call in calls),
    )


def to_contract(graph: LessonGraph) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Map the answer model to the topics and relations of the engine answer."""
    topics = [
        {
            "name": topic.name,
            "description": topic.description,
            "sameAs": topic.same_as,
            "links": [{"passage": link.passage, "role": link.role, "quote": link.quote} for link in topic.links],
        }
        for topic in graph.topics
    ]
    relations = [
        {
            "kind": relation.kind,
            "from": relation.from_topic,
            "to": relation.to_topic,
            "reason": relation.reason,
            "passage": relation.passage,
        }
        for relation in graph.relations
    ]
    return topics, relations


async def extract_lesson(lesson: LessonInput) -> ExtractResult:
    """Ask the model for the topics and relations of one lesson. Raises ExtractError with a code."""
    prepare_cognee()
    content = build_content(lesson.title, lesson.passages)
    system_prompt = build_system_prompt(lesson.known_topics)
    calls: list[CallRecord] = []
    token = _calls.set(calls)
    try:
        try:
            graph = await extract_content_graph(
                content,
                LessonGraph,
                custom_prompt=system_prompt,
                max_tokens=MAX_OUTPUT_TOKENS,
                timeout=MODEL_TIMEOUT_SECONDS,
            )
        except ModelStop as stop:
            raise ExtractError(stop.code, _usage_of(calls), len(calls)) from None
        except (ContentPolicyFilterError, litellm.ContentPolicyViolationError):
            # The message of this error holds the lesson text. The engine drops it.
            raise ExtractError(REFUSAL, _usage_of(calls), len(calls)) from None
        except (ValidationError, json.JSONDecodeError):
            raise ExtractError(INVALID_ANSWER, _usage_of(calls), len(calls)) from None
        except Exception as error:
            raise ExtractError(MODEL_ERROR, _usage_of(calls), len(calls)) from error
    finally:
        _calls.reset(token)
    if not isinstance(graph, LessonGraph):
        raise ExtractError(INVALID_ANSWER, _usage_of(calls), len(calls))
    topics, relations = to_contract(graph)
    return ExtractResult(topics=topics, relations=relations, usage=_usage_of(calls), calls=len(calls))
