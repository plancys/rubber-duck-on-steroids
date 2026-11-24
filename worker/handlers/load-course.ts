// The load_course job. It reads the course start page, finds the lessons, reads each lesson page as Markdown,
// and stores all lessons in one database call at the end. The payload is { courseId }.
// The URL comes from the course row, so the payload holds no URL.

import { BLOCKED_REASON, readLessons, readStartPage, type PageLog } from "../courses/crawl.ts";
import type { Fetch } from "../courses/http.ts";
import { findLessons } from "../courses/find-lessons.ts";
import type { LessonPicker } from "../llm.ts";
import type { CourseStore, Json } from "../queue.ts";
import { SafeError, type Handler } from "../run.ts";

export const NO_COURSE_REASON = "The job does not name a course.";
export const START_FAILED_REASON = "The start page could not be read.";
export const NO_LESSONS_REASON = "The start page has no lesson links.";
export const NO_LESSON_LOADED_REASON = "No lesson page could be read.";
export const COURSE_FAILED_REASON = "The course did not load.";

export const READ_START_LABEL = "Reading the start page";
export const FIND_LESSONS_LABEL = "Finding the lessons";
export const READ_LESSONS_LABEL = "Reading the lessons";

// One log line of the handler. A line never holds a page text or the prompt.
export type CourseLog =
  | (PageLog & { jobId: string; courseId: string })
  | {
      event: "course_gone" | "lessons_found" | "course_failed" | "course_ready";
      jobId: string;
      courseId: string;
      source?: "model" | "rule";
      count?: number;
      loaded?: number;
      inputTokens?: number;
      outputTokens?: number;
      fallback?: string;
      reason?: string;
      error?: string;
    };

export interface LoadCourseOptions {
  courses: CourseStore;
  // The model picker, or null without ANTHROPIC_API_KEY.
  picker: LessonPicker | null;
  log: (line: CourseLog) => void;
  // The fetch of the crawl. The unit tests give a fake fetch.
  fetch?: Fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The course id from the payload, or null.
export function readCourseId(payload: Json): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const value = payload.courseId;
  return typeof value === "string" && UUID.test(value) ? value : null;
}

// A failure whose reason is already stored on the course.
class CourseFailed extends SafeError {}

// True when a start page that could not be read can give a different answer on a later start:
// no answer at all (a network error or a timeout), or a server error (5xx).
// A 4xx answer, or an answer that is not HTML, stays the same on each start.
function startCanChange(status: number | undefined): boolean {
  return !status || status >= 500;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLoadCourse(options: LoadCourseOptions): Handler {
  const { courses, picker } = options;

  return async ({ jobId, payload, step, signal }) => {
    const courseId = readCourseId(payload);
    if (!courseId) throw new SafeError(NO_COURSE_REASON);
    const ids = { jobId, courseId };
    const gone: Json = { courseId, outcome: "gone" };

    // start_course_load gives no row when the course is gone. Then there is nothing to load.
    const course = await courses.startCourseLoad(courseId);
    if (!course) {
      options.log({ event: "course_gone", ...ids });
      return gone;
    }

    // Store the reason on the course, then fail the job with the same reason.
    // retry false makes the failure final: the job gets no new start, so the site gets no new request.
    // When the course is gone, the job ends without an error.
    const fail = async (reason: string, retry: boolean): Promise<Json> => {
      options.log({ event: "course_failed", ...ids, reason });
      if (!(await courses.failCourseLoad(courseId, reason))) {
        options.log({ event: "course_gone", ...ids });
        return gone;
      }
      throw new CourseFailed(reason, { retry });
    };

    const crawl = {
      signal,
      fetch: options.fetch,
      log: (line: PageLog) => {
        options.log({ ...line, ...ids });
      },
    };

    try {
      await step(1, 2, READ_START_LABEL);
      const start = await readStartPage(course.source_url, crawl);
      if (start.kind === "blocked") return await fail(BLOCKED_REASON, false);
      if (start.kind === "failed") return await fail(START_FAILED_REASON, startCanChange(start.status));

      await step(2, 2, FIND_LESSONS_LABEL);
      const found = await findLessons(start.page, picker, signal);
      const { lessons: links, ...finder } = found;
      options.log({ event: "lessons_found", ...ids, ...finder, count: links.length });
      if (links.length === 0) return await fail(NO_LESSONS_REASON, false);

      // One step for each lesson page.
      const count = 2 + links.length;
      const lessons = await readLessons(links, {
        ...crawl,
        onPage: (done) => step(2 + done, count, READ_LESSONS_LABEL),
      });
      const loaded = lessons.filter((lesson) => lesson.status === "loaded").length;
      // Each lesson page can answer on a later start, so this failure gets a new start.
      if (loaded === 0) return await fail(NO_LESSON_LOADED_REASON, true);

      if (!(await courses.finishCourseLoad(courseId, start.page.title, lessons))) {
        options.log({ event: "course_gone", ...ids });
        return gone;
      }
      options.log({ event: "course_ready", ...ids, count: lessons.length, loaded });
      return { courseId, outcome: "ready", lessons: lessons.length, loaded, finder: found.source };
    } catch (error) {
      // A stop or a lost lease leaves the course loading. The job runs again later.
      // Each other error that is not stored yet marks the course failed, so it does not stay loading.
      if (!(error instanceof CourseFailed) && !signal.aborted) {
        try {
          await courses.failCourseLoad(courseId, COURSE_FAILED_REASON);
        } catch (failError) {
          options.log({ event: "course_failed", ...ids, reason: COURSE_FAILED_REASON, error: errorText(failError) });
        }
      }
      throw error;
    }
  };
}
