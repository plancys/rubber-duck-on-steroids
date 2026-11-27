import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json, LessonAnalysis, LessonAnalysisWrite, StoredTopic, TopicMapState, TopicStore } from "../queue.ts";
import { SafeError } from "../run.ts";
import type { EngineAnswer, EngineInfo, ExtractInput, ExtractOutcome, TopicEngine } from "../topics/engine.ts";
import { byAge } from "../topics/identity.ts";
import {
  ANALYSE_LABEL,
  BUILD_LABEL,
  createBuildTopicMap,
  ENGINE_UNREACHABLE_REASON,
  lessonHash,
  NO_ENGINE_REASON,
  NO_RESULT_REASON,
  type TopicLog,
} from "./build-topic-map.ts";
import { NO_COURSE_REASON } from "./load-course.ts";

const COURSE_ID = "0b7e2f0e-8d7a-4a51-9c1e-3f1f1d2a7c10";
const INFO: EngineInfo = { engine: "cognee-extract/1", promptVersion: "1" };

interface FakeLesson {
  url: string;
  position: number;
  title: string;
  markdown: string;
}

function courseLessons(): FakeLesson[] {
  return [
    {
      url: "https://docs.example/docs/merge-tree",
      position: 1,
      title: "MergeTree",
      markdown:
        "# MergeTree\n\nMergeTree stores data in parts.\n\n## Partition\n\nPartition splits the parts by a key.",
    },
    {
      url: "https://docs.example/docs/granule",
      position: 2,
      title: "Granules",
      markdown: "# Granule\n\nGranule is the smallest unit that MergeTree reads.",
    },
    {
      url: "https://docs.example/docs/replacing",
      position: 3,
      title: "ReplacingMergeTree",
      markdown: "# ReplacingMergeTree\n\nReplacingMergeTree removes duplicate rows. It is a MergeTree table engine.",
    },
  ];
}

// The database in memory. It keeps the rules of the database functions that the handler depends on.
function fakeDatabase(lessons: FakeLesson[] = courseLessons()) {
  const db = {
    lessons,
    analyses: new Map<string, LessonAnalysis>(),
    topics: new Map<string, StoredTopic>(),
    courseTopics: new Set<string>(),
    saves: [] as LessonAnalysisWrite[],
    finishes: [] as TopicMapState[],
  };
  const store: TopicStore = {
    startTopicMap: (courseId) => {
      if (courseId !== COURSE_ID) return Promise.resolve(null);
      return Promise.resolve(
        structuredClone({
          course: {
            id: COURSE_ID,
            user_id: "user-1",
            title: "ClickHouse",
            source_url: "https://docs.example/docs",
            source_kind: "crawl",
            status: "ready",
          },
          lessons: db.lessons.map((lesson) => ({
            url: lesson.url,
            position: lesson.position,
            title: lesson.title,
            content_hash: lessonHash(lesson.markdown),
          })),
          analyses: [...db.analyses.values()],
          topics: [...db.topics.values()].filter((topic) => db.courseTopics.has(topic.id)).sort(byAge),
        }),
      );
    },
    readLessonText: (_courseId, lessonUrl) =>
      Promise.resolve(db.lessons.find((lesson) => lesson.url === lessonUrl)?.markdown ?? null),
    saveLessonAnalysis: (write) => {
      db.saves.push(write);
      const old = db.analyses.get(write.lessonUrl);
      const base = {
        lesson_url: write.lessonUrl,
        content_hash: write.contentHash,
        analysed_at: "now",
        run_id: write.runId,
      };
      if (write.status === "failed") {
        // A failed lesson keeps the result and the engine fields of its last good analysis.
        db.analyses.set(write.lessonUrl, {
          engine: null,
          prompt_version: null,
          model: null,
          input_tokens: null,
          output_tokens: null,
          result: null,
          ...old,
          ...base,
          status: "failed",
          error: write.error,
        });
      } else {
        db.analyses.set(write.lessonUrl, {
          ...base,
          status: "analysed",
          error: null,
          engine: write.engine,
          prompt_version: write.promptVersion,
          model: write.model,
          input_tokens: write.inputTokens,
          output_tokens: write.outputTokens,
          result: JSON.parse(JSON.stringify(write.result)) as Json,
        });
      }
      return Promise.resolve(true);
    },
    finishTopicMap: (_courseId, _runId, state) => {
      db.finishes.push(structuredClone(state));
      const createdAt = `2026-11-27T10:00:${String(db.finishes.length).padStart(2, "0")}+00:00`;
      for (const topic of state.topics) {
        const old = db.topics.get(topic.id);
        db.topics.set(topic.id, {
          id: topic.id,
          name: topic.name,
          description: topic.description,
          merged_into: topic.merged_into,
          retired_at: topic.retired ? (old?.retired_at ?? createdAt) : null,
          created_at: old?.created_at ?? createdAt,
          home_lesson_url: topic.home_lesson_url,
          aliases: topic.aliases,
        });
      }
      db.courseTopics = new Set(state.topics.map((topic) => topic.id));
      return Promise.resolve(true);
    },
  };
  return { db, store };
}

