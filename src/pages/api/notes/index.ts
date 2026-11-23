import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { parseNoteForm } from "@/lib/notes";

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

  const input = parseNoteForm(await context.request.formData());
  if (typeof input === "string") {
    return context.redirect(`/dashboard/notes?error=${input}`);
  }

  // The column default sets user_id from the session. RLS rejects any other owner.
  const { error } = await supabase.from("notes").insert({ title: input.title, body: input.body });
  if (error) {
    return context.redirect("/dashboard/notes?error=unknown");
  }

  return context.redirect("/dashboard/notes?notice=created");
};
