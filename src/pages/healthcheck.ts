import type { APIRoute } from "astro";
import { BUILD_VERSION } from "astro:env/server";

export const prerender = false;

// A cheap check that the Worker runs. It does not call Supabase, so a database problem does not make it fail.
export const GET: APIRoute = () => {
  return new Response(JSON.stringify({ status: "ok", version: BUILD_VERSION }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
};
