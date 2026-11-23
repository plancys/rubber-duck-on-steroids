import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const prerender = false;

const INVALID_RESET_LINK = "/auth/reset?error=link_invalid";
const INVALID_SIGNUP_LINK = "/auth/signin?error=confirm_link_invalid";

export const GET: APIRoute = async (context) => {
  const tokenHash = context.url.searchParams.get("token_hash");
  const type = context.url.searchParams.get("type");
  // The route accepts only reset links and sign-up links. It takes no next value and always redirects to a fixed path.
  if (!tokenHash || (type !== "recovery" && type !== "email")) {
    return context.redirect(INVALID_RESET_LINK);
  }
  const invalidLink = type === "email" ? INVALID_SIGNUP_LINK : INVALID_RESET_LINK;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(invalidLink);
  }
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return context.redirect(invalidLink);
  }

  return context.redirect(type === "email" ? "/dashboard" : "/auth/new-password");
};