type Reply = (input: ExtractInput) => ExtractOutcome;

function answer(topics: unknown[], relations: unknown[] = [], info: EngineInfo = INFO): ExtractOutcome {
  const body: EngineAnswer = {
    ...info,
    model: "claude-haiku-5-5",
    usage: { inputTokens: 10, outputTokens: 5 },
    topics,
    relations,
  };
  return { ok: true, answer: body, attempts: 1 };
}

// The default answer: one topic for each passage, named by its last heading, with the first two words as the quote.
// A topic with the name of a known topic gets its sameAs reference.
function headingTopics(input: ExtractInput, info: EngineInfo = INFO): ExtractOutcome {
  const topics = input.passages.map((passage) => {
    const name = passage.headingPath.at(-1) ?? "Introduction";
    return {
      name,
      description: `About ${name}.`,
      sameAs: input.knownTopics.find((known) => known.name === name)?.ref ?? null,
      links: [{ passage: passage.ref, role: "explains", quote: passage.text.split(/\s+/).slice(0, 2).join(" ") }],
    };
  });
  return answer(topics, [], info);
}

// A fake engine. The reply of a lesson comes from `replies` by its URL, else from the default answer.
function fakeEngine(setup: { info?: EngineInfo; replies?: Record<string, Reply>; onCall?: () => void } = {}) {
  const info = setup.info ?? INFO;
  const calls: ExtractInput[] = [];
  const engine: TopicEngine = {
    describe: () => Promise.resolve({ ok: true, info }),
    extractLesson: (input) => {
      calls.push(structuredClone(input));
      setup.onCall?.();
      const reply = setup.replies?.[input.lesson.url];
      return Promise.resolve(reply ? reply(input) : headingTopics(input, info));
    },
  };
  return { engine, calls };
}

function runJob(store: TopicStore, engine: TopicEngine | null, options: { signal?: AbortSignal; payload?: Json } = {}) {
  const lines: TopicLog[] = [];
  const steps: [number, number, string][] = [];
  const signal = options.signal ?? new AbortController().signal;
  const handler = createBuildTopicMap({
    topics: store,
    engine,
    log: (line) => {
      lines.push(line);
    },
    newRunId: () => "11111111-1111-4111-8111-111111111111",
    now: () => 0,
  });
  const result = handler({
    jobId: "job-1",
    payload: options.payload ?? { courseId: COURSE_ID },
    attempt: 1,
    signal,
    step: (index, count, label) => {
      signal.throwIfAborted();
      steps.push([index, count, label]);
      return Promise.resolve();
    },
  });
  return { result, lines, steps };
}

function safeError(reason: string, retry: boolean) {
  return (error: unknown) => error instanceof SafeError && error.message === reason && error.retry === retry;
}

// The ids of the stored topics by name.
function topicIds(db: ReturnType<typeof fakeDatabase>["db"]): Record<string, string> {
  return Object.fromEntries([...db.topics.values()].map((topic) => [topic.name, topic.id]));
}

