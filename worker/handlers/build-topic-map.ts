// The build_topic_map job. It sends each changed lesson of a course to the topic engine, checks each answer,
// stores the result of each lesson at once, and at the end writes the full map of the course in one database call.
// The payload is { courseId }.
//
// The job is safe to run two times. A new start reads the stored results and calls the engine only for the lessons
// that still need a call. The map build reads only the stored results, so the same input gives the same map.
// One log line for each lesson holds the job id, the lesson position, the result, the token counts and the duration.
// No log line holds the lesson text, the prompt, a quote or a topic name.

import { createHash, randomUUID } from "node:crypto";
import type { LessonAnalysis, PassageRow, TopicLesson, TopicStore } from "../queue.ts";
import { SafeError, type Handler } from "../run.ts";
import { buildTopicMap, type BuildLesson } from "../topics/build.ts";
import type { EngineFailureCode, TopicEngine } from "../topics/engine.ts";
import { groupTopics, knownTopicsFor, type LessonNames } from "../topics/identity.ts";
import {
  checkAnswer,
  lessonResult,
  readStoredResult,
  type CheckedAnswer,
  type LessonResult,
} from "../topics/schema.ts";
import { splitLesson, type Passage } from "../topics/split.ts";
import { NO_COURSE_REASON, readCourseId } from "./load-course.ts";

export const NO_ENGINE_REASON = "The topic engine is not set up.";
export const ENGINE_UNREACHABLE_REASON = "The topic engine is not reachable.";
export const ENGINE_REFUSED_REASON = "The topic engine refused the worker.";
export const NO_LESSON_TEXT_REASON = "The course has no lesson text.";
export const NO_RESULT_REASON = "No lesson of the course could be analysed.";

export const ANALYSE_LABEL = "Finding the topics of the lessons";
export const BUILD_LABEL = "Building the map";

// A lesson with at most this many characters goes to the engine in one request.
// A longer lesson goes in groups of whole passages.
export const MAX_REQUEST_CHARACTERS = 60_000;
// The engine refuses a request with more characters. A longer passage makes the lesson fail.
export const MAX_PASSAGE_CHARACTERS = 200_000;

// The failure codes of a lesson: the codes of the engine client, and too_long for a passage above the limit.
export type LessonFailureCode = Exclude<EngineFailureCode, "unreachable" | "unauthorized"> | "too_long";

// The reasons of a failed lesson. The learner can see them, so they are short and hold no detail of the engine.
export const LESSON_REASONS: Record<LessonFailureCode, string> = {
  too_long: "The lesson is too long.",
  too_large: "The lesson is too long.",
  refusal: "The model refused the lesson.",
  truncated: "The answer of the model was too long.",
  invalid_answer: "The model gave no valid answer.",
  bad_response: "The topic engine gave no valid answer.",
  model_error: "The model call failed.",
  timeout: "The topic engine did not answer in time.",
  bad_request: "The topic engine refused the lesson.",
};

// One log line of the handler. A line never holds a lesson text, a quote or a topic name.
export interface TopicLog {
  event: "course_gone" | "engine_failed" | "lesson" | "lesson_gone" | "map_built";
  jobId: string;
  courseId: string;
  lessonPosition?: number;
  // analysed, or the failure code of the lesson or of the engine.
  result?: string;
  // The requests of the lesson, and the calls with the second tries.
  requests?: number;
  calls?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  topics?: number;
  relations?: number;
  // The counts of the run.
  pending?: number;
  analysed?: number;
  reused?: number;
  failed?: number;
  durationMs?: number;
}

export interface BuildTopicMapOptions {
  topics: TopicStore;
  // The engine client, or null without TOPIC_ENGINE_URL.
  engine: TopicEngine | null;
  log: (line: TopicLog) => void;
  // The id of a run. The unit tests give fixed ids.
  newRunId?: () => string;
  // The clock of the durations. The unit tests give a fixed clock.
  now?: () => number;
}

