import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { BLOCKED_REASON } from "../courses/crawl.ts";
import type { Fetch } from "../courses/http.ts";
import type { Course, CourseStore, Json, LessonRow } from "../queue.ts";
import { SafeError } from "../run.ts";
import {
  ADDRESS_REJECTED_REASON,
  COURSE_FAILED_REASON,
  createLoadCourse,
  NO_COURSE_REASON,
  NO_LESSON_LOADED_REASON,
  NO_LESSONS_REASON,
  START_FAILED_REASON,
  type CourseLog,
} from "./load-course.ts";

const START_HTML = readFileSync(new URL("../courses/fixtures/start.html", import.meta.url), "utf8");
const LESSON_HTML = readFileSync(new URL("../courses/fixtures/lesson.html", import.meta.url), "utf8");

const COURSE_ID = "0b7e2f0e-8d7a-4a51-9c1e-3f1f1d2a7c10";
const START_URL = "https://docs.example/docs/ducks";

function course(): Course {
  return {
    id: COURSE_ID,
    user_id: "user-1",
    source_url: START_URL,
    title: null,
    source_kind: "crawl",
    status: "loading",
    error: null,
    loaded_at: null,
    created_at: "2026-11-24T12:00:00Z",
    updated_at: "2026-11-24T12:00:00Z",
  };
}

interface StoreSetup {
  course?: Course | null;
  stored?: boolean;
  finishError?: Error;
}

// A course store in memory that records each call.
function fakeStore(setup: StoreSetup = {}) {
  const calls: { name: keyof CourseStore; args: unknown[] }[] = [];
  const store: CourseStore = {
    startCourseLoad: (...args) => {
      calls.push({ name: "startCourseLoad", args });
      return Promise.resolve(setup.course === undefined ? course() : setup.course);
    },
    finishCourseLoad: (...args) => {
      calls.push({ name: "finishCourseLoad", args });
      return setup.finishError ? Promise.reject(setup.finishError) : Promise.resolve(setup.stored ?? true);
    },
    failCourseLoad: (...args) => {
      calls.push({ name: "failCourseLoad", args });
      return Promise.resolve(setup.stored ?? true);
    },
  };
  return { store, calls };
}

interface Page {
  status?: number;
  body: string;
  type?: string;
}

// A fake site: robots.txt allows all but one lesson. The start page links 3 lessons, one of them answers 404.
// A page with the body NETWORK_ERROR gets no answer: the fetch rejects.
const NETWORK_ERROR = "network-error";

function fakeSite(pages: Record<string, Page> = {}) {
  const site: Record<string, Page> = {
    "https://docs.example/robots.txt": { body: "User-agent: *\nDisallow: /docs/ducks/private\n" },
    [START_URL]: { body: START_HTML },
    "https://docs.example/docs/ducks/first-steps": { body: LESSON_HTML },
    "https://docs.example/docs/ducks/second": { body: LESSON_HTML },
    ...pages,
  };
  const requested: string[] = [];
  const fetchPage: Fetch = (input) => {
    const url = input instanceof Request ? input.url : String(input);
    requested.push(url);
    const page = site[url] ?? { status: 404, body: "<html><body>Not found</body></html>" };
    if (page.body === NETWORK_ERROR) return Promise.reject(new TypeError("fetch failed"));
    const type = page.type ?? (url.endsWith("robots.txt") ? "text/plain" : "text/html");
    return Promise.resolve(new Response(page.body, { status: page.status ?? 200, headers: { "content-type": type } }));
  };
  return { fetchPage, requested };
}

// A fake DNS lookup: docs.example has a public address, unless the test makes it private.
function lookup(privateAddress: boolean) {
  return () => Promise.resolve([privateAddress ? "192.168.1.10" : "93.184.216.34"]);
}

function run(options: {
  payload?: Json;
  store?: StoreSetup;
  site?: ReturnType<typeof fakeSite>;
  signal?: AbortSignal;
  privateAddress?: boolean;
}) {
  const { store, calls } = fakeStore(options.store);
  const site = options.site ?? fakeSite();
  const lines: CourseLog[] = [];
  const steps: [number, number, string][] = [];
  const handler = createLoadCourse({
    courses: store,
    picker: null,
    fetch: site.fetchPage,
    lookup: lookup(options.privateAddress ?? false),
    log: (line) => {
      lines.push(line);
    },
  });
  const result = handler({
    jobId: "job-1",
    payload: options.payload ?? { courseId: COURSE_ID },
    attempt: 1,
    signal: options.signal ?? new AbortController().signal,
    step: (index, count, label) => {
      steps.push([index, count, label]);
      return Promise.resolve();
    },
  });
  return { result, calls, lines, steps, site };
}