test("a first run analyses each lesson in course order, stores each result at once, and writes the map", async () => {
  const { db, store } = fakeDatabase();
  const { engine, calls } = fakeEngine();
  const { result, lines, steps } = runJob(store, engine);
  assert.deepEqual(await result, {
    courseId: COURSE_ID,
    outcome: "ready",
    analysed: 3,
    reused: 0,
    failed: 0,
    topics: 4,
  });
  assert.deepEqual(
    calls.map((call) => [call.lessonPosition, call.passages.map((passage) => passage.ref)]),
    [
      [1, ["P1", "P2"]],
      [2, ["P1"]],
      [3, ["P1"]],
    ],
  );
  assert.deepEqual(steps, [
    [1, 4, ANALYSE_LABEL],
    [2, 4, ANALYSE_LABEL],
    [3, 4, ANALYSE_LABEL],
    [4, 4, BUILD_LABEL],
  ]);

  // Each result has its passages and the hash of the text that the job read.
  const first = db.saves.at(0);
  assert.ok(first);
  assert.equal(first.status, "analysed");
  assert.equal(first.contentHash, lessonHash(courseLessons()[0]?.markdown ?? ""));
  assert.deepEqual(
    first.passages?.map((passage) => [passage.position, passage.heading_path]),
    [
      [1, ["MergeTree"]],
      [2, ["MergeTree", "Partition"]],
    ],
  );
  assert.equal(db.finishes.length, 1);
  assert.deepEqual(Object.keys(topicIds(db)).sort(), ["Granule", "MergeTree", "Partition", "ReplacingMergeTree"]);

  // One log line for each lesson, and no line holds a lesson text, a quote or a topic name.
  assert.equal(lines.filter((line) => line.event === "lesson").length, 3);
  const logged = JSON.stringify(lines);
  for (const text of ["MergeTree", "Granule", "stores data"]) assert.ok(!logged.includes(text));
});

test("the known topics of a later lesson hold the topics of the earlier lessons of the same run", async () => {
  const { db, store } = fakeDatabase();
  const replacing = courseLessons()[2]?.url ?? "";
  const { engine, calls } = fakeEngine({
    replies: {
      [replacing]: (input) => {
        const mergeTree = input.knownTopics.find((known) => known.name === "MergeTree");
        return answer([
          {
            name: "ReplacingMergeTree",
            description: "An engine that removes duplicates.",
            sameAs: null,
            links: [{ passage: "P1", role: "explains", quote: "ReplacingMergeTree removes duplicate rows." }],
          },
          {
            name: "MergeTree table engine",
            description: "The base engine.",
            sameAs: mergeTree?.ref ?? null,
            links: [{ passage: "P1", role: "mentions", quote: "a MergeTree table engine" }],
          },
        ]);
      },
    },
  });
  await runJob(store, engine).result;
  // MergeTree comes from lesson 1 of this run. Granule and Partition share no word with the text of lesson 3.
  assert.deepEqual(
    calls[2]?.knownTopics.map((known) => known.name),
    ["MergeTree"],
  );
  const mergeTree = [...db.topics.values()].find((topic) => topic.name === "MergeTree");
  assert.deepEqual(
    mergeTree?.aliases.map((alias) => alias.alias),
    ["MergeTree", "MergeTree table engine"],
  );
  assert.ok([...db.topics.values()].some((topic) => topic.name === "ReplacingMergeTree"));
});