// The current analysis of one lesson, with its stored result read again.
interface CurrentAnalysis {
  status: "analysed" | "failed";
  contentHash: string;
  engine: string | null;
  promptVersion: string | null;
  model: string | null;
  result: LessonResult | null;
}

type EngineOutcome =
  | {
      ok: true;
      result: LessonResult;
      engine: string;
      promptVersion: string;
      model: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
      requests: number;
      calls: number;
    }
  | { ok: false; code: LessonFailureCode; requests: number; calls: number };

// The MD5 of a lesson text: the same value as md5() in Postgres, which fills lessons.content_hash.
export function lessonHash(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

// Cut the passages of a lesson into groups of whole passages with at most `limit` characters.
// A passage above the limit is a group of its own.
export function groupPassages(passages: readonly Passage[], limit = MAX_REQUEST_CHARACTERS): Passage[][] {
  const groups: Passage[][] = [];
  let current: Passage[] = [];
  let size = 0;
  for (const passage of passages) {
    if (current.length > 0 && size + passage.text.length > limit) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(passage);
    size += passage.text.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function currentAnalysis(row: LessonAnalysis): CurrentAnalysis {
  return {
    status: row.status,
    contentHash: row.content_hash,
    engine: row.engine,
    promptVersion: row.prompt_version,
    model: row.model,
    result: readStoredResult(row.result),
  };
}

function passageRows(passages: readonly Passage[]): PassageRow[] {
  return passages.map((passage) => ({
    position: passage.position,
    heading_path: passage.headingPath,
    start_offset: passage.startOffset,
    end_offset: passage.endOffset,
    content_hash: passage.contentHash,
  }));
}

// The failure of the whole job for an engine that does not answer or that refuses the worker.
function engineError(code: EngineFailureCode): SafeError {
  if (code === "unauthorized") return new SafeError(ENGINE_REFUSED_REASON, { retry: false });
  return new SafeError(ENGINE_UNREACHABLE_REASON, { retry: true });
}

export function createBuildTopicMap(options: BuildTopicMapOptions): Handler {
  const { topics: store } = options;
  const newRunId = options.newRunId ?? randomUUID;
  const now = options.now ?? Date.now;

  return async ({ jobId, payload, step, signal }) => {
    const courseId = readCourseId(payload);
    // The payload stays the same on each start, so the job gets no new start.
    if (!courseId) throw new SafeError(NO_COURSE_REASON, { retry: false });
    const ids = { jobId, courseId };
    const { engine } = options;
    if (!engine) throw new SafeError(NO_ENGINE_REASON, { retry: false });
    const started = now();

    const input = await store.startTopicMap(courseId);
    if (!input) {
      options.log({ event: "course_gone", ...ids });
      return { courseId, outcome: "gone" };
    }
    if (input.lessons.length === 0) throw new SafeError(NO_LESSON_TEXT_REASON, { retry: false });

    const described = await engine.describe(signal);
    if (!described.ok) {
      options.log({ event: "engine_failed", ...ids, result: described.code, calls: described.attempts });
      throw engineError(described.code);
    }
    const { info } = described;
    const runId = newRunId();

    const lessons = [...input.lessons].sort((a, b) => a.position - b.position);
    // The current analysis of each lesson. The handler changes it after each lesson that it stores.
    const analyses = new Map(input.analyses.map((row) => [row.lesson_url, currentAnalysis(row)]));

    // A lesson needs an engine call when it has no stored result, when its text changed, when its last result
    // failed, or when the engine name or the prompt version changed.
    const needsCall = (lesson: TopicLesson): boolean => {
      const analysis = analyses.get(lesson.url);
      return (
        !analysis?.result ||
        analysis.status === "failed" ||
        analysis.contentHash !== lesson.content_hash ||
        analysis.engine !== info.engine ||
        analysis.promptVersion !== info.promptVersion
      );
    };
    const pending = lessons.filter(needsCall);
    const reused = lessons.length - pending.length;
    let analysed = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    // The candidates of the course for the identity check: the stored result of each lesson, and the checked
    // answers of the lesson that runs now. A lesson that the run analysed already has its new result here.
    const courseNames = (current: TopicLesson, parts: readonly CheckedAnswer[]): LessonNames[] => {
      const names: LessonNames[] = [];
      for (const lesson of lessons) {
        const result = analyses.get(lesson.url)?.result;
        if (result) names.push({ position: lesson.position, topics: result.topics });
        if (lesson.url === current.url && parts.length > 0) {
          names.push({ position: lesson.position, topics: parts.flatMap((part) => part.topics) });
        }
      }
      return names;
    };

    // Send the passages of one lesson to the engine and check each answer.
    // An engine that does not answer, or that refuses the worker, fails the job. Each other failure fails the lesson.
    const callEngine = async (lesson: TopicLesson, passages: readonly Passage[]): Promise<EngineOutcome> => {
      const parts: CheckedAnswer[] = [];
      let calls = 0;
      let first: { engine: string; promptVersion: string; model: string } | null = null;
      let lessonInput: number | null = 0;
      let lessonOutput: number | null = 0;
      const groups = groupPassages(passages);
      for (const group of groups) {
        const names = courseNames(lesson, parts);
        const known = knownTopicsFor(
          groupTopics(input.topics, names),
          names,
          group.map((passage) => passage.text).join("\n\n"),
        );
        const outcome = await engine.extractLesson(
          {
            jobId,
            lessonPosition: lesson.position,
            lesson: { url: lesson.url, title: lesson.title ?? lesson.url },
            passages: group.map((passage) => ({
              ref: passage.ref,
              headingPath: passage.headingPath,
              text: passage.text,
            })),
            knownTopics: known,
          },
          signal,
        );
        calls += outcome.attempts;
        if (!outcome.ok) {
          if (outcome.code === "unreachable" || outcome.code === "unauthorized") {
            options.log({
              event: "engine_failed",
              ...ids,
              lessonPosition: lesson.position,
              result: outcome.code,
              calls,
            });
            throw engineError(outcome.code);
          }
          return { ok: false, code: outcome.code, requests: parts.length + 1, calls };
        }
        const { answer } = outcome;
        first ??= { engine: answer.engine, promptVersion: answer.promptVersion, model: answer.model };
        lessonInput = answer.usage && lessonInput !== null ? lessonInput + answer.usage.inputTokens : null;
        lessonOutput = answer.usage && lessonOutput !== null ? lessonOutput + answer.usage.outputTokens : null;
        const checkPassages = group.map((passage) => ({
          ref: passage.ref,
          position: passage.position,
          text: passage.text,
        }));
        parts.push(checkAnswer(answer, checkPassages, known));
      }
      return {
        ok: true,
        result: lessonResult(passages.length, parts),
        engine: first?.engine ?? info.engine,
        promptVersion: first?.promptVersion ?? info.promptVersion,
        model: first?.model ?? null,
        inputTokens: lessonInput,
        outputTokens: lessonOutput,
        requests: groups.length,
        calls,
      };
    };

    // Read, split and analyse one lesson, and store its result at once.
    const analyse = async (lesson: TopicLesson): Promise<void> => {
      const lessonStarted = now();
      const text = await store.readLessonText(courseId, lesson.url);
      if (text === null) {
        options.log({ event: "lesson_gone", ...ids, lessonPosition: lesson.position });
        return;
      }
      // The extension can save the page after start_topic_map, so the hash comes from the text that the job read.
      const contentHash = lessonHash(text);
      const passages = splitLesson(text);
      const outcome: EngineOutcome = passages.some((passage) => passage.text.length > MAX_PASSAGE_CHARACTERS)
        ? { ok: false, code: "too_long", requests: 0, calls: 0 }
        : await callEngine(lesson, passages);

      const old = analyses.get(lesson.url);
      let stored: boolean;
      let current: CurrentAnalysis;
      if (outcome.ok) {
        stored = await store.saveLessonAnalysis({
          courseId,
          lessonUrl: lesson.url,
          contentHash,
          status: "analysed",
          runId,
          error: null,
          engine: outcome.engine,
          promptVersion: outcome.promptVersion,
          model: outcome.model,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
          result: outcome.result,
          passages: passageRows(passages),
        });
        current = {
          status: "analysed",
          contentHash,
          engine: outcome.engine,
          promptVersion: outcome.promptVersion,
          model: outcome.model,
          result: outcome.result,
        };
      } else {
        // The database keeps the passages, the result and the engine fields of the last good analysis.
        stored = await store.saveLessonAnalysis({
          courseId,
          lessonUrl: lesson.url,
          contentHash,
          status: "failed",
          runId,
          error: LESSON_REASONS[outcome.code],
          engine: null,
          promptVersion: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          result: null,
          passages: null,
        });
        current = {
          status: "failed",
          contentHash,
          engine: old?.engine ?? null,
          promptVersion: old?.promptVersion ?? null,
          model: old?.model ?? null,
          result: old?.result ?? null,
        };
      }
      if (!stored) {
        options.log({ event: "lesson_gone", ...ids, lessonPosition: lesson.position });
        return;
      }
      analyses.set(lesson.url, current);
      if (outcome.ok) {
        analysed += 1;
        inputTokens += outcome.inputTokens ?? 0;
        outputTokens += outcome.outputTokens ?? 0;
      }
      options.log({
        event: "lesson",
        ...ids,
        lessonPosition: lesson.position,
        result: outcome.ok ? "analysed" : outcome.code,
        requests: outcome.requests,
        calls: outcome.calls,
        inputTokens: outcome.ok ? outcome.inputTokens : null,
        outputTokens: outcome.ok ? outcome.outputTokens : null,
        topics: outcome.ok ? outcome.result.topics.length : 0,
        relations: outcome.ok ? outcome.result.relations.length : 0,
        durationMs: now() - lessonStarted,
      });
    };

    // One step for each lesson that needs a call, then the step of the map build.
    // A step throws when the job must stop, so the job stops between two lessons. The stored results stay.
    const count = pending.length + 1;
    for (const [index, lesson] of pending.entries()) {
      await step(index + 1, count, ANALYSE_LABEL);
      await analyse(lesson);
    }

    const buildLessons: BuildLesson[] = lessons.map((lesson) => {
      const analysis = analyses.get(lesson.url);
      return {
        url: lesson.url,
        position: lesson.position,
        title: lesson.title,
        state: analysis ? analysis.status : "none",
        result: analysis?.result ?? null,
        model: analysis?.model ?? null,
      };
    });
    // With no result, the map would be empty. A new start can reach the engine again.
    if (!buildLessons.some((lesson) => lesson.result !== null)) throw new SafeError(NO_RESULT_REASON);

    await step(count, count, BUILD_LABEL);
    const map = buildTopicMap({
      courseId,
      lessons: buildLessons,
      topics: input.topics,
      run: {
        analysed,
        reused,
        inputTokens,
        outputTokens,
        engine: info.engine,
        promptVersion: info.promptVersion,
        durationMs: now() - started,
      },
    });
    if (!(await store.finishTopicMap(courseId, runId, map))) {
      options.log({ event: "course_gone", ...ids });
      return { courseId, outcome: "gone" };
    }
    const counts = {
      analysed,
      reused,
      failed: map.report.lessons.failed,
      topics: map.report.topics.live,
    };
    options.log({ event: "map_built", ...ids, pending: pending.length, ...counts, durationMs: now() - started });
    return { courseId, outcome: "ready", ...counts };
  };
}
