// Rules and texts of the courses. The worker in worker/ crawls a course. This module is for the web app.
// It reads no settings and imports no runtime modules. A route reads ALLOW_PRIVATE_COURSE_URLS and gives it here.

import type { Tables } from "@/db/database.types";
import type { createClient } from "@/lib/supabase";

type Client = NonNullable<ReturnType<typeof createClient>>;

// The Postgres code of a unique violation. The index jobs_one_in_progress_per_user_idx allows one job in progress.
const UNIQUE_VIOLATION = "23505";
// The code of the load_course job trigger: the learner started 10 course loads in the last hour.
const LOAD_QUOTA_EXCEEDED = "RD001";

/** A longer URL is not a course start page. The limit also keeps the URL far under the payload limit of a job. */
export const COURSE_URL_MAX_LENGTH = 2048;

export type CourseUrlErrorKey = "url_required" | "url_invalid" | "url_not_http" | "url_credentials" | "url_private";

export type CourseErrorKey =
  | CourseUrlErrorKey
  | "job_active"
  | "too_many_loads"
  | "too_many_maps"
  | "course_not_ready"
  | "extension_course"
  | "not_found"
  | "not_configured"
  | "unknown";

const COURSE_ERROR_TEXTS: Record<CourseErrorKey, string> = {
  url_required: "Enter the URL of the course start page.",
  url_invalid: "Enter a valid URL, for example https://example.com/course.",
  url_not_http: "The URL must start with http:// or https://.",
  url_credentials: "Remove the user name and the password from the URL.",
  url_private: "This address is not public. Use the URL of a public site.",
  job_active: "You already have a job in progress. Wait until it ends.",
  too_many_loads: "You can start at most 10 course loads in one hour. Try again later.",
  too_many_maps: "You can build at most 5 topic maps in one hour. Try again later.",
  course_not_ready: "The course is not ready. Build the topic map after the course loads.",
  extension_course: "This course comes from the browser extension. Use the extension to add pages.",
  not_found: "This course does not exist or you cannot open it.",
  not_configured: "Courses are not available right now.",
  unknown: "Something went wrong. Try again.",
};

export type CourseNoticeKey = "deleted";

const COURSE_NOTICE_TEXTS: Record<CourseNoticeKey, string> = {
  deleted: "Course deleted.",
};

/** Maps an error key from the URL to a fixed text. Unknown keys give the generic text. */
export function courseErrorText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(COURSE_ERROR_TEXTS, key)) {
    return COURSE_ERROR_TEXTS[key as CourseErrorKey];
  }
  return COURSE_ERROR_TEXTS.unknown;
}

/** Maps a notice key from the URL to a fixed text. Unknown keys give no text. */
export function courseNoticeText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(COURSE_NOTICE_TEXTS, key)) {
    return COURSE_NOTICE_TEXTS[key as CourseNoticeKey];
  }
  return null;
}

export type CourseStatus = "loading" | "ready" | "failed";

const COURSE_STATUS_TEXTS: Record<CourseStatus, string> = {
  loading: "Loading",
  ready: "Ready",
  failed: "Failed",
};

/** The text of a course state. The check courses_status_check allows only the three values. */
export function courseStatusText(status: string): string {
  return Object.hasOwn(COURSE_STATUS_TEXTS, status) ? COURSE_STATUS_TEXTS[status as CourseStatus] : status;
}

