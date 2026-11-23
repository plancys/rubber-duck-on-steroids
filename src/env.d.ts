declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}

// Minimal Workers types for the bindings this app uses. Keep in sync with wrangler.jsonc.
// Delete these declarations when the project adopts `npx wrangler types` or @cloudflare/workers-types.
interface RateLimitOptions {
  key: string;
}

interface RateLimitOutcome {
  success: boolean;
}

interface RateLimit {
  limit(options: RateLimitOptions): Promise<RateLimitOutcome>;
}

interface KVNamespacePutOptions {
  // The expiry as Unix seconds. KV needs it at least 60 seconds in the future.
  expiration?: number;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: KVNamespacePutOptions): Promise<void>;
}

declare namespace Cloudflare {
  interface Env {
    // Optional: a deploy can lack the binding. rate-limit.ts fails open then.
    AUTH_RATE_LIMITER?: RateLimit;
    // Optional: without it, the email hook sends no quota alert.
    QUOTA_ALERTS?: KVNamespace;
  }
}

declare module "cloudflare:workers" {
  export const env: Cloudflare.Env;
  // Keeps the Worker alive until the promise settles, after the response is sent.
  export function waitUntil(promise: Promise<unknown>): void;
}
