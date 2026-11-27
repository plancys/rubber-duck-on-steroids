// The client of the topic engine. The rest of the worker knows the engine only through this module,
// so a second engine is a change of one module.
// The engine gets the passages of one lesson and gives the candidate topics and relations (POST /extract).
// GET /health gives the engine name and the prompt version. The handler compares them with the stored results.
// The client never logs. The handler writes one log line for each lesson, with no text, quote or topic name.

import { setTimeout as delay } from "node:timers/promises";
import type { Fetch } from "../courses/http.ts";

// The most time for one extract call. The engine stops its own model call after 240 seconds.
export const EXTRACT_TIMEOUT_MS = 300_000;
// The most time for the health call. A Cloud Run engine with no instance needs time to start.
export const HEALTH_TIMEOUT_MS = 60_000;
// The wait before the second try of a call.
export const RETRY_WAIT_MS = 2_000;

// The limits of the request contract of the engine.
const MAX_TITLE_CHARACTERS = 1_000;
const MAX_URL_CHARACTERS = 2_048;
const MAX_HEADING_CHARACTERS = 1_000;
const MAX_HEADINGS = 10;

export interface EnginePassage {
  ref: string;
  headingPath: string[];
  text: string;
}

export interface EngineKnownTopic {
  ref: number;
  name: string;
  aliases: string[];
}

export interface ExtractInput {
  // The job id and the lesson position go to the log line of the engine.
  jobId: string;
  lessonPosition: number;
  lesson: { url: string; title: string };
  passages: EnginePassage[];
  knownTopics: EngineKnownTopic[];
}

// The answer of the engine. The topics and the relations are not checked yet. The schema check reads them.
export interface EngineAnswer {
  engine: string;
  promptVersion: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  topics: unknown[];
  relations: unknown[];
}

export interface EngineInfo {
  engine: string;
  promptVersion: string;
}

// The failure codes of a call:
// unreachable: no answer (a network error), or 429, 503 or 504. The engine does not run.
// timeout: no answer in the time limit.
// unauthorized: the engine refused the secret.
// bad_request, too_large: the engine refused the request.
// refusal, truncated, invalid_answer: the model gave no valid answer (422).
// model_error: the model call failed (502).
// bad_response: an answer that is not in the contract.
export type EngineFailureCode =
  | "unreachable"
  | "timeout"
  | "unauthorized"
  | "bad_request"
  | "too_large"
  | "refusal"
  | "truncated"
  | "invalid_answer"
  | "model_error"
  | "bad_response";

export interface EngineFailure {
  ok: false;
  code: EngineFailureCode;
  // The HTTP status, or null when no answer came.
  status: number | null;
  // The number of calls that the client sent.
  attempts: number;
}

export type ExtractOutcome = { ok: true; answer: EngineAnswer; attempts: number } | EngineFailure;
export type InfoOutcome = { ok: true; info: EngineInfo } | EngineFailure;

export interface TopicEngine {
  // Read the engine name and the prompt version.
  describe: (signal: AbortSignal) => Promise<InfoOutcome>;
  // Send the passages of one lesson. The promise rejects only when the job signal aborts.
  extractLesson: (input: ExtractInput, signal: AbortSignal) => Promise<ExtractOutcome>;
}

export interface EngineSettings {
  // The address of the engine, from TOPIC_ENGINE_URL.
  url: string;
  // The bearer secret, from TOPIC_ENGINE_SECRET.
  secret: string;
  // The fetch of Node. The unit tests give a fake fetch.
  fetch?: Fetch;
  extractTimeoutMs?: number;
  healthTimeoutMs?: number;
  retryWaitMs?: number;
}

type Attempt = { kind: "answer"; response: Response } | { kind: "failure"; code: "unreachable" | "timeout" };

const ERROR_CODES = new Set<string>(["refusal", "truncated", "invalid_answer"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

// Wait for a time. The wait ends with the abort reason when the job signal aborts.
async function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (ms <= 0) return;
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  }
}

// The answer of a call that gets one more try: no answer, a busy engine, or a failed model call.
function canTryAgain(attempt: Attempt): boolean {
  if (attempt.kind === "failure") return attempt.code === "unreachable";
  return [429, 502, 503, 504].includes(attempt.response.status);
}

// Read the answer of /extract. An answer outside the contract is bad_response.
export function readAnswer(value: unknown): EngineAnswer | null {
  if (!isRecord(value)) return null;
  const { engine, promptVersion, model, usage, topics, relations } = value;
  if (typeof engine !== "string" || !engine || typeof promptVersion !== "string" || !promptVersion) return null;
  if (typeof model !== "string" || !Array.isArray(topics) || !Array.isArray(relations)) return null;
  let tokens: EngineAnswer["usage"] = null;
  if (isRecord(usage) && isCount(usage.inputTokens) && isCount(usage.outputTokens)) {
    tokens = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
  }
  return { engine, promptVersion, model, usage: tokens, topics, relations };
}