/** The name of a course: its title, or its source URL before the first load ends. */
export function courseName(course: Pick<Tables<"courses">, "title" | "source_url">): string {
  return course.title?.trim() ? course.title : course.source_url;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true when the value is a UUID. A route uses it to skip the query for a bad id. */
export function isCourseId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Checks the URL of a course start page and gives it in the form that the courses table stores:
 * http or https only, no user name or password, no fragment, no trailing slash.
 * Unless allowPrivate is true, it rejects a literal private, loopback, link-local or metadata address.
 * It does not resolve a host name, so a public name that points to a private address passes.
 */
export function normalizeCourseUrl(
  input: FormDataEntryValue | null,
  allowPrivate: boolean,
): { url: string } | { error: CourseUrlErrorKey } {
  const raw = typeof input === "string" ? input.trim() : "";
  if (raw.length === 0) return { error: "url_required" };
  if (raw.length > COURSE_URL_MAX_LENGTH) return { error: "url_invalid" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // "example.com/course" has no scheme. Tell the learner what is missing.
    return { error: /^[a-z][a-z0-9+.-]*:/i.test(raw) ? "url_invalid" : "url_not_http" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "url_not_http" };
  if (url.username !== "" || url.password !== "") return { error: "url_credentials" };
  if (!allowPrivate && isPrivateHost(url.hostname)) return { error: "url_private" };

  url.hash = "";
  let href = url.href;
  while (href.endsWith("/")) href = href.slice(0, -1);
  // The parser can make the URL longer, for example with percent-encoding.
  if (href.length > COURSE_URL_MAX_LENGTH || href.includes("#")) return { error: "url_invalid" };
  return { url: href };
}

/**
 * True for a host that the worker must not read: localhost, the metadata host of Google Cloud,
 * and a literal IPv4 or IPv6 address in a private, loopback, link-local or shared range.
 * The URL parser already gives an IPv4 address as four decimal numbers and an IPv6 address in brackets.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // metadata.google.internal and its short name. ".internal" is a private top-level domain.
  if (host === "metadata" || host === "internal" || host.endsWith(".internal")) return true;

  if (host.startsWith("[") && host.endsWith("]")) {
    const groups = parseIpv6(host.slice(1, -1));
    // An address that does not parse is not safe to read.
    return groups === null || isPrivateIpv6(groups);
  }
  const ipv4 = parseIpv4(host);
  return ipv4 !== null && isPrivateIpv4(ipv4);
}

function parseIpv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function isPrivateIpv4([a, b]: number[]): boolean {
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10
    a === 127 || // 127.0.0.0/8
    (a === 169 && b === 254) || // 169.254.0.0/16, with the metadata address 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) // 192.168.0.0/16
  );
}

/** Gives the 8 groups of an IPv6 address, or null. It accepts "::" and a dotted IPv4 address at the end. */
function parseIpv6(text: string): number[] | null {
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] === "" ? [] : halves[0].split(":");
  const tail = halves.length === 2 && halves[1] !== "" ? halves[1].split(":") : [];

  const last = halves.length === 2 ? tail : head;
  const end = last.at(-1);
  if (end?.includes(".")) {
    const ipv4 = parseIpv4(end);
    if (!ipv4) return null;
    last.splice(-1, 1, ((ipv4[0] << 8) | ipv4[1]).toString(16), ((ipv4[2] << 8) | ipv4[3]).toString(16));
  }

  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null;
  const parts = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (!parts.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.map((part) => parseInt(part, 16));
}

function isPrivateIpv6(groups: number[]): boolean {
  const first = groups[0];
  // fc00::/7: unique local addresses. fe80::/10: link-local addresses.
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
  // ::ffff:a.b.c.d maps an IPv4 address. ::a.b.c.d is the old compatible form. It also covers :: and ::1.
  const zeroPrefix = groups.slice(0, 5).every((group) => group === 0);
  if (zeroPrefix && (groups[5] === 0 || groups[5] === 0xffff)) {
    const ipv4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
    return isPrivateIpv4(ipv4);
  }
  return false;
}

/** The result of a load start. "loading" means that the course loads now, so no new job starts. */
export type CourseLoadOutcome =
  { kind: "started"; jobId: string } | { kind: "loading" } | { kind: "error"; error: CourseErrorKey };

/**
 * Returns true when the learner has a job that waits or runs, and null when the read fails.
 * A route checks it before it changes a course, because a course in "loading" without a job stays in that state.
 */
export async function hasJobInProgress(supabase: Client): Promise<boolean | null> {
  const { data, error } = await supabase.from("jobs").select("id").in("status", ["waiting", "running"]).limit(1);
  if (error) return null;
  return data.length > 0;
}

/** The error key of a failed load_course job insert: a job in progress, the load quota, or an unknown error. */
function loadJobErrorKey(code: string): CourseErrorKey {
  if (code === UNIQUE_VIOLATION) return "job_active";
  if (code === LOAD_QUOTA_EXCEEDED) return "too_many_loads";
  return "unknown";
}

/** Creates the load_course job of a course. The database accepts it only for a crawl course of the learner. */
export async function insertLoadJob(supabase: Client, courseId: string): Promise<CourseLoadOutcome> {
  const { data, error } = await supabase
    .from("jobs")
    .insert({ type: "load_course", payload: { courseId } })
    .select("id")
    .single();
  if (error) {
    return { kind: "error", error: loadJobErrorKey(error.code) };
  }
  return { kind: "started", jobId: data.id };
}

/**
 * Loads an existing course of the learner again. reload_course sets the course to loading and inserts the job
 * in one transaction, and gives the job id. When the job insert fails, the course keeps its old state.
 * reload_course refuses a course of another learner, an extension course and a course that loads now.
 * Then no job starts, and the outcome names the reason.
 */
export async function reloadCourse(supabase: Client, courseId: string): Promise<CourseLoadOutcome> {
  const { data: jobId, error } = await supabase.rpc("reload_course", { course_id: courseId });
  if (error) return { kind: "error", error: loadJobErrorKey(error.code) };
  // The generated type says string, but the function gives null when the course does not change.
  if (typeof jobId === "string") return { kind: "started", jobId };

  // RLS returns no row for a course of another learner, so it gives the same answer as a missing course.
  const { data: course, error: readError } = await supabase
    .from("courses")
    .select("source_kind, status")
    .eq("id", courseId)
    .maybeSingle();
  if (readError) return { kind: "error", error: "unknown" };
  if (!course) return { kind: "error", error: "not_found" };
  if (course.source_kind === "extension") return { kind: "error", error: "extension_course" };
  return { kind: "loading" };
}
