import type { APIRoute } from "astro";
import { ALLOW_PRIVATE_COURSE_URLS } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { wakeWorker } from "@/lib/jobs";
import { hasJobInProgress, insertLoadJob, normalizeCourseUrl, reloadCourse } from "@/lib/courses";

export const prerender = false;

// The Postgres codes of a unique violation and a check violation.
// courses_user_source_url_key gives one course for each URL of a learner. courses_source_url_check rejects a URL
// that is not normalized.
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/dashboard/courses?error=not_configured");
  }
  // The middleware does not protect /api/courses. Check the session here.
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const form = await context.request.formData();
  const checked = normalizeCourseUrl(form.get("url"), ALLOW_PRIVATE_COURSE_URLS);
  if ("error" in checked) {
    return context.redirect(`/dashboard/courses?error=${checked.error}`);
  }

  // A course in "loading" without a job stays in that state. So check for a job in progress before a course changes.
  const busy = await hasJobInProgress(supabase);
  if (busy === null) {
    return context.redirect("/dashboard/courses?error=unknown");
  }
  if (busy) {
    return context.redirect("/dashboard/courses?error=job_active");
  }

  // The column defaults set the owner and the state "loading". RLS rejects any other owner.
  const inserted = await supabase
    .from("courses")
    .insert({ source_url: checked.url, source_kind: "crawl" })
    .select("id")
    .single();

  if (inserted.error) {
    if (inserted.error.code === CHECK_VIOLATION) {
      return context.redirect("/dashboard/courses?error=url_invalid");
    }
    if (inserted.error.code !== UNIQUE_VIOLATION) {
      return context.redirect("/dashboard/courses?error=unknown");
    }

    // The learner has a course for this URL. Load it again, and keep the course.
    // reload_course sets the course loading and inserts the job in one transaction.
    const existing = await supabase.from("courses").select("id").eq("source_url", checked.url).maybeSingle();
    if (existing.error || !existing.data) {
      return context.redirect("/dashboard/courses?error=unknown");
    }
    const courseId = existing.data.id;
    const outcome = await reloadCourse(supabase, courseId);
    if (outcome.kind === "loading") {
      return context.redirect(`/dashboard/courses/${courseId}`);
    }
    if (outcome.kind === "error") {
      return context.redirect(`/dashboard/courses?error=${outcome.error}`);
    }
    wakeWorker();
    return context.redirect(`/dashboard/courses/${courseId}?job=${outcome.jobId}`);
  }

  const courseId = inserted.data.id;
  const outcome = await insertLoadJob(supabase, courseId);
  if (outcome.kind !== "started") {
    // Without a job the new course stays in "loading". Delete it, so a new try starts clean.
    await supabase.from("courses").delete().eq("id", courseId);
    const key = outcome.kind === "error" ? outcome.error : "unknown";
    return context.redirect(`/dashboard/courses?error=${key}`);
  }

  // Wake the worker only after the insert succeeds. A lost wake request does not lose the job.
  wakeWorker();
  return context.redirect(`/dashboard/courses/${courseId}?job=${outcome.jobId}`);
};
