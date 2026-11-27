// The database calls of the worker. Each function calls one database function through the Supabase REST API.
// The rest of the worker does not know the REST API. The service key goes only into the request headers.
// This module never writes the key to the log.

// A JSON value, as a jsonb column holds it.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

// A row of the jobs table. The worker keeps its own type, so worker/ needs no file from outside the folder.
// After claim_job, attempts is the number of this start (1, 2 or 3), and lease_id is the lease to pass back.
export interface Job {
  id: string;
  user_id: string;
  type: string;
  payload: Json;
  status: string;
  step_index: number;
  step_count: number;
  step_label: string | null;
  attempts: number;
  error: string | null;
  result: Json | null;
  lease_id: string;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

// A call that takes a lease returns false when the job no longer runs with this lease.
export interface Queue {
  // Take the oldest free job with a new lease. The result is null when no job is free.
  claimJob: () => Promise<Job | null>;
  // Write the progress of the job and extend its lease.
  heartbeatJob: (
    jobId: string,
    lease: string,
    stepIndex: number,
    stepCount: number,
    stepLabel: string | null,
  ) => Promise<boolean>;
  completeJob: (jobId: string, lease: string, result: Json) => Promise<boolean>;
  // End a failed start. The reason goes to the error column after the last start.
  // With retry false the start is the last start: the job fails at once.
  failJob: (jobId: string, lease: string, reason: string, retry: boolean) => Promise<boolean>;
  // Return the job to the queue and give back its attempt.
  releaseJob: (jobId: string, lease: string) => Promise<boolean>;
}

// A row of the courses table, as start_course_load returns it.
export interface Course {
  id: string;
  user_id: string;
  source_url: string;
  title: string | null;
  source_kind: string;
  status: string;
  error: string | null;
  loaded_at: string | null;
  created_at: string;
  updated_at: string;
}

// One lesson for finish_course_load. position starts at 1. A failed lesson has no Markdown and a short safe reason.
export interface LessonRow {
  position: number;
  title: string | null;
  url: string;
  markdown: string | null;
  status: "loaded" | "failed";
  error: string | null;
}

// The course calls of the load_course job. A call returns false (or null) when the course is gone
// or is no longer a crawl course that loads.
export interface CourseStore {
  // Mark the course loading and return it. The result is null when the course is gone or is not a crawl course.
  startCourseLoad: (courseId: string) => Promise<Course | null>;
  // Replace all lessons of the course in one transaction and mark the course ready.
  finishCourseLoad: (courseId: string, title: string | null, lessons: LessonRow[]) => Promise<boolean>;
  // Mark the course failed with a reason that is safe to show. The old lessons stay.
  failCourseLoad: (courseId: string, reason: string) => Promise<boolean>;
}

// The course of a topic job, as start_topic_map returns it.
export interface TopicCourse {
  id: string;
  user_id: string;
  title: string | null;
  source_url: string;
  source_kind: string;
  status: string;
}

// One loaded lesson of a topic job, with no text. content_hash is the MD5 of the lesson text.
export interface TopicLesson {
  url: string;
  position: number;
  title: string | null;
  content_hash: string | null;
}

// The last analysis of one lesson. A failed analysis keeps the result and the engine fields of the last good analysis.
export interface LessonAnalysis {
  lesson_url: string;
  content_hash: string;
  status: "analysed" | "failed";
  error: string | null;
  engine: string | null;
  prompt_version: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  result: Json | null;
  analysed_at: string;
  run_id: string | null;
}

export interface TopicAlias {
  alias: string;
  normalized: string;
}

// One stored topic of the course. home_lesson_url is null for a topic with no link in the course.
export interface StoredTopic {
  id: string;
  name: string;
  description: string | null;
  merged_into: string | null;
  retired_at: string | null;
  created_at: string;
  home_lesson_url: string | null;
  aliases: TopicAlias[];
}

// The input of a topic job. The lessons are in course order. The topics are in the order of their creation.
export interface TopicMapInput {
  course: TopicCourse;
  lessons: TopicLesson[];
  analyses: LessonAnalysis[];
  topics: StoredTopic[];
}

// One passage for save_lesson_analysis. The row holds no text.
export interface PassageRow {
  position: number;
  heading_path: string[];
  start_offset: number;
  end_offset: number;
  content_hash: string;
}

// The result of one lesson for save_lesson_analysis.
// An analysed lesson needs result and passages. A failed lesson needs error, and the database keeps its last result.
export interface LessonAnalysisWrite {
  courseId: string;
  lessonUrl: string;
  // The MD5 of the lesson text that the worker read.
  contentHash: string;
  status: "analysed" | "failed";
  runId: string;
  error: string | null;
  engine: string | null;
  promptVersion: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  result: object | null;
  passages: PassageRow[] | null;
}

// One topic of the map. id is a stored id, or a new id that the worker makes.
export interface MapTopic {
  id: string;
  name: string;
  description: string | null;
  aliases: TopicAlias[];
  home_lesson_url: string | null;
  merged_into: string | null;
  retired: boolean;
}

// A link names its passage by the lesson URL and the position of the passage.
export interface MapLink {
  topic_id: string;
  lesson_url: string;
  position: number;
  role: "explains" | "mentions";
  quote: string;
  quote_start: number;
}

// A relation names its source passage by the lesson URL and the position of the passage.
export interface MapRelation {
  kind: "prerequisite" | "part_of";
  from_topic_id: string;
  to_topic_id: string;
  reason: string;
  lesson_url: string;
  position: number;
}

// The state for finish_topic_map. It holds each topic of the course, also the retired and the merged topics.
export interface TopicMapState {
  topics: MapTopic[];
  links: MapLink[];
  relations: MapRelation[];
  overview: object;
  report: object;
}

// The topic calls of the build_topic_map job. A write returns false when the course or the lesson is gone.
export interface TopicStore {
  // Return the input of the job, or null when the course is gone.
  startTopicMap: (courseId: string) => Promise<TopicMapInput | null>;
  // Return the Markdown of one loaded lesson, or null when the course has no loaded lesson with this URL.
  readLessonText: (courseId: string, lessonUrl: string) => Promise<string | null>;
  // Store the result of one lesson. An analysed lesson replaces its passages in the same transaction.
  saveLessonAnalysis: (write: LessonAnalysisWrite) => Promise<boolean>;
  // Write the map of the course in one transaction.
  finishTopicMap: (courseId: string, runId: string, state: TopicMapState) => Promise<boolean>;
}

export interface QueueSettings {
  url: string;
  key: string;
}

const TIMEOUT_MS = 10_000;
// finish_course_load sends the Markdown of up to 200 lessons, so it gets more time.
// finish_topic_map writes the full map of a course in one transaction, so it gets the same time.
const FINISH_TIMEOUT_MS = 60_000;

// The typed rows of the topic calls hold only JSON values. TypeScript cannot see that through an interface.
function asJson(value: object): Json {
  return value as Json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A legacy service key is a JWT. A new secret key (sb_secret_...) is not a JWT and must not go in the Authorization header.
function isJwt(key: string): boolean {
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(key);
}

// Call database functions through the REST API with the service key.
function createRpc({ url, key }: QueueSettings) {
  const base = `${url.replace(/\/+$/, "")}/rest/v1/rpc/`;
  const headers: Record<string, string> = { apikey: key, "content-type": "application/json" };
  if (isJwt(key)) headers.authorization = `Bearer ${key}`;

  // Call one database function. A call that takes more than its timeout fails.
  async function call(name: string, body: Record<string, Json>, timeoutMs = TIMEOUT_MS): Promise<unknown> {
    const response = await fetch(base + name, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      // The error body of the REST API names the problem. It holds no key.
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`${name} failed with status ${response.status}: ${detail}`);
    }
    const value: unknown = await response.json();
    return value;
  }

  async function callBoolean(name: string, body: Record<string, Json>, timeoutMs?: number): Promise<boolean> {
    const value = await call(name, body, timeoutMs);
    if (typeof value !== "boolean") throw new Error(`${name} did not return true or false.`);
    return value;
  }

  return { call, callBoolean };
}

export function createQueue(settings: QueueSettings): Queue {
  const { call, callBoolean } = createRpc(settings);

  return {
    claimJob: async () => {
      // claim_job returns a set of rows, so the REST API sends a list. An empty list means no free job.
      const rows = await call("claim_job", {});
      if (!Array.isArray(rows)) throw new Error("claim_job did not return a list.");
      return rows.length > 0 ? (rows[0] as Job) : null;
    },
    heartbeatJob: (jobId, lease, stepIndex, stepCount, stepLabel) =>
      callBoolean("heartbeat_job", {
        job_id: jobId,
        lease,
        step_index: stepIndex,
        step_count: stepCount,
        step_label: stepLabel,
      }),
    completeJob: (jobId, lease, result) => callBoolean("complete_job", { job_id: jobId, lease, result }),
    failJob: (jobId, lease, reason, retry) => callBoolean("fail_job", { job_id: jobId, lease, reason, retry }),
    releaseJob: (jobId, lease) => callBoolean("release_job", { job_id: jobId, lease }),
  };
}

export function createCourseStore(settings: QueueSettings): CourseStore {
  const { call, callBoolean } = createRpc(settings);

  return {
    startCourseLoad: async (courseId) => {
      // start_course_load returns a set of rows. An empty list means that the course is gone.
      const rows = await call("start_course_load", { course_id: courseId });
      if (!Array.isArray(rows)) throw new Error("start_course_load did not return a list.");
      return rows.length > 0 ? (rows[0] as Course) : null;
    },
    finishCourseLoad: (courseId, title, lessons) => {
      // Send exactly the fields that finish_course_load reads.
      const rows = lessons.map((lesson) => ({
        position: lesson.position,
        title: lesson.title,
        url: lesson.url,
        markdown: lesson.markdown,
        status: lesson.status,
        error: lesson.error,
      }));
      return callBoolean("finish_course_load", { course_id: courseId, title, lessons: rows }, FINISH_TIMEOUT_MS);
    },
    failCourseLoad: (courseId, reason) => callBoolean("fail_course_load", { course_id: courseId, reason }),
  };
}

export function createTopicStore(settings: QueueSettings): TopicStore {
  const { call, callBoolean } = createRpc(settings);

  return {
    startTopicMap: async (courseId) => {
      // start_topic_map returns one JSON document, or null when the course is gone.
      const value = await call("start_topic_map", { course_id: courseId });
      if (value === null) return null;
      if (
        !isRecord(value) ||
        !isRecord(value.course) ||
        !Array.isArray(value.lessons) ||
        !Array.isArray(value.analyses) ||
        !Array.isArray(value.topics)
      ) {
        throw new Error("start_topic_map did not return the course, the lessons, the analyses and the topics.");
      }
      return value as unknown as TopicMapInput;
    },
    readLessonText: async (courseId, lessonUrl) => {
      const value = await call("read_lesson_text", { course_id: courseId, lesson_url: lessonUrl });
      if (value !== null && typeof value !== "string") throw new Error("read_lesson_text did not return a text.");
      return value;
    },
    saveLessonAnalysis: (write) =>
      // Send exactly the named arguments that save_lesson_analysis reads.
      callBoolean("save_lesson_analysis", {
        course_id: write.courseId,
        lesson_url: write.lessonUrl,
        content_hash: write.contentHash,
        status: write.status,
        run_id: write.runId,
        error: write.error,
        engine: write.engine,
        prompt_version: write.promptVersion,
        model: write.model,
        input_tokens: write.inputTokens,
        output_tokens: write.outputTokens,
        result: write.result === null ? null : asJson(write.result),
        passages: write.passages === null ? null : asJson(write.passages),
      }),
    finishTopicMap: (courseId, runId, state) =>
      callBoolean("finish_topic_map", { course_id: courseId, run_id: runId, state: asJson(state) }, FINISH_TIMEOUT_MS),
  };
}
