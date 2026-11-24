import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isJobId, wakeWorker } from "@/lib/jobs";

export const prerender = false;

// The Postgres code of a unique violation. retry_job raises it when another job of the learner is in progress.
const UNIQUE_VIOLATION = "23505";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/dashboard/job-check?error=not_configured");
  }
  // The middleware does not protect /api/jobs. Check the session here.
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const { id } = context.params;
  if (!isJobId(id)) {
    return context.redirect("/dashboard/job-check?error=not_available");
  }

  // retry_job changes only a failed job of the caller. For each other job it returns false and changes nothing.
  const { data, error } = await supabase.rpc("retry_job", { job_id: id });
  if (error) {
    const key = error.code === UNIQUE_VIOLATION ? "job_active" : "unknown";
    return context.redirect(`/dashboard/job-check?job=${id}&error=${key}`);
  }

  if (data) {
    wakeWorker();
  }
  return context.redirect(`/dashboard/job-check?job=${id}`);
};
