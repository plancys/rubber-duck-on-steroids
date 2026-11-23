import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isAuthRateLimited, rateLimitedResponse } from "@/lib/rate-limit";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (await isAuthRateLimited(context.request, "reset")) {
    return rateLimitedResponse("reset");
  }
  const form = await context.request.formData();
  const email = form.get("email") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/reset?error=not_configured");
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email);

  // Show the same text for every other result, so that the page does not tell which emails have accounts.
  // over_email_send_rate_limit is not here: Supabase gives it for each user, so it occurs only for known emails.
  if (error?.code === "over_request_rate_limit") {
    return context.redirect("/auth/reset?error=rate_limited");
  }

  return context.redirect("/auth/reset?sent=1");
};