test("a course load stores the lessons in course order, and a failed lesson does not fail the course", async () => {
  const { result, calls, lines, steps } = run({});
  assert.deepEqual(await result, { courseId: COURSE_ID, outcome: "ready", lessons: 4, loaded: 2, finder: "rule" });

  assert.deepEqual(
    calls.map((call) => call.name),
    ["startCourseLoad", "finishCourseLoad"],
  );
  const [courseId, title, lessons] = calls[1]?.args as [string, string, LessonRow[]];
  assert.equal(courseId, COURSE_ID);
  assert.equal(title, "Intro to Ducks");
  assert.deepEqual(
    lessons.map((lesson) => [lesson.position, lesson.url, lesson.status]),
    [
      [1, "https://docs.example/docs/ducks/first-steps", "loaded"],
      [2, "https://docs.example/docs/ducks/second", "loaded"],
      [3, "https://docs.example/docs/ducks/private", "failed"],
      [4, "https://docs.example/docs/ducks/missing", "failed"],
    ],
  );
  for (const lesson of lessons) {
    if (lesson.status === "loaded") assert.ok(lesson.markdown && !lesson.error);
    else assert.ok(lesson.markdown === null && lesson.error);
  }

  assert.deepEqual(steps.slice(0, 2), [
    [1, 2, "Reading the start page"],
    [2, 2, "Finding the lessons"],
  ]);
  assert.deepEqual(
    steps.slice(2).map(([index, count]) => [index, count]),
    [
      [3, 6],
      [4, 6],
      [5, 6],
      [6, 6],
    ],
  );

  // Each page has one log line with the job id, and no line holds the page text.
  const pages = lines.filter((line) => line.event === "page");
  assert.equal(pages.length, 5);
  assert.ok(lines.every((line) => line.jobId === "job-1"));
  assert.ok(!JSON.stringify(lines).includes("SELECT"));
  assert.ok(lines.some((line) => line.event === "lessons_found" && line.source === "rule" && line.count === 4));
});

// A check for assert.rejects: a SafeError with this reason and this retry choice.
function safeError(reason: string, retry: boolean) {
  return (error: unknown) => error instanceof SafeError && error.message === reason && error.retry === retry;
}

test("a blocked start page fails the course with the extension reason, and the job gets no new start", async () => {
  const site = fakeSite({ [START_URL]: { status: 403, body: "Forbidden" } });
  const { result, calls, lines } = run({ site });
  await assert.rejects(result, safeError(BLOCKED_REASON, false));
  assert.deepEqual(calls.at(-1), { name: "failCourseLoad", args: [COURSE_ID, BLOCKED_REASON] });
  assert.ok(lines.some((line) => line.event === "page" && line.result === "blocked" && line.status === 403));
});

test("a start page that robots.txt disallows fails the course with the extension reason, and the job gets no new start", async () => {
  const site = fakeSite({ "https://docs.example/robots.txt": { body: "User-agent: *\nDisallow: /\n" } });
  const { result, calls } = run({ site });
  await assert.rejects(result, safeError(BLOCKED_REASON, false));
  assert.deepEqual(calls.at(-1), { name: "failCourseLoad", args: [COURSE_ID, BLOCKED_REASON] });
  assert.deepEqual(site.requested, ["https://docs.example/robots.txt"]);
});

test("a start page on a private address fails the course with a safe reason, and the job gets no new start", async () => {
  const { result, calls, site } = run({ privateAddress: true });
  await assert.rejects(result, safeError(ADDRESS_REJECTED_REASON, false));
  assert.deepEqual(calls.at(-1), { name: "failCourseLoad", args: [COURSE_ID, ADDRESS_REJECTED_REASON] });
  assert.deepEqual(site.requested, []);
});

test("a robots.txt that does not answer fails the course as a network error, and the job gets a new start", async () => {
  for (const robots of [{ status: 503, body: "Unavailable" }, { body: NETWORK_ERROR }]) {
    const site = fakeSite({ "https://docs.example/robots.txt": robots });
    const { result, calls } = run({ site });
    await assert.rejects(result, safeError(START_FAILED_REASON, true));
    assert.deepEqual(calls.at(-1), { name: "failCourseLoad", args: [COURSE_ID, START_FAILED_REASON] });
    assert.deepEqual(site.requested, ["https://docs.example/robots.txt"]);
  }
});

