import type { APIRoute } from "astro";
import { COURSE_URL_MAX_LENGTH, isCourseId } from "@/lib/courses";
import {
  bearerToken,
  cleanTitle,
  createAnonClient,
  extensionDatabaseError,
  extensionError,
  extensionJson,
  extensionOrigin,
  preflightResponse,
  readJsonBody,
} from "@/lib/extension-api";
import { isAuthRateLimited } from "@/lib/rate-limit";

export const prerender = false;

export const OPTIONS: APIRoute = ({ request }) => preflightResponse(request);

/** The page URL in the form that the lessons table keeps: http or https, no fragment. Null for any other URL. */
function pageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > COURSE_URL_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  url.hash = "";
  return url.href;
}

// Saves one page of an extension course. The extension converts the page to Markdown in the browser,
// so this route does little CPU work. No session: the bearer token decides the learner in extension_save_page.
export const POST: APIRoute = async ({ request }) => {
  const origin = extensionOrigin(request);
  if (!origin) {
    return extensionError(null, "forbidden_origin", 403);
  }
  if (await isAuthRateLimited(request, "extension")) {
    return extensionError(origin, "rate_limited", 429);
  }
  const token = bearerToken(request);
  if (!token) {
    return extensionError(origin, "invalid_token", 401);
  }

  const read = await readJsonBody(request);
  if ("error" in read) {
    return extensionError(origin, read.error, read.error === "too_large" ? 413 : 400);
  }
  const body = (typeof read.body === "object" && read.body !== null ? read.body : {}) as Record<string, unknown>;

  const courseId = typeof body.courseId === "string" ? body.courseId : null;
  const url = pageUrl(body.url);
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (!isCourseId(courseId) || !url || markdown.trim().length === 0) {
    return extensionError(origin, "invalid_request", 400);
  }

  // The body limit keeps the Markdown under 1 MB. The check lessons_markdown_size_check stays as the last guard.
  const supabase = createAnonClient();
  if (!supabase) {
    return extensionError(origin, "not_configured", 503);
  }
  const { data: position, error } = await supabase.rpc("extension_save_page", {
    token,
    course_id: courseId,
    url,
    title: cleanTitle(body.title) ?? url,
    markdown,
  });
  if (error) {
    const mapped = extensionDatabaseError(error);
    return extensionError(origin, mapped.error, mapped.status);
  }

  return extensionJson(origin, { position }, 200);
};
