// Personal access tokens for the browser extension: the token value, its hash, and the texts.
// The database keeps only the hash. The web app shows a token once, when the learner creates it.
// It uses Web Crypto, because the web app runs on Cloudflare Workers. A React island can import the texts.

/** The longest token name. The check access_tokens_name_check allows 1 to 100 characters after a trim. */
export const TOKEN_NAME_MAX_LENGTH = 100;

/** A learner has at most 5 live tokens. The trigger access_tokens_check_live_limit refuses the 6th one. */
export const MAX_LIVE_TOKENS = 5;

// The count of random bytes in a token.
const TOKEN_BYTES = 32;

export type TokenErrorKey =
  "name_required" | "name_too_long" | "token_limit" | "signed_out" | "not_found" | "not_configured" | "unknown";

const TOKEN_ERROR_TEXTS: Record<TokenErrorKey, string> = {
  name_required: "Enter a name for the token.",
  name_too_long: `The name can have at most ${TOKEN_NAME_MAX_LENGTH} characters.`,
  token_limit: `You can have at most ${MAX_LIVE_TOKENS} tokens. Revoke a token, then create a new one.`,
  signed_out: "Sign in again, then create the token.",
  not_found: "This token does not exist or it is already revoked.",
  not_configured: "Tokens are not available right now.",
  unknown: "Something went wrong. Try again.",
};

export type TokenNoticeKey = "revoked";

const TOKEN_NOTICE_TEXTS: Record<TokenNoticeKey, string> = {
  revoked: "Token revoked. The extension can no longer use it.",
};

/** Maps an error key to a fixed text. Unknown keys give the generic text. */
export function tokenErrorText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(TOKEN_ERROR_TEXTS, key)) {
    return TOKEN_ERROR_TEXTS[key as TokenErrorKey];
  }
  return TOKEN_ERROR_TEXTS.unknown;
}

/** Maps a notice key from the URL to a fixed text. Unknown keys give no text. */
export function tokenNoticeText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(TOKEN_NOTICE_TEXTS, key)) {
    return TOKEN_NOTICE_TEXTS[key as TokenNoticeKey];
  }
  return null;
}

/** Checks the name of a new token and gives it without the spaces at the ends. */
export function checkTokenName(
  input: FormDataEntryValue | null,
): { name: string } | { error: "name_required" | "name_too_long" } {
  const name = typeof input === "string" ? input.trim() : "";
  if (name.length === 0) return { error: "name_required" };
  if (name.length > TOKEN_NAME_MAX_LENGTH) return { error: "name_too_long" };
  return { name };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true when the value is a UUID. A route uses it to skip the call for a bad id. */
export function isTokenId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Makes a new token: 32 random bytes as 64 lowercase hex characters. */
export function newTokenValue(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/**
 * The SHA-256 hash of the token as UTF-8, as 64 lowercase hex characters.
 * The database computes the same text: encode(sha256(convert_to(token, 'UTF8')), 'hex').
 */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}
