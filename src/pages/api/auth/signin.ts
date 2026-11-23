import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { toAuthErrorKey } from "@/lib/auth-errors";
import { safeNextPath } from "@/lib/safe-next";
import { isAuthRateLimited, rateLimitedResponse } from "@/lib/rate-limit";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (await isAuthRateLimited(context.request, "signin")) {
    return rateLimitedResponse("signin");
  }
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;
  const rawNext = form.get("next");
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : null, context.url.origin);
  const nextParam = next ? `&next=${encodeURIComponent(next)}` : "";

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=not_configured${nextParam}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return context.redirect(`/auth/signin?error=${toAuthErrorKey(error)}${nextParam}`);
  }

  return context.redirect(next ?? "/");
};
