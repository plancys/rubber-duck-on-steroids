import assert from "node:assert/strict";
import { test } from "node:test";
import type { Fetch } from "../courses/http.ts";
import { createTopicEngine, type ExtractInput } from "./engine.ts";

const ANSWER = {
  engine: "cognee-extract/1",
  promptVersion: "1",
  model: "claude-haiku-5-5",
  usage: { inputTokens: 1200, outputTokens: 400 },
  topics: [{ name: "MergeTree", description: "An engine.", sameAs: null, links: [] }],
  relations: [],
};

const INPUT: ExtractInput = {
  jobId: "job-1",
  lessonPosition: 3,
  lesson: { url: "https://docs.example/docs/merge-tree", title: "T".repeat(1_200) },
  passages: [{ ref: "P1", headingPath: ["MergeTree"], text: "The MergeTree engine." }],
  knownTopics: [{ ref: 1, name: "ClickHouse", aliases: [] }],
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

// A fake engine: each call takes the next reply. A reply "network" rejects like a fetch with no answer.
// A reply "hang" waits until the signal of the call aborts.
function fakeFetch(replies: (Response | "network" | "hang")[]) {
  const calls: Call[] = [];
  const fetchEngine: Fetch = (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    const reply = replies.shift() ?? "network";
    if (reply === "network") return Promise.reject(new TypeError("fetch failed"));
    if (reply === "hang") {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    }
    return Promise.resolve(reply);
  };
  return { fetchEngine, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function engineWith(replies: (Response | "network" | "hang")[], extractTimeoutMs?: number) {
  const { fetchEngine, calls } = fakeFetch(replies);
  const engine = createTopicEngine({
    url: "http://engine.test/",
    secret: "engine-secret",
    fetch: fetchEngine,
    retryWaitMs: 0,
    extractTimeoutMs,
  });
  return { engine, calls };
}

const signal = new AbortController().signal;

test("an extract call sends the request with the secret and the job headers, and returns the answer", async () => {
  const { engine, calls } = engineWith([json(200, ANSWER)]);
  assert.deepEqual(await engine.extractLesson(INPUT, signal), { ok: true, answer: ANSWER, attempts: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "http://engine.test/extract");
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer engine-secret");
  assert.equal(headers["x-job-id"], "job-1");
  assert.equal(headers["x-lesson-position"], "3");
  const body = JSON.parse(calls[0]?.init?.body as string) as { lesson: { title: string }; knownTopics: unknown };
  // The title stays inside the limit of the engine contract.
  assert.equal(body.lesson.title.length, 1_000);
  assert.deepEqual(body.knownTopics, INPUT.knownTopics);
});

test("a network error gets one more try, then the call fails as unreachable", async () => {
  const { engine, calls } = engineWith(["network", "network"]);
  assert.deepEqual(await engine.extractLesson(INPUT, signal), {
    ok: false,
    code: "unreachable",
    status: null,
    attempts: 2,
  });
  assert.equal(calls.length, 2);
});

test("a 502 answer gets one more try, and the second answer counts", async () => {
  const { engine, calls } = engineWith([json(502, { error: "model_error" }), json(200, ANSWER)]);
  assert.deepEqual(await engine.extractLesson(INPUT, signal), { ok: true, answer: ANSWER, attempts: 2 });
  assert.equal(calls.length, 2);
});

test("a second 502 answer fails the call as a model error", async () => {
  const { engine } = engineWith([json(502, { error: "model_error" }), json(502, { error: "model_error" })]);
  assert.deepEqual(await engine.extractLesson(INPUT, signal), {
    ok: false,
    code: "model_error",
    status: 502,
    attempts: 2,
  });
});

test("a 422 answer is final, with the code of the engine", async () => {
  for (const code of ["refusal", "truncated", "invalid_answer"]) {
    const { engine, calls } = engineWith([json(422, { error: code }), json(200, ANSWER)]);
    assert.deepEqual(await engine.extractLesson(INPUT, signal), { ok: false, code, status: 422, attempts: 1 });
    assert.equal(calls.length, 1);
  }
});

test("each other refusal of the engine is final", async () => {
  const cases = [
    [401, "unauthorized"],
    [400, "bad_request"],
    [413, "too_large"],
    [500, "bad_response"],
  ] as const;
  for (const [status, code] of cases) {
    const { engine, calls } = engineWith([json(status, { error: "x" }), json(200, ANSWER)]);
    assert.deepEqual(await engine.extractLesson(INPUT, signal), { ok: false, code, status, attempts: 1 });
    assert.equal(calls.length, 1);
  }
});

test("an answer outside the contract fails the call as a bad response", async () => {
  const { engine } = engineWith([json(200, { ...ANSWER, topics: "none" })]);
  assert.deepEqual(await engine.extractLesson(INPUT, signal), {
    ok: false,
    code: "bad_response",
    status: 200,
    attempts: 1,
  });
});

test("a call with no answer in the time limit fails as a timeout, with no second try", async () => {
  const { engine, calls } = engineWith(["hang", json(200, ANSWER)], 20);
  assert.deepEqual(await engine.extractLesson(INPUT, signal), {
    ok: false,
    code: "timeout",
    status: null,
    attempts: 1,
  });
  assert.equal(calls.length, 1);
});

test("a stop of the job rejects the call with the stop reason", async () => {
  const controller = new AbortController();
  const { engine } = engineWith(["hang"]);
  const call = engine.extractLesson(INPUT, controller.signal);
  controller.abort(new Error("The worker stops."));
  await assert.rejects(call, /The worker stops/);
});

test("the health call gives the engine name and the prompt version", async () => {
  const { engine, calls } = engineWith([json(200, { status: "ok", engine: "cognee-extract/1", promptVersion: "2" })]);
  assert.deepEqual(await engine.describe(signal), {
    ok: true,
    info: { engine: "cognee-extract/1", promptVersion: "2" },
  });
  assert.equal(calls[0]?.url, "http://engine.test/health");
});

test("a health call with no answer fails as unreachable after one more try", async () => {
  const { engine, calls } = engineWith(["network", "network"]);
  assert.deepEqual(await engine.describe(signal), { ok: false, code: "unreachable", status: null, attempts: 2 });
  assert.equal(calls.length, 2);
});
