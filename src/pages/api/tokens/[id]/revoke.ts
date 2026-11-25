import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isTokenId } from "@/lib/tokens";

export const prerender = false;

const SETTINGS = "/dashboard/settings";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`${SETTINGS}?token_error=not_configured#tokens`);
  }
  // The middleware does not protect /api/tokens. Check the session here.
  if (!context.locals.user) {
    return context.redirect("/auth/signin");
  }

  const { id } = context.params;
  if (!isTokenId(id)) {
    return context.redirect(`${SETTINGS}?token_error=not_found#tokens`);
  }

  // revoke_access_token changes only a live token of the caller. It gives false for any other token.
  const { data: revoked, error } = await supabase.rpc("revoke_access_token", { id });
  if (error) {
    return context.redirect(`${SETTINGS}?token_error=unknown#tokens`);
  }
  if (!revoked) {
    return context.redirect(`${SETTINGS}?token_error=not_found#tokens`);
  }

  return context.redirect(`${SETTINGS}?token_notice=revoked#tokens`);
};
