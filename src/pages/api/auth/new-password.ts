import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { toAuthErrorKey } from "@/lib/auth-errors";
import { isAuthRateLimited, rateLimitedResponse } from "@/lib/rate-limit";
import { isRecoverySession } from "@/lib/recovery";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  if (await isAuthRateLimited(context.request, "reset")) {
    return rateLimitedResponse("reset");
  }
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase || !(await isRecoverySession(supabase))) {
    return context.redirect("/auth/reset?error=link_invalid");
  }
  const form = await context.request.formData();
  const password = form.get("password");
  // A missing password can count as "no change" in Supabase. Stop it before the global sign-out.
  if (typeof password !== "string" || password.length < 8) {
    return context.redirect("/auth/new-password?error=weak_password");
  }

  const { error } = await supabase.auth.updateUser({ password });

  // Keep the recovery session on an error, so that the user can try again from the same page.
  if (error) {
    return context.redirect(`/auth/new-password?error=${toAuthErrorKey(error)}`);
  }

  // Sign out every session only after the new password is saved.
  await supabase.auth.signOut({ scope: "global" });
  return context.redirect("/auth/signin?notice=password_changed");
};
