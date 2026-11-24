import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { JOB_VIEW_COLUMNS, isJobId, needsWake, toJobView, wakeWorker } from "@/lib/jobs";

export const prerender = false;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

// The page asks this route for the state of a job every few seconds.
export const GET: APIRoute = async (context) => {
  // The middleware does not protect /api/jobs. Check the session here.
  if (!context.locals.user) {
    return json({ error: "unauthorized" }, 401);
  }
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "not_configured" }, 503);
  }

  // A bad id, a job of another user and an id that does not exist give the same answer. RLS returns no row for both.
  const { id } = context.params;
  if (!isJobId(id)) {
    return json({ error: "not_found" }, 404);
  }
  const { data, error } = await supabase.from("jobs").select(JOB_VIEW_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    return json({ error: "unknown" }, 500);
  }
  if (!data) {
    return json({ error: "not_found" }, 404);
  }

  // A job in progress that does not change can mean a lost wake request. Send the wake request again.
  if (needsWake(data, new Date())) {
    wakeWorker();
  }
  return json(toJobView(data), 200);
};