// The request body of /extract, inside the limits of the engine contract.
function requestBody(input: ExtractInput): string {
  return JSON.stringify({
    lesson: {
      url: input.lesson.url.slice(0, MAX_URL_CHARACTERS),
      title: input.lesson.title.slice(0, MAX_TITLE_CHARACTERS),
    },
    passages: input.passages.map((passage) => ({
      ref: passage.ref,
      headingPath: passage.headingPath.slice(0, MAX_HEADINGS).map((title) => title.slice(0, MAX_HEADING_CHARACTERS)),
      text: passage.text,
    })),
    knownTopics: input.knownTopics,
  });
}

export function createTopicEngine(settings: EngineSettings): TopicEngine {
  const base = settings.url.replace(/\/+$/, "");
  const fetchEngine = settings.fetch ?? fetch;
  const extractTimeoutMs = settings.extractTimeoutMs ?? EXTRACT_TIMEOUT_MS;
  const healthTimeoutMs = settings.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
  const retryWaitMs = settings.retryWaitMs ?? RETRY_WAIT_MS;

  // Send one call. The job signal and the time limit both stop it.
  // A stop of the job rejects with the abort reason. Each other failure is a result.
  async function send(path: string, init: RequestInit, timeoutMs: number, signal: AbortSignal): Promise<Attempt> {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchEngine(base + path, { ...init, signal: AbortSignal.any([signal, timeout]) });
      return { kind: "answer", response };
    } catch {
      signal.throwIfAborted();
      if (timeout.aborted) return { kind: "failure", code: "timeout" };
      // A network error. The handler logs only the failure code.
      return { kind: "failure", code: "unreachable" };
    }
  }

  // Send a call, and send it one more time after a network error or a busy engine.
  async function sendWithRetry(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<{ attempt: Attempt; attempts: number }> {
    let attempt = await send(path, init, timeoutMs, signal);
    if (!canTryAgain(attempt)) return { attempt, attempts: 1 };
    if (attempt.kind === "answer") await attempt.response.body?.cancel();
    await wait(retryWaitMs, signal);
    attempt = await send(path, init, timeoutMs, signal);
    return { attempt, attempts: 2 };
  }

  // Read a JSON body. The job signal stops the read. A body that is not JSON gives null.
  async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      signal.throwIfAborted();
      return null;
    }
  }

  function failure(code: EngineFailureCode, status: number | null, attempts: number): EngineFailure {
    return { ok: false, code, status, attempts };
  }

  return {
    async describe(signal) {
      const { attempt, attempts } = await sendWithRetry("/health", { method: "GET" }, healthTimeoutMs, signal);
      if (attempt.kind === "failure") return failure(attempt.code, null, attempts);
      const { response } = attempt;
      if (!response.ok) {
        await response.body?.cancel();
        return failure(
          [429, 503, 504].includes(response.status) ? "unreachable" : "bad_response",
          response.status,
          attempts,
        );
      }
      const value = await readJson(response, signal);
      if (!isRecord(value) || typeof value.engine !== "string" || typeof value.promptVersion !== "string") {
        return failure("bad_response", response.status, attempts);
      }
      if (!value.engine || !value.promptVersion) return failure("bad_response", response.status, attempts);
      return { ok: true, info: { engine: value.engine, promptVersion: value.promptVersion } };
    },

    async extractLesson(input, signal) {
      const init: RequestInit = {
        method: "POST",
        headers: {
          authorization: `Bearer ${settings.secret}`,
          "content-type": "application/json",
          "x-job-id": input.jobId,
          "x-lesson-position": String(input.lessonPosition),
        },
        body: requestBody(input),
      };
      const { attempt, attempts } = await sendWithRetry("/extract", init, extractTimeoutMs, signal);
      if (attempt.kind === "failure") return failure(attempt.code, null, attempts);
      const { response } = attempt;
      const value = await readJson(response, signal);
      const { status } = response;
      if (status === 200) {
        const answer = readAnswer(value);
        return answer ? { ok: true, answer, attempts } : failure("bad_response", status, attempts);
      }
      if (status === 401) return failure("unauthorized", status, attempts);
      if (status === 400) return failure("bad_request", status, attempts);
      if (status === 413) return failure("too_large", status, attempts);
      if (status === 502) return failure("model_error", status, attempts);
      if (status === 429 || status === 503 || status === 504) return failure("unreachable", status, attempts);
      if (status === 422) {
        const code = isRecord(value) && typeof value.error === "string" ? value.error : "";
        return failure(ERROR_CODES.has(code) ? (code as EngineFailureCode) : "invalid_answer", status, attempts);
      }
      return failure("bad_response", status, attempts);
    },
  };
}
