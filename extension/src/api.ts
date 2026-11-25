// The calls to the product. The extension sends the token as a bearer token and never sends cookies.

import { MAX_BODY_BYTES, byteLength } from "./rules.ts";

/** The product address and the token that the learner adds in the popup. */
export interface Settings {
  baseUrl: string;
  token: string;
}

export type ErrorKey =
  | "invalid_token"
  | "course_loading"
  | "crawl_course"
  | "course_full"
  | "too_large"
  | "invalid_request"
  | "rate_limited"
  | "network"
  | "unknown"
  | "no_settings"
  | "bad_address"
  | "bad_page"
  | "denied"
  | "no_text"
  | "read_failed";

const ERROR_TEXTS: Record<ErrorKey, string> = {
  invalid_token: "The product does not accept the token. Create a new token in the product settings.",
  course_loading: "The product loads this course now. Wait until the load ends, then try again.",
  crawl_course: "This course loads from its URL in the product. Reload it there.",
  course_full: "This course has 500 pages. The product does not save more pages.",
  too_large: "This page is too large to save.",
  invalid_request: "The product does not accept this page.",
  rate_limited: "Too many requests. Wait a minute, then open the page again.",
  network: "The product does not answer. Check the product address.",
  unknown: "Something went wrong. Try again.",
  no_settings: "Add the product address and the token first.",
  bad_address: "Enter the product address, for example https://example.com.",
  bad_page: "Open a web page, then start the course.",
  denied: "Allow access to this site, so the extension can save its pages.",
  no_text: "This page has no text to save.",
  read_failed: "The extension cannot read this page.",
};

export function errorText(key: ErrorKey): string {
  return ERROR_TEXTS[key];
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ErrorKey };

// The hosts that can use http. The token goes without TLS only to the machine of the learner.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Gives the origin of the product address, or null for any other address.
 * The address must use https. Only localhost and 127.0.0.1 can use http, for a local run.
 */
export function normalizeBaseUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

// The keys of a 409 answer. A 409 answer without a known key means that the course loads now.
const CONFLICT_KEYS = new Set<ErrorKey>(["course_loading", "crawl_course", "course_full"]);

/** Gives the error key of an answer that is not ok, from its status and the error key in its body. */
export function errorForResponse(status: number, bodyKey: unknown): ErrorKey {
  if (status === 401) return "invalid_token";
  if (status === 409) {
    return CONFLICT_KEYS.has(bodyKey as ErrorKey) ? (bodyKey as ErrorKey) : "course_loading";
  }
  if (status === 413) return "too_large";
  if (status === 400) return "invalid_request";
  if (status === 429) return "rate_limited";
  return "unknown";
}

// The error key in the JSON body of an answer, or null when the body has none.
async function bodyErrorKey(response: Response): Promise<unknown> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    return body?.error ?? null;
  } catch {
    return null;
  }
}

async function post(settings: Settings, path: string, payload: unknown): Promise<ApiResult<unknown>> {
  const body = JSON.stringify(payload);
  if (byteLength(body) > MAX_BODY_BYTES) return { ok: false, error: "too_large" };

  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl}/api/extension/${path}`, {
      method: "POST",
      // The token alone identifies the learner. No cookie of the product goes with the request.
      credentials: "omit",
      headers: { Authorization: `Bearer ${settings.token}`, "Content-Type": "application/json" },
      body,
    });
  } catch {
    return { ok: false, error: "network" };
  }
  if (!response.ok) return { ok: false, error: errorForResponse(response.status, await bodyErrorKey(response)) };
  try {
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, error: "unknown" };
  }
}

/** Starts a course for the page, or finds the course of the learner for that URL. Gives the course id. */
export async function startCourse(
  settings: Settings,
  sourceUrl: string,
  title: string | null,
): Promise<ApiResult<{ courseId: string }>> {
  const result = await post(settings, "courses", { sourceUrl, title });
  if (!result.ok) return result;
  const courseId = (result.data as { courseId?: unknown } | null)?.courseId;
  return typeof courseId === "string" ? { ok: true, data: { courseId } } : { ok: false, error: "unknown" };
}

/** Saves one page of the course. Gives the position of the lesson in the course. */
export async function savePage(
  settings: Settings,
  page: { courseId: string; url: string; title: string | null; markdown: string },
): Promise<ApiResult<{ position: number }>> {
  const result = await post(settings, "pages", page);
  if (!result.ok) return result;
  const position = (result.data as { position?: unknown } | null)?.position;
  return typeof position === "number" ? { ok: true, data: { position } } : { ok: false, error: "unknown" };
}
