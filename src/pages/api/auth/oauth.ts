import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { findOAuthProvider, oauthFailedPath } from "@/lib/oauth";
import { safeNextPath } from "@/lib/safe-next";
import { isAuthRateLimited, rateLimitedResponse } from "@/lib/rate-limit";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  // The start route has its own bucket. Thus OAuth starts do not use up the password sign-in limit.
  if (await isAuthRateLimited(context.request, "oauth")) {
    return rateLimitedResponse("oauth");
  }
  const form = await context.request.formData();
  const rawNext = form.get("next");
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : null, context.url.origin);
  const rawProvider = form.get("provider");
  const provider = findOAuthProvider(typeof rawProvider === "string" ? rawProvider : null);
  if (!provider) {
    return context.redirect(oauthFailedPath(next));
  }
  const redirectTo = `${context.url.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/signin?error=not_configured");
  }
  // The client writes the PKCE code verifier into a cookie. This response must carry that cookie to the browser.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider.id,
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data.url) {
    return context.redirect(oauthFailedPath(next));
  }

  return context.redirect(data.url);
};
