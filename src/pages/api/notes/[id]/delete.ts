import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isNoteId } from "@/lib/notes";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/dashboard/notes?error=not_configured");
  }
  // The middleware does not protect /api/notes. Check the session here.
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const { id } = context.params;
  if (!isNoteId(id)) {
    return context.redirect("/dashboard/notes?error=not_found");
  }

  // RLS matches zero rows for a note of another user and gives no error. Read the rows back to detect it.
  const { data, error } = await supabase.from("notes").delete().eq("id", id).select("id");
  if (error) {
    return context.redirect("/dashboard/notes?error=unknown");
  }
  if (data.length === 0) {
    return context.redirect("/dashboard/notes?error=not_found");
  }

  return context.redirect("/dashboard/notes?notice=deleted");
};
