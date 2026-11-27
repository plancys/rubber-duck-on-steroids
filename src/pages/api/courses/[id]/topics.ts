import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { wakeWorker } from "@/lib/jobs";
import { isCourseId } from "@/lib/courses";
import { insertTopicJob } from "@/lib/topics";

export const prerender = false;

// Starts a build or an update of the topic map of a course. The database checks the course, the job in progress
// and the quota in the job insert, so this route makes no read before the insert.
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/dashboard/courses?error=not_configured");
  }
  // The middleware does not protect /api/courses. Check the session here.
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const { id } = context.params;
  if (!isCourseId(id)) {
    return context.redirect("/dashboard/courses?error=not_found");
  }

  // A course of another learner gives course_not_ready. The course page then answers 404 for that course.
  const outcome = await insertTopicJob(supabase, id);
  if (outcome.kind === "error") {
    return context.redirect(`/dashboard/courses/${id}?error=${outcome.error}`);
  }

  // Wake the worker only after the insert succeeds. A lost wake request does not lose the job.
  wakeWorker();
  return context.redirect(`/dashboard/courses/${id}?job=${outcome.jobId}`);
};
