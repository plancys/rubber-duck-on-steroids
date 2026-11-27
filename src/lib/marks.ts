// The marks of the topics that a learner knows: the form rules, the error texts, the write of the island, and the
// read of the pages. It uses no Astro API. Its runtime imports are sibling modules with the .ts extension,
// so node --test can run its tests, and an island can import it.

import type { createClient } from "@/lib/supabase";
import { knownTopicIds, parseLearnerEvents, topicStates } from "./learner-state.ts";
import { parseTopicList, type TopicList } from "./topics.ts";

type Client = NonNullable<ReturnType<typeof createClient>>;

/** The most topic ids in one form. "Mark all" sends the ids of one lesson. */
export const MAX_MARK_IDS = 500;

// The Postgres codes of a failed event insert.
// The insert check raises a check violation for a topic that is not in the course. Row-level security hides the
// course topics of another learner, so a course of another learner gives the same code.
const CHECK_VIOLATION = "23514";
// A foreign key violation: the course or the topic is gone.
const FOREIGN_KEY_VIOLATION = "23503";
// No right to insert, for example when the database does not see the session.
const INSUFFICIENT_PRIVILEGE = "42501";

export type MarkErrorKey = "signed_out" | "not_configured" | "not_found" | "invalid_marks" | "marks_stale" | "unknown";

const MARK_ERROR_TEXTS: Record<MarkErrorKey, string> = {
  signed_out: "Sign in again, then mark the topics.",
  not_configured: "Marks are not available right now.",
  not_found: "This course does not exist or you cannot open it.",
  invalid_marks: "The marks are not valid. Reload the page and try again.",
  marks_stale: "The page is out of date. Reload the page.",
  unknown: "Something went wrong. Try again.",
};

export type MarkNoticeKey = "marks_saved";

const MARK_NOTICE_TEXTS: Record<MarkNoticeKey, string> = {
  marks_saved: "Marks saved.",
};

function isMarkErrorKey(value: unknown): value is MarkErrorKey {
  return typeof value === "string" && Object.hasOwn(MARK_ERROR_TEXTS, value);
}

/** Maps an error key to a fixed text. Unknown keys give the generic text. */
export function markErrorText(key: string | null): string | null {
  if (key === null) return null;
  return isMarkErrorKey(key) ? MARK_ERROR_TEXTS[key] : MARK_ERROR_TEXTS.unknown;
}

/** Maps a notice key from the URL to a fixed text. Unknown keys give no text. */
export function markNoticeText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(MARK_NOTICE_TEXTS, key)) {
    return MARK_NOTICE_TEXTS[key as MarkNoticeKey];
  }
  return null;
}

/** The error key of a failed event insert. */
export function markErrorKey(code: string): MarkErrorKey {
  if (code === CHECK_VIOLATION || code === FOREIGN_KEY_VIOLATION) return "marks_stale";
  if (code === INSUFFICIENT_PRIVILEGE) return "not_found";
  return "unknown";
}

// The content types of a form. Astro checks the origin of a request only for a form content type,
// so the marks route accepts only these two and refuses every other body before it reads it.
const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data"];

/** True when the Content-Type header names a form body. The parameters, such as the boundary, do not count. */
export function isFormContentType(contentType: string | null): boolean {
  const mediaType = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return FORM_CONTENT_TYPES.includes(mediaType);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The marks of one form post. */
export interface MarkForm {
  // The topics to mark as known.
  mark: string[];
  // The topics whose mark the learner removes.
  unmark: string[];
  // The position of the lesson of the action. The redirect goes back to that lesson on the checklist page.
  lesson: number | null;
}

// The topic ids of one field in lowercase, without duplicates. Null when a value is not a UUID.
function topicIds(values: FormDataEntryValue[]): string[] | null {
  const ids = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) return null;
    ids.add(value.toLowerCase());
  }
  return [...ids];
}

/**
 * Checks a form of the marks route. The fields mark and unmark repeat, and each value is a topic id.
 * A form has 1 to MAX_MARK_IDS values. Duplicates collapse, and no id is in both fields.
 * The optional field lesson is the position of a lesson.
 */
export function parseMarkForm(form: FormData): MarkForm | { error: "invalid_marks" } {
  const markValues = form.getAll("mark");
  const unmarkValues = form.getAll("unmark");
  if (markValues.length + unmarkValues.length > MAX_MARK_IDS) return { error: "invalid_marks" };
  const mark = topicIds(markValues);
  const unmark = topicIds(unmarkValues);
  if (mark === null || unmark === null || mark.length + unmark.length === 0) return { error: "invalid_marks" };
  const unmarked = new Set(unmark);
  if (mark.some((id) => unmarked.has(id))) return { error: "invalid_marks" };

  const lesson = form.get("lesson");
  if (lesson === null || lesson === "") return { mark, unmark, lesson: null };
  if (typeof lesson !== "string" || !/^\d{1,9}$/.test(lesson)) return { error: "invalid_marks" };
  return { mark, unmark, lesson: Number(lesson) };
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/**
 * Saves the marks of one click or of one lesson action with the marks route. The body is a FormData, because Astro
 * checks the origin of a form body. The route answers JSON because of the Accept header.
 */
export async function saveMarks(
  courseId: string,
  marks: { mark: readonly string[]; unmark: readonly string[] },
): Promise<{ ok: true } | { error: MarkErrorKey }> {
  const body = new FormData();
  for (const id of marks.mark) body.append("mark", id);
  for (const id of marks.unmark) body.append("unmark", id);
  try {
    const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/marks`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body,
    });
    const answer: unknown = await response.json().catch(() => null);
    if (response.ok && typeof fieldOf(answer, "saved") === "number") return { ok: true };
    const key = fieldOf(answer, "error");
    return { error: isMarkErrorKey(key) ? key : "unknown" };
  } catch {
    return { error: "unknown" };
  }
}

/** The topic list of a course and the marks of the learner, or an error of a read. */
export type TopicMarks = { error: true } | { list: TopicList | null; known: Set<string> };

/**
 * Reads the topic list of a course and the events of the learner in parallel, and joins them in code.
 * list is null when the learner cannot see the course. known holds the live topics in the state claimed.
 * error is true when a read fails, so a page can tell a failed read from a course that it cannot show.
 */
export async function readTopicMarks(supabase: Client, courseId: string): Promise<TopicMarks> {
  const [listResult, eventsResult] = await Promise.all([
    supabase.rpc("course_topic_list", { course_id: courseId }),
    supabase.rpc("learner_course_events", { course_id: courseId }),
  ]);
  if (listResult.error || eventsResult.error) return { error: true };

  const list = parseTopicList(listResult.data);
  if (!list) return { list: null, known: new Set<string>() };
  const merges = new Map(list.merged.map((topic) => [topic.id, topic.mergedInto]));
  const states = topicStates(parseLearnerEvents(eventsResult.data), merges);
  const live = new Set(list.topics.map((topic) => topic.id));
  const known = new Set([...knownTopicIds(states)].filter((id) => live.has(id)));
  return { list, known };
}