test("a second run with the same input makes no engine call and gives the same state and the same topic ids", async () => {
  const { db, store } = fakeDatabase();
  const { engine, calls } = fakeEngine();
  await runJob(store, engine).result;
  const ids = topicIds(db);
  const { result, steps } = runJob(store, engine);
  assert.deepEqual(await result, {
    courseId: COURSE_ID,
    outcome: "ready",
    analysed: 0,
    reused: 3,
    failed: 0,
    topics: 4,
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(steps, [[1, 1, BUILD_LABEL]]);
  assert.equal(db.finishes.length, 2);
  const [first, second] = db.finishes;
  assert.deepEqual(second.topics, first.topics);
  assert.deepEqual(second.links, first.links);
  assert.deepEqual(second.relations, first.relations);
  assert.deepEqual(second.overview, first.overview);
  assert.deepEqual(topicIds(db), ids);
});

test("a changed lesson gets one engine call, and each other lesson gets none", async () => {
  const { db, store } = fakeDatabase();
  const { engine, calls } = fakeEngine();
  await runJob(store, engine).result;
  const ids = topicIds(db);
  const granule = db.lessons[1];
  assert.ok(granule);
  granule.markdown = "# Granule\n\nGranule is the smallest unit that MergeTree reads. It holds 8192 rows.";
  const { result } = runJob(store, engine);
  assert.deepEqual(await result, {
    courseId: COURSE_ID,
    outcome: "ready",
    analysed: 1,
    reused: 2,
    failed: 0,
    topics: 4,
  });
  assert.deepEqual(
    calls.slice(3).map((call) => call.lesson.url),
    [granule.url],
  );
  assert.deepEqual(topicIds(db), ids);
});

test("a changed prompt version gives one engine call for each lesson, and each topic keeps its id", async () => {
  const { db, store } = fakeDatabase();
  await runJob(store, fakeEngine().engine).result;
  const ids = topicIds(db);
  const { engine, calls } = fakeEngine({ info: { engine: INFO.engine, promptVersion: "2" } });
  await runJob(store, engine).result;
  assert.equal(calls.length, 3);
  assert.deepEqual(topicIds(db), ids);
});

test("a topic with no link left gets retired_at, and it comes back with its old id when an alias name returns", async () => {
  const { db, store } = fakeDatabase();
  const { engine } = fakeEngine();
  await runJob(store, engine).result;
  const granuleId = topicIds(db).Granule;
  const lesson = db.lessons[1];
  assert.ok(granuleId);
  const original = lesson.markdown;

  lesson.markdown = "# Mark\n\nMark files point at the granules.";
  await runJob(store, engine).result;
  assert.ok(db.topics.get(granuleId)?.retired_at);
  assert.ok(db.courseTopics.has(granuleId));

  lesson.markdown = original;
  await runJob(store, engine).result;
  assert.equal(db.topics.get(granuleId)?.retired_at, null);
  assert.equal(db.finishes.at(-1)?.topics.find((topic) => topic.id === granuleId)?.home_lesson_url, lesson.url);
});

test("a failed lesson leaves the job done, and the next run calls the engine for that lesson only", async () => {
  const { db, store } = fakeDatabase();
  const granule = courseLessons()[1]?.url ?? "";
  const refusing = fakeEngine({
    replies: { [granule]: () => ({ ok: false, code: "refusal", status: 422, attempts: 1 }) },
  });
  const { result, lines } = runJob(store, refusing.engine);
  assert.deepEqual(await result, {
    courseId: COURSE_ID,
    outcome: "ready",
    analysed: 2,
    reused: 0,
    failed: 1,
    topics: 3,
  });
  assert.equal(db.analyses.get(granule)?.status, "failed");
  assert.equal(db.analyses.get(granule)?.error, "The model refused the lesson.");
  assert.ok(lines.some((line) => line.event === "lesson" && line.lessonPosition === 2 && line.result === "refusal"));

  const { engine, calls } = fakeEngine();
  await runJob(store, engine).result;
  assert.deepEqual(
    calls.map((call) => call.lesson.url),
    [granule],
  );
  assert.equal(db.analyses.get(granule)?.status, "analysed");
});

test("a run with no result for any lesson fails with a retry", async () => {
  const { db, store } = fakeDatabase();
  const refusal: Reply = () => ({ ok: false, code: "invalid_answer", status: 422, attempts: 1 });
  const { engine } = fakeEngine({
    replies: Object.fromEntries(courseLessons().map((lesson) => [lesson.url, refusal])),
  });
  await assert.rejects(runJob(store, engine).result, safeError(NO_RESULT_REASON, true));
  assert.equal(db.saves.length, 3);
  assert.equal(db.finishes.length, 0);
});

test("a missing engine address fails with no retry", async () => {
  const { db, store } = fakeDatabase();
  await assert.rejects(runJob(store, null).result, safeError(NO_ENGINE_REASON, false));
  assert.equal(db.saves.length, 0);
});

test("an engine that does not answer fails the job with a retry, and the course keeps its last map", async () => {
  const { db, store } = fakeDatabase();
  await runJob(store, fakeEngine().engine).result;
  const granule = db.lessons[1];
  assert.ok(granule);
  granule.markdown = "# Granule\n\nA granule holds 8192 rows.";
  const unreachable: Reply = () => ({ ok: false, code: "unreachable", status: null, attempts: 2 });
  const { engine } = fakeEngine({ replies: { [granule.url]: unreachable } });
  await assert.rejects(runJob(store, engine).result, safeError(ENGINE_UNREACHABLE_REASON, true));
  assert.equal(db.finishes.length, 1);
  assert.equal(db.saves.length, 3);

  const stopped: TopicEngine = {
    describe: () => Promise.resolve({ ok: false, code: "unreachable", status: null, attempts: 2 }),
    extractLesson: () => Promise.reject(new Error("No call is expected.")),
  };
  await assert.rejects(runJob(store, stopped).result, safeError(ENGINE_UNREACHABLE_REASON, true));
});

test("an abort between two lessons stops the run, and the stored results stay", async () => {
  const { db, store } = fakeDatabase();
  const controller = new AbortController();
  const stopping = fakeEngine({
    onCall: () => {
      controller.abort(new Error("The worker stops."));
    },
  });
  await assert.rejects(runJob(store, stopping.engine, { signal: controller.signal }).result, /The worker stops/);
  assert.equal(stopping.calls.length, 1);
  assert.deepEqual(
    db.saves.map((save) => [save.lessonUrl, save.status]),
    [[courseLessons()[0]?.url, "analysed"]],
  );
  assert.equal(db.finishes.length, 0);

  // A new start continues where the last start stopped.
  const { engine, calls } = fakeEngine();
  const { result } = runJob(store, engine);
  assert.deepEqual(await result, {
    courseId: COURSE_ID,
    outcome: "ready",
    analysed: 2,
    reused: 1,
    failed: 0,
    topics: 4,
  });
  assert.deepEqual(
    calls.map((call) => call.lessonPosition),
    [2, 3],
  );
});

test("a long lesson goes to the engine in groups of whole passages, and a passage above the limit fails the lesson", async () => {
  const section = (title: string): string => `## ${title}\n\n${title} ${"word ".repeat(5_000)}`;
  const { db, store } = fakeDatabase([
    {
      url: "https://docs.example/docs/long",
      position: 1,
      title: "Long",
      markdown: [section("Alpha"), section("Beta"), section("Gamma")].join("\n\n"),
    },
    {
      url: "https://docs.example/docs/huge",
      position: 2,
      title: "Huge",
      markdown: `# Huge\n\n${"x".repeat(200_001)}`,
    },
  ]);
  const { engine, calls } = fakeEngine();
  const { result } = runJob(store, engine);
  assert.deepEqual(await result, {
    courseId: COURSE_ID,
    outcome: "ready",
    analysed: 1,
    reused: 0,
    failed: 1,
    topics: 3,
  });
  // Each passage has about 25,000 characters, so the first request holds two passages and the second one.
  assert.deepEqual(
    calls.map((call) => call.passages.map((passage) => passage.ref)),
    [["P1", "P2"], ["P3"]],
  );
  assert.equal(db.saves[0]?.passages?.length, 3);
  assert.equal(db.analyses.get("https://docs.example/docs/huge")?.error, "The lesson is too long.");
});

test("a course that is gone ends the job without an engine call", async () => {
  const { store } = fakeDatabase();
  const { engine, calls } = fakeEngine();
  const { result } = runJob(store, engine, { payload: { courseId: "9b7e2f0e-8d7a-4a51-9c1e-3f1f1d2a7c10" } });
  assert.deepEqual(await result, { courseId: "9b7e2f0e-8d7a-4a51-9c1e-3f1f1d2a7c10", outcome: "gone" });
  assert.equal(calls.length, 0);
});

test("a payload without a course id fails with a safe reason and no retry", async () => {
  const { store } = fakeDatabase();
  await assert.rejects(
    runJob(store, fakeEngine().engine, { payload: { courseId: "x" } }).result,
    safeError(NO_COURSE_REASON, false),
  );
});
