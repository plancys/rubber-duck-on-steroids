// The shared parts of the extension routes: CORS for the extension origin, the bearer token, the body limit,
// the client without a session, and the map from a database error to an HTTP status.
// The extension routes are the only routes without a session check. The token decides the learner in the database.

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL } from "astro:env/server";
import type { Database } from "@/db/database.types";

/** A body over 1 MB gets 413. The lessons table also limits the Markdown of a lesson to 1 MB. */
export const EXTENSION_BODY_MAX_BYTES = 1048576;

/** The longest title that the routes store. The worker and the extension functions use the same limit. */
const MAX_TITLE_LENGTH = 300;

// A longer header is not a token of this app. The check saves a database call.
const MAX_TOKEN_LENGTH = 256;

export type ExtensionErrorKey =
  | "forbidden_origin"
  | "rate_limited"
  | "invalid_token"
  | "too_large"
  | "invalid_request"
  | "course_loading"
  | "crawl_course"
  | "course_full"
  | "not_configured"
  | "unknown";

/** Gives the origin of a browser extension, or null for any other caller. */
export function extensionOrigin(request: Request): string | null {
  const origin = request.headers.get("Origin");
  return origin?.startsWith("chrome-extension://") ? origin : null;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

/** The answer to a CORS preflight. Only an extension origin gets the CORS headers. */
export function preflightResponse(request: Request): Response {
  const origin = extensionOrigin(request);
  if (!origin) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

/** A JSON answer. origin is null only for a caller that is not an extension, which gets no CORS headers. */
export function extensionJson(origin: string | null, body: object, status: number): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  return Response.json(body, { status, headers: origin ? { ...headers, ...corsHeaders(origin) } : headers });
}

export function extensionError(origin: string | null, error: ExtensionErrorKey, status: number): Response {
  return extensionJson(origin, { error }, status);
}

/** Reads the token from "Authorization: Bearer <token>". Gives null when the header is missing or wrong. */
export function bearerToken(request: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("Authorization") ?? "");
  const token = match?.[1];
  return token && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

/**
 * Reads a JSON body of at most maxBytes. It stops reading as soon as the body is larger,
 * so a large body costs no more than the limit. It accepts only the content type application/json.
 */
export async function readJsonBody(
  request: Request,
  maxBytes = EXTENSION_BODY_MAX_BYTES,
): Promise<{ body: unknown } | { error: "too_large" | "invalid_request" }> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) return { error: "invalid_request" };
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > maxBytes) return { error: "too_large" };
  if (!request.body) return { error: "invalid_request" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { error: "too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { body: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown };
  } catch {
    return { error: "invalid_request" };
  }
}

/** One line of text without extra spaces, at most 300 characters, or null when nothing is left. */
export function cleanTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_TITLE_LENGTH) : null;
}

/** The clean title, or the URL cut to 300 characters when the page has no title. The database refuses a longer title. */
export function titleOrUrl(value: unknown, url: string): string {
  return cleanTitle(value) ?? url.slice(0, MAX_TITLE_LENGTH);
}

/**
 * A Supabase client with the anon key and no session. The extension functions run as their owner
 * and take the token, so the routes need no session and no service key.
 */
export function createAnonClient() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return null;
  }
  return createSupabaseClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Maps the error of an extension function to a status and a key. The answer never holds the database text.
 * 28000: an unknown or revoked token, or a course that is not an extension course of the token owner.
 * 55006: a crawl course for the URL loads now. RD002: a crawl course for the URL is ready, so the learner reloads it
 * in the product. RD003: the course has 500 lessons.
 * 23514: a check, such as the 1 MB limit of the Markdown or the length limit of a URL or a title.
 */
export function extensionDatabaseError(error: { code: string; message: string }): {
  status: number;
  error: ExtensionErrorKey;
} {
  if (error.code === "28000") return { status: 401, error: "invalid_token" };
  if (error.code === "55006") return { status: 409, error: "course_loading" };
  if (error.code === "RD002") return { status: 409, error: "crawl_course" };
  if (error.code === "RD003") return { status: 409, error: "course_full" };
  if (error.code === "23514") {
    return error.message.includes("lessons_markdown_size_check")
      ? { status: 413, error: "too_large" }
      : { status: 400, error: "invalid_request" };
  }
  return { status: 500, error: "unknown" };
}