test("a start page that answers 404 fails the course, and the job gets no new start", async () => {
  const site = fakeSite({ [START_URL]: { status: 404, body: "<html><body>Not found</body></html>" } });
  const { result, calls } = run({ site });
  await assert.rejects(result, safeError(START_FAILED_REASON, false));
  assert.deepEqual(calls.at(-1), { name: "failCourseLoad", args: [COURSE_ID, START_FAILED_REASON] });
});

test("a start page that is not HTML fails the course, and the job gets no new start", async () => {
  const site = fakeSite({ [START_URL]: { body: "{}", type: "application/json" } });
  const { result } = run({ site });
  await assert.rejects(result, safeError(START_FAILED_REASON, false));
});

test("a start page with no answer fails the course, and the job gets a new start", async () => {
  const site = fakeSite({ [START_URL]: { body: NETWORK_ERROR } });
  const { result, calls } = run({ site });
  await assert.rejects(result, safeError(START_FAILED_REASON, true));
  assert.deepEqual(calls.at(-1), { name: "failCourseLoad", args: [COURSE_ID, START_FAILED_REASON] });
});

test("a start page that answers 500 fails the course, and the job gets a new start", async () => {
  const site = fakeSite({ [START_URL]: { status: 500, body: "<html><body>Server error</body></html>" } });
  const { result } = run({ site });
  await assert.rejects(result, safeError(START_FAILED_REASON, true));
});

test("a start page without lesson links fails the course, and the job gets no new start", async () => {
  const site = fakeSite({ [START_URL]: { body: "<html><body><h1>Empty</h1><a href='/blog'>Blog</a></body></html>" } });
  const { result, calls } = run({ site });
  await assert.rejects(result, safeError(NO_LESSONS_REASON, false));
  assert.deepEqual(calls.at(-1), { name: "failCourseLoad", args: [COURSE_ID, NO_LESSONS_REASON] });
});

test("a course with no lesson page that loads fails the course, and the job gets a new start", async () => {
  const site = fakeSite({
    "https://docs.example/docs/ducks/first-steps": { status: 500, body: "Server error" },
    "https://docs.example/docs/ducks/second": { body: NETWORK_ERROR },
  });
  const { result, calls } = run({ site });
  await assert.rejects(result, safeError(NO_LESSON_LOADED_REASON, true));
  assert.deepEqual(calls.at(-1), { name: "failCourseLoad", args: [COURSE_ID, NO_LESSON_LOADED_REASON] });
});

test("a course that is gone ends the job without a crawl", async () => {
  const { result, calls, site } = run({ store: { course: null } });
  assert.deepEqual(await result, { courseId: COURSE_ID, outcome: "gone" });
  assert.deepEqual(
    calls.map((call) => call.name),
    ["startCourseLoad"],
  );
  assert.deepEqual(site.requested, []);
});

test("a course that goes away during the load ends the job without an error", async () => {
  const site = fakeSite({ [START_URL]: { status: 403, body: "Forbidden" } });
  const { result } = run({ site, store: { stored: false } });
  assert.deepEqual(await result, { courseId: COURSE_ID, outcome: "gone" });
});

test("a payload without a course id fails with a safe reason", async () => {
  const { result, calls } = run({ payload: { courseId: "not-a-uuid" } });
  await assert.rejects(result, (error: unknown) => error instanceof SafeError && error.message === NO_COURSE_REASON);
  assert.deepEqual(calls, []);
});

test("an unexpected error marks the course failed and goes to the runner", async () => {
  const { result, calls } = run({ store: { finishError: new Error("finish_course_load failed with status 500") } });
  await assert.rejects(result, /finish_course_load failed/);
  assert.deepEqual(calls.at(-1), { name: "failCourseLoad", args: [COURSE_ID, COURSE_FAILED_REASON] });
});

test("a stop leaves the course loading", async () => {
  const controller = new AbortController();
  controller.abort(new Error("The worker stops."));
  const { result, calls } = run({ signal: controller.signal });
  await assert.rejects(result, /The worker stops/);
  assert.deepEqual(
    calls.map((call) => call.name),
    ["startCourseLoad"],
  );
});
