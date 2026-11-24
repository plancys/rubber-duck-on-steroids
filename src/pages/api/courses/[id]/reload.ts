import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { wakeWorker } from "@/lib/jobs";
import { hasJobInProgress, isCourseId, reloadCourse } from "@/lib/courses";

export const prerender = false;

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

  // A course in "loading" without a job stays in that state. So check for a job in progress before the course changes.
  const busy = await hasJobInProgress(supabase);
  if (busy === null) {
    return context.redirect(`/dashboard/courses/${id}?error=unknown`);
  }
  if (busy) {
    return context.redirect(`/dashboard/courses/${id}?error=job_active`);
  }

  const outcome = await reloadCourse(supabase, id);
  if (outcome.kind === "loading") {
    return context.redirect(`/dashboard/courses/${id}`);
  }
  if (outcome.kind === "error") {
    if (outcome.error === "not_found") {
      return context.redirect("/dashboard/courses?error=not_found");
    }
    return context.redirect(`/dashboard/courses/${id}?error=${outcome.error}`);
  }

  // Wake the worker only after the insert succeeds. A lost wake request does not lose the job.
  wakeWorker();
  return context.redirect(`/dashboard/courses/${id}?job=${outcome.jobId}`);
};
