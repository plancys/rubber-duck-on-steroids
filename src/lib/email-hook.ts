// The testable parts of the Supabase Send Email Hook: the signature check, the email texts and the quota alert.
// The route in src/pages/api/hooks/send-email.ts uses them.

/** The largest difference in seconds between the webhook timestamp and the current time. */
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

/** The Resend Free plan limits. */
const DAILY_LIMIT = 100;
const MONTHLY_LIMIT = 3000;

const encoder = new TextEncoder();

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Checks a Standard Webhooks signature. The secret has the form `v1,whsec_<base64 key>`.
 * The signed content is `${webhook-id}.${webhook-timestamp}.${body}`, signed with HMAC-SHA256.
 * It returns false when a header is missing, the timestamp is more than 5 minutes from now, or no signature matches.
 */
export async function verifyWebhook(secret: string, headers: Headers, body: string): Promise<boolean> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  if (!/^\d+$/.test(timestamp)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const keyBytes = base64ToBytes(secret.replace(/^v1,/, "").replace(/^whsec_/, ""));
  if (!keyBytes || keyBytes.length === 0) return false;

  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const content = encoder.encode(`${id}.${timestamp}.${body}`);

  // crypto.subtle.verify compares the signature in constant time.
  for (const entry of signatureHeader.split(" ")) {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) continue;
    const signatureBytes = base64ToBytes(signature);
    if (!signatureBytes) continue;
    if (await crypto.subtle.verify("HMAC", key, signatureBytes, content)) return true;
  }
  return false;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export interface EmailContent {
  subject: string;
  html: string;
}

/**
 * Builds the email for a Supabase email action type. It supports `signup` and `recovery`.
 * It returns null for all other types.
 */
export function buildEmail(actionType: string, tokenHash: string, appUrl: string): EmailContent | null {
  const base = appUrl.replace(/\/+$/, "");
  const hash = encodeURIComponent(tokenHash);

  if (actionType === "signup") {
    const link = escapeHtml(`${base}/auth/confirm?token_hash=${hash}&type=email`);
    return {
      subject: "Confirm your email",
      html: `<h2>Confirm your email</h2>

<p>Thank you for signing up. Confirm your email address to start.</p>

<p><a href="${link}">Confirm your email</a></p>

<p>The link works one time. If you did not sign up, ignore this email.</p>
`,
    };
  }

  if (actionType === "recovery") {
    // Keep this text the same as supabase/templates/recovery.html.
    const link = escapeHtml(`${base}/auth/confirm?token_hash=${hash}&type=recovery`);
    return {
      subject: "Reset your password",
      html: `<h2>Reset your password</h2>

<p>We got a request to reset the password for your account.</p>

<p><a href="${link}">Set a new password</a></p>

<p>The link works one time and expires in one hour. If you did not ask for a reset, ignore this email.</p>
`,
    };
  }

  return null;
}

function parseCount(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** One quota period that is at or above the alert threshold. */
export interface QuotaBreach {
  /** The key that records the alert for this period. Example: "quota-alert:daily:2026-11-05". */
  key: string;
  /** The quota reset as Unix seconds. The key expires then, so the next period can alert again. */
  expiresAt: number;
  line: string;
}

/**
 * Returns each quota period whose used count is at or above the threshold. The caller sends one alert for each
 * period and records its key until the reset. A missing or non-numeric count gives no breach for that limit.
 * The daily quota resets at midnight UTC. The monthly key uses the calendar month in UTC.
 */
export function quotaBreaches(daily: string | null, monthly: string | null, percent: number, now: Date): QuotaBreach[] {
  if (!Number.isFinite(percent) || percent <= 0) return [];

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  const isoDay = now.toISOString().slice(0, 10);
  const checks: [string, number | null, number, string, number][] = [
    ["daily", parseCount(daily), DAILY_LIMIT, isoDay, Date.UTC(year, month, day + 1)],
    ["monthly", parseCount(monthly), MONTHLY_LIMIT, isoDay.slice(0, 7), Date.UTC(year, month + 1, 1)],
  ];

  const breaches: QuotaBreach[] = [];
  for (const [name, used, limit, period, resetMs] of checks) {
    if (used === null || used < Math.ceil((limit * percent) / 100)) continue;
    breaches.push({
      key: `quota-alert:${name}:${period}`,
      expiresAt: Math.floor(resetMs / 1000),
      line: `The app used ${used} of ${limit} emails of the Resend ${name} limit.`,
    });
  }
  return breaches;
}

/** Returns the alert text for the periods that did not alert yet. */
export function quotaAlertText(breaches: QuotaBreach[], percent: number): string {
  return `${breaches.map((breach) => breach.line).join("\n")}\nThe alert threshold is ${percent} percent. When the app reaches a limit, Resend stops sending sign-up and reset emails.\nYou get no other alert for this limit until the quota resets.`;
}
