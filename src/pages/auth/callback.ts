import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { oauthFailedPath } from "@/lib/oauth";
import { safeNextPath } from "@/lib/safe-next";

export const prerender = false;

export const GET: APIRoute = async (context) => {
  const params = context.url.searchParams;
  // Check the next value again. The start route checked it, but anyone can edit this URL.
  const next = safeNextPath(params.get("next"), context.url.origin);
  const code = params.get("code");
  // The provider or Supabase sends an error in the query when the user cancels or the login fails.
  if (params.has("error") || params.has("error_code") || !code) {
    return context.redirect(oauthFailedPath(next));
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(oauthFailedPath(next));
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return context.redirect(oauthFailedPath(next));
  }

  return context.redirect(next ?? "/");
};
