import type { APIRoute } from "astro";
import { ENABLE_JOB_CHECK } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { parseDemoForm, wakeWorker } from "@/lib/jobs";

export const prerender = false;

// The Postgres code of a unique violation. The index jobs_one_in_progress_per_user_idx allows one job in progress.
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

  // The demo job is only for the check page, so it needs the same switch.
  const form = await context.request.formData();
  if (!ENABLE_JOB_CHECK || form.get("type") !== "demo") {
    return context.redirect("/dashboard/job-check?error=not_available");
  }
  const { steps, stepSeconds, failTimes } = parseDemoForm(form);

  // The column defaults set the owner, the status and the progress. RLS rejects any other owner.
  const { data, error } = await supabase
    .from("jobs")
    .insert({ type: "demo", payload: { steps, stepSeconds, failTimes } })
    .select("id")
    .single();
  if (error) {
    const key = error.code === UNIQUE_VIOLATION ? "job_active" : "unknown";
    return context.redirect(`/dashboard/job-check?error=${key}`);
  }

  // Wake the worker only after the insert succeeds. A lost wake request does not lose the job.
  wakeWorker();
  return context.redirect(`/dashboard/job-check?job=${data.id}`);
};
