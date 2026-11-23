import type { APIRoute } from "astro";
import { createClient as createCheckClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { toAuthErrorKey } from "@/lib/auth-errors";
import { isAuthRateLimited, rateLimitedResponse } from "@/lib/rate-limit";

export const prerender = false;

const MIN_PASSWORD_LENGTH = 8;
const SETTINGS_PATH = "/dashboard/settings";

export const POST: APIRoute = async (context) => {
  // The change route can test a password guess. It gets its own bucket with the same limit as sign-in.
  if (await isAuthRateLimited(context.request, "password")) {
    return rateLimitedResponse("password");
  }
  const supabase = createClient(context.request.headers, context.cookies);
  const email = context.locals.user?.email;
  if (!supabase || !SUPABASE_URL || !SUPABASE_KEY || !email) {
    return context.redirect(`/auth/signin?next=${encodeURIComponent(SETTINGS_PATH)}`);
  }

  const form = await context.request.formData();
  const currentPassword = form.get("current_password");
  const password = form.get("password");
  const passwordConfirm = form.get("password_confirm");
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return context.redirect(`${SETTINGS_PATH}?error=current_password_invalid`);
  }
  // A missing password can count as "no change" in Supabase. Stop it before the sign-out of the other devices.
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return context.redirect(`${SETTINGS_PATH}?error=weak_password`);
  }
  if (password !== passwordConfirm) {
    return context.redirect(`${SETTINGS_PATH}?error=password_mismatch`);
  }

  // The check client keeps its session only in memory. It never writes the cookies of the user.
  const checkClient = createCheckClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: checkError } = await checkClient.auth.signInWithPassword({ email, password: currentPassword });
  if (checkError) {
    const key = checkError.code === "invalid_credentials" ? "current_password_invalid" : toAuthErrorKey(checkError);
    return context.redirect(`${SETTINGS_PATH}?error=${key}`);
  }
  // End the check session at once. Then no extra session stays open if the save fails.
  const { error: checkSignOutError } = await checkClient.auth.signOut({ scope: "local" });
  if (checkSignOutError) {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn("The check session did not end. It stays open until its refresh token expires.", checkSignOutError);
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return context.redirect(`${SETTINGS_PATH}?error=${toAuthErrorKey(error)}`);
  }

  // Supabase updateUser already ends every other session of the user. This call is a second guard, and it runs
  // only after the new password is saved. This device keeps its session.
  await supabase.auth.signOut({ scope: "others" });
  return context.redirect(`${SETTINGS_PATH}?notice=password_updated`);
};
