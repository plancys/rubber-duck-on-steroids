import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { checkTokenName, hashToken, newTokenValue, type TokenErrorKey } from "@/lib/tokens";

export const prerender = false;

// The Postgres code of a check violation. The route checks the name first, so the code means the limit of 5 live tokens.
const CHECK_VIOLATION = "23514";

// The token is in the body of a success, so no cache may keep any answer of this route.
function answer(body: { error: TokenErrorKey } | { id: string; name: string; token: string }, status: number) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

// The settings page sends the form with fetch and shows the token from the answer once.
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return answer({ error: "not_configured" }, 503);
  }
  // The middleware does not protect /api/tokens. Check the session here.
  if (!context.locals.user) {
    return answer({ error: "signed_out" }, 401);
  }

  const form = await context.request.formData();
  const checked = checkTokenName(form.get("name"));
  if ("error" in checked) {
    return answer({ error: checked.error }, 400);
  }

  const token = newTokenValue();
  const tokenHash = await hashToken(token);
  // The column defaults set the owner. The table keeps only the hash.
  const { data, error } = await supabase
    .from("access_tokens")
    .insert({ name: checked.name, token_hash: tokenHash })
    .select("id")
    .single();
  if (error) {
    if (error.code === CHECK_VIOLATION) {
      return answer({ error: "token_limit" }, 409);
    }
    return answer({ error: "unknown" }, 500);
  }

  return answer({ id: data.id, name: checked.name, token }, 201);
};
