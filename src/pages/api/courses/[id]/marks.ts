import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isCourseId } from "@/lib/courses";
import { isFormContentType, markErrorKey, parseMarkForm, type MarkErrorKey } from "@/lib/marks";
import { knownTopicsPath } from "@/lib/topics";

export const prerender = false;

// The answer to the island. It reports a write, so no cache may keep it.
function answer(body: { error: MarkErrorKey } | { saved: number }, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// The status of each error key of a failed insert.
function insertErrorStatus(key: MarkErrorKey): number {
  if (key === "marks_stale") return 409;
  if (key === "not_found") return 404;
  if (key === "too_many_marks") return 429;
  return 500;
}

// Saves the marks of one click or of one lesson action in one insert. The island asks for JSON with the Accept
// header. A form post with no script gets a redirect back to the checklist page.
export const POST: APIRoute = async (context) => {
  const json = context.request.headers.get("Accept")?.includes("application/json") ?? false;
  // An error goes to the island as JSON, and to a form post as a redirect.
  const fail = (error: MarkErrorKey, status: number, location: string) =>
    json ? answer({ error }, status) : context.redirect(location);

  // Astro checks the origin only for a form body. Refuse every other body before the route reads it.
  if (!isFormContentType(context.request.headers.get("Content-Type"))) {
    return answer({ error: "invalid_marks" }, 415);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail("not_configured", 503, "/dashboard/courses?error=not_configured");
  }
  // The middleware does not protect /api/courses. Check the session here.
  if (!context.locals.user) {
    return fail("signed_out", 401, "/auth/signin");
  }

  const { id } = context.params;
  if (!isCourseId(id)) {
    return fail("not_found", 404, "/dashboard/courses?error=not_found");
  }
  const checklist = knownTopicsPath(id);

  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    return fail("invalid_marks", 400, `${checklist}?error=invalid_marks`);
  }
  const marks = parseMarkForm(form);
  if ("error" in marks) {
    return fail(marks.error, 400, `${checklist}?error=${marks.error}`);
  }

  // One insert, with no read before it. The foreign keys, the insert check and row-level security decide.
  // A course or a topic of another learner fails the insert check. The insert asks for no row back.
  const rows = [
    ...marks.mark.map((topicId) => ({ course_id: id, topic_id: topicId, kind: "mark_known" })),
    ...marks.unmark.map((topicId) => ({ course_id: id, topic_id: topicId, kind: "unmark_known" })),
  ];
  const { error } = await supabase.from("learner_events").insert(rows);
  if (error) {
    const key = markErrorKey(error.code);
    return fail(key, insertErrorStatus(key), `${checklist}?error=${key}`);
  }

  if (json) {
    return answer({ saved: rows.length }, 200);
  }
  const anchor = marks.lesson === null ? "" : `#lesson-${marks.lesson}`;
  return context.redirect(`${checklist}?notice=marks_saved${anchor}`);
};
