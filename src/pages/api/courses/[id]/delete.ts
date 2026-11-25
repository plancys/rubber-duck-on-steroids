import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isCourseId } from "@/lib/courses";

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

  // The lessons go with the course. A job that still loads the course ends without a change, because the course is gone.
  // RLS matches zero rows for a course of another learner and gives no error. Read the rows back to detect it.
  const { data, error } = await supabase.from("courses").delete().eq("id", id).select("id");
  if (error) {
    return context.redirect(`/dashboard/courses/${id}?error=unknown`);
  }
  if (data.length === 0) {
    return context.redirect("/dashboard/courses?error=not_found");
  }

  return context.redirect("/dashboard/courses?notice=deleted");
};
