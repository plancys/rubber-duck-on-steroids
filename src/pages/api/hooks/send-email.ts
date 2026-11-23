import type { APIRoute } from "astro";
import {
  ADMIN_EMAIL,
  EMAIL_FROM,
  EMAIL_QUOTA_ALERT_PERCENT,
  RESEND_API_KEY,
  SEND_EMAIL_HOOK_SECRET,
} from "astro:env/server";
import { env, waitUntil } from "cloudflare:workers";
import { buildEmail, quotaAlertText, quotaBreaches, verifyWebhook, type QuotaBreach } from "@/lib/email-hook";

export const prerender = false;

const RESEND_URL = "https://api.resend.com/emails";
// Supabase waits about 5 seconds for the hook. Stop the Resend call before that.
const RESEND_TIMEOUT_MS = 4000;
// The largest hook body that the route reads. See the check in POST.
const MAX_BODY_BYTES = 64 * 1024;

interface HookPayload {
  email: string;
  actionType: string;
  tokenHash: string;
}

// The error shape that Supabase expects from an HTTP hook.
function hookError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { http_code: status, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

// Returns the fields that the hook uses, or null when the body is not valid JSON or has no user email.
function parsePayload(body: string): HookPayload | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(data) || !isRecord(data.user)) return null;
  const email = stringField(data.user, "email");
  if (!email) return null;
  const emailData = isRecord(data.email_data) ? data.email_data : {};
  return {
    email,
    actionType: stringField(emailData, "email_action_type"),
    tokenHash: stringField(emailData, "token_hash"),
  };
}

async function sendWithResend(apiKey: string, message: Record<string, unknown>): Promise<Response> {
  return fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
  });
}

// Supabase calls this route instead of its own mailer. It sends the sign-up and reset emails through Resend.
export const POST: APIRoute = async ({ request }) => {
  if (!SEND_EMAIL_HOOK_SECRET) {
    return hookError(503, "The email hook is not configured");
  }

  // A real hook body is about 2 KB. Refuse a large body before the HMAC, so an unsigned call costs little CPU time.
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return hookError(413, "The body is too large");
  }
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return hookError(413, "The body is too large");
  }
  if (!(await verifyWebhook(SEND_EMAIL_HOOK_SECRET, request.headers, body))) {
    return hookError(401, "The webhook signature is not valid");
  }

  const payload = parsePayload(body);
  if (!payload) {
    return hookError(400, "The body is not valid JSON or has no user email");
  }

  // The links point to the app that got this call. The payload field site_url is the URL of the Supabase Auth
  // server, not the Site URL setting, so a link built from it opens the Auth API and fails.
  const appUrl = new URL(request.url).origin;
  const email = payload.tokenHash !== "" ? buildEmail(payload.actionType, payload.tokenHash, appUrl) : null;
  if (!email) {
    return hookError(400, "The hook does not send this email type");
  }

  if (!RESEND_API_KEY || !EMAIL_FROM) {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn("RESEND_API_KEY or EMAIL_FROM is missing. The email hook cannot send emails.");
    return hookError(503, "The email sender is not configured");
  }

  let response: Response;
  try {
    response = await sendWithResend(RESEND_API_KEY, {
      from: EMAIL_FROM,
      to: [payload.email],
      subject: email.subject,
      html: email.html,
    });
  } catch {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn("The Resend call failed or timed out.");
    return hookError(500, "The email provider did not answer");
  }
  if (!response.ok) {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn(`Resend returned HTTP ${response.status}. The email is not sent.`);
    return hookError(500, `The email provider returned HTTP ${response.status}`);
  }

  if (ADMIN_EMAIL) {
    const breaches = quotaBreaches(
      response.headers.get("x-resend-daily-quota"),
      response.headers.get("x-resend-monthly-quota"),
      EMAIL_QUOTA_ALERT_PERCENT,
      new Date(),
    );
    if (breaches.length > 0) {
      // The alert runs after the response, so it never delays or fails the user email.
      waitUntil(sendQuotaAlert(RESEND_API_KEY, EMAIL_FROM, ADMIN_EMAIL, breaches));
    }
  }

  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

// KV must keep a key for at least 60 seconds.
const MIN_KV_LIFETIME_S = 60;

// Sends one alert for the periods that did not alert yet, and records them in KV until the quota resets.
// This is best effort: the get and the put are not atomic, and a KV read can be up to 60 seconds old.
// So two emails close together can both send an alert. That is rare and harmless.
// The route ignores the quota headers of the alert, so the alert does not trigger another alert.
async function sendQuotaAlert(apiKey: string, from: string, to: string, breaches: QuotaBreach[]): Promise<void> {
  const store = env.QUOTA_ALERTS;
  if (!store) {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn("QUOTA_ALERTS binding is missing. The quota alert is not sent, because it cannot be sent once.");
    return;
  }
  try {
    const sent = await Promise.all(breaches.map((breach) => store.get(breach.key)));
    const open = breaches.filter((_, index) => sent[index] === null);
    if (open.length === 0) return;

    const alertResponse = await sendWithResend(apiKey, {
      from,
      to: [to],
      subject: "Resend email quota alert",
      text: quotaAlertText(open, EMAIL_QUOTA_ALERT_PERCENT),
    });
    if (!alertResponse.ok) {
      // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
      console.warn(`Resend returned HTTP ${alertResponse.status} for the quota alert.`);
      return;
    }
    const earliest = Math.floor(Date.now() / 1000) + MIN_KV_LIFETIME_S;
    await Promise.all(
      open.map((breach) =>
        store.put(breach.key, new Date().toISOString(), { expiration: Math.max(breach.expiresAt, earliest) }),
      ),
    );
  } catch {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn("The quota alert failed. KV or the Resend call did not answer.");
  }
}
