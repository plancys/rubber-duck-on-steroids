import type { APIRoute } from "astro";
import { ALLOW_PRIVATE_COURSE_URLS } from "astro:env/server";
import { normalizeCourseUrl } from "@/lib/courses";
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

// Starts an extension course for the page that the learner opens, or finds the course of the learner for that URL.
// No session: the bearer token decides the learner in extension_start_course.
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

  // The database normalizes the URL too. The check here also refuses a private address.
  const checked = normalizeCourseUrl(
    typeof body.sourceUrl === "string" ? body.sourceUrl : null,
    ALLOW_PRIVATE_COURSE_URLS,
  );
  if ("error" in checked) {
    return extensionJson(origin, { error: "invalid_request", reason: checked.error }, 400);
  }

  const supabase = createAnonClient();
  if (!supabase) {
    return extensionError(origin, "not_configured", 503);
  }
  const { data: courseId, error } = await supabase.rpc("extension_start_course", {
    token,
    source_url: checked.url,
    title: cleanTitle(body.title) ?? checked.url,
  });
  if (error) {
    const mapped = extensionDatabaseError(error);
    return extensionError(origin, mapped.error, mapped.status);
  }

  return extensionJson(origin, { courseId }, 200);
};
