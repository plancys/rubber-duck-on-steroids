// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs
// The reset steps read the email from Mailpit. MAILPIT_URL overrides the default address.
// The Send Email Hook steps run only when SMOKE_HOOK_SECRET holds the SEND_EMAIL_HOOK_SECRET value of the server.

import { Buffer } from "node:buffer";
import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { URL } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const HOOK_SECRET = process.env.SMOKE_HOOK_SECRET ?? "";
const email = `smoke-${Date.now()}@example.com`;
const password = "Smoke-Test-Passw0rd!";
const newPassword = "Smoke-Test-Passw0rd!-New";
// The password that the settings page sets in place of newPassword.
const changedPassword = "Smoke-Test-Passw0rd!-Changed";
// The cookie jar of the main smoke user.
const jar = new Map();
// A second session of the main smoke user. The password change must sign it out.
const otherJar = new Map();
// The jar of the OAuth steps. It keeps the PKCE cookie of the start route away from the main session.
const oauthJar = new Map();
let resetLink = null;
// BEGIN sample-resource
// The notes steps use a second user to prove that one user cannot see the notes of another user.
const emailB = `smoke-b-${Date.now()}@example.com`;
const noteTitle = `Smoke note ${Date.now()}`;
const updatedTitle = `${noteTitle} updated`;
// The main smoke user is user A. User B has a separate jar, so that the test does not sign in again.
const jarB = new Map();
let noteId = null;
// END sample-resource

function cookieHeader(cookies) {
  return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response, cookies) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) cookies.delete(name.trim());
    else cookies.set(name.trim(), rest.join("="));
  }
}

async function request(path, { method = "GET", form, cookies = jar } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(cookies),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(response, cookies);
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    retryAfter: response.headers.get("retry-after"),
    setCookieNames: response.headers.getSetCookie().map((raw) => raw.split("=")[0].trim()),
    body: await response.text(),
  };
}

// Sends wrong-password sign-ins until one returns 429, at most `max` times.
async function signinUntilLimited(max) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } });
    if (last.status === 429) break;
  }
  return last;
}

const CONFIRM_LINK = /https?:\/\/[^\s"'<>]*\/auth\/confirm\?[^\s"'<>]*/;

async function mailpitJson(path) {
  // A hung request must not stop the step past its 10-second deadline.
  const response = await fetch(MAILPIT_URL + path, { signal: globalThis.AbortSignal.timeout(2000) });
  if (!response.ok) throw new Error(`Mailpit returned ${response.status} for ${path}`);
  return response.json();
}

// Returns the path and query of the reset link in the newest email to `to`, or null after about 10 seconds.
// The test sends only the path and query to BASE_URL, because the cookie jar holds cookies for that host only.
async function resetLinkFor(to) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const { messages = [] } = await mailpitJson(`/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
      for (const { ID } of messages) {
        const message = await mailpitJson(`/api/v1/message/${ID}`);
        const match = `${message.Text ?? ""} ${message.HTML ?? ""}`.match(CONFIRM_LINK);
        if (match) {
          const url = new URL(match[0].replaceAll("&amp;", "&"));
          return url.pathname + url.search;
        }
      }
    } catch {
      // Mailpit is not ready or the email is not there yet. Try again until the deadline.
    }
    await sleep(500);
  }
  return null;
}

// Gives a failed step result when no reset link came from Mailpit.
function noResetLink() {
  return { status: 0, location: `no reset link in Mailpit at ${MAILPIT_URL}`, retryAfter: null, body: "" };
}

// Signs a hook body as Standard Webhooks does: HMAC-SHA256 over "id.timestamp.body" with the base64 key of the secret.
function hookSignature(id, timestamp, body) {
  const key = Buffer.from(HOOK_SECRET.replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

// Sends a Send Email Hook call. `signature` is "none", "wrong" or "valid". `ageSeconds` moves the timestamp back.
async function hookRequest(actionType, { signature = "valid", ageSeconds = 0 } = {}) {
  const body = JSON.stringify({
    user: { email: `smoke-hook-${Date.now()}@example.com` },
    email_data: {
      token: "",
      token_hash: "smoke-token-hash",
      redirect_to: "",
      email_action_type: actionType,
    },
  });
  const id = `msg_${randomUUID()}`;
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  const headers = { "Content-Type": "application/json" };
  if (signature !== "none") {
    headers["webhook-id"] = id;
    headers["webhook-timestamp"] = timestamp;
    headers["webhook-signature"] =
      signature === "wrong"
        ? `v1,${Buffer.from("not the signature").toString("base64")}`
        : hookSignature(id, timestamp, body);
  }
  const response = await fetch(`${BASE_URL}/api/hooks/send-email`, {
    method: "POST",
    redirect: "manual",
    headers,
    body,
  });
  return { status: response.status, location: "", retryAfter: null, body: await response.text() };
}

// A sign-up body with a wrong signature must give 401. If the check passes it, the route answers 503 in CI.
const hookSteps = HOOK_SECRET
  ? [
      [
        "send email hook rejects a call without signature",
        () => hookRequest("signup", { signature: "none" }),
        { status: 401 },
      ],
      [
        "send email hook rejects a wrong signature",
        () => hookRequest("signup", { signature: "wrong" }),
        { status: 401 },
      ],
      ["send email hook rejects an old timestamp", () => hookRequest("signup", { ageSeconds: 600 }), { status: 401 }],
      ["send email hook rejects an unknown email type", () => hookRequest("magiclink"), { status: 400 }],
    ]
  : [];

// BEGIN sample-resource
const NOTE_LINK = /\/dashboard\/notes\/([0-9a-f-]{36})/;

// Runs `run` with the id of user A's note. Without an id the step fails, so a user B step cannot pass by accident.
function withNote(run) {
  if (noteId) return run(noteId);
  return { status: 0, location: "no note id from the notes list", retryAfter: null, body: "" };
}
// END sample-resource

const steps = [
  [
    "home renders",
    () => request("/"),
    // The description paragraph must hold text, but the smoke test does not check the exact words.
    {
      status: 200,
      bodyMatches: /data-testid="project-description"[^>]*>\s*[^\s<]/,
      bodyExcludes: 'data-testid="dashboard-cta"',
    },
  ],
  [
    "dashboard redirects anonymous user with next path",
    () => request("/dashboard"),
    { status: 302, location: "/auth/signin?next=%2Fdashboard" },
  ],
  // The OAuth steps. They need OAUTH_PROVIDERS=github,google on the server, but no provider in Supabase.
  // The client builds the authorize URL without a call to Supabase. The smoke test does not know the Supabase URL,
  // so these steps check only the path and the provider in the redirect.
  [
    "sign-in page shows OAuth buttons",
    () => request("/auth/signin", { cookies: oauthJar }),
    // Two lookaheads: both buttons must show, in any order.
    { status: 200, bodyMatches: /^(?=[\s\S]*data-testid="oauth-github")(?=[\s\S]*data-testid="oauth-google")/ },
  ],
  [
    "oauth start redirects to GitHub",
    () => request("/api/auth/oauth", { method: "POST", form: { provider: "github" }, cookies: oauthJar }),
    // The callback needs the PKCE code verifier cookie from this response. Without it, every real login fails.
    { status: 302, locationIncludes: "/auth/v1/authorize?provider=github", setCookieMatches: /-code-verifier$/ },
  ],
  [
    "oauth start redirects to Google",
    () => request("/api/auth/oauth", { method: "POST", form: { provider: "google" }, cookies: oauthJar }),
    { status: 302, locationIncludes: "/auth/v1/authorize?provider=google" },
  ],
  [
    "oauth start rejects unknown provider",
    () => request("/api/auth/oauth", { method: "POST", form: { provider: "facebook" }, cookies: oauthJar }),
    { status: 302, location: "/auth/signin?error=oauth_failed", exact: true },
  ],
  [
    "oauth callback rejects missing code",
    () => request("/auth/callback", { cookies: oauthJar }),
    { status: 302, location: "/auth/signin?error=oauth_failed", exact: true },
  ],
  [
    "oauth callback rejects bad code",
    () => request("/auth/callback?code=not-a-real-code", { cookies: oauthJar }),
    { status: 302, location: "/auth/signin?error=oauth_failed", exact: true },
  ],
  [
    "signup creates account",
    () => request("/api/auth/signup", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "signin rejects wrong password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: "wrong" } }),
    { status: 302, location: "/auth/signin?error=" },
  ],
  [
    "signin accepts correct password",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/", exact: true },
  ],
  [
    "signin returns to next path",
    () => request("/api/auth/signin", { method: "POST", form: { email, password, next: "/dashboard" } }),
    { status: 302, location: "/dashboard", exact: true },
  ],
  [
    "signin ignores absolute next URL",
    () => request("/api/auth/signin", { method: "POST", form: { email, password, next: "https://evil.example" } }),
    { status: 302, location: "/", exact: true },
  ],
  [
    "signin ignores protocol-relative next URL",
    () => request("/api/auth/signin", { method: "POST", form: { email, password, next: "//evil.example" } }),
    { status: 302, location: "/", exact: true },
  ],
  [
    "signin ignores dot-segment next URL",
    () => request("/api/auth/signin", { method: "POST", form: { email, password, next: "/.//evil.example" } }),
    { status: 302, location: "/", exact: true },
  ],
  [
    "dashboard renders for signed-in user",
    () => request("/dashboard"),
    { status: 200, bodyIncludes: 'data-testid="app-shell"' },
  ],
  [
    "home shows dashboard button for signed-in user",
    () => request("/"),
    { status: 200, bodyIncludes: 'data-testid="dashboard-cta"' },
  ],
  [
    "signout clears session",
    () => request("/api/auth/signout", { method: "POST" }),
    { status: 302, location: "/", exact: true },
  ],
  ["dashboard redirects after signout", () => request("/dashboard"), { status: 302, location: "/auth/signin" }],
  [
    "reset request for unknown email shows sent text",
    () => request("/api/auth/reset", { method: "POST", form: { email: `unknown-${email}` } }),
    { status: 302, location: "/auth/reset?sent=1", exact: true },
  ],
  [
    "reset request shows sent text",
    () => request("/api/auth/reset", { method: "POST", form: { email } }),
    { status: 302, location: "/auth/reset?sent=1", exact: true },
  ],
  [
    "reset page shows sent text",
    () => request("/auth/reset?sent=1"),
    { status: 200, bodyIncludes: 'data-testid="reset-sent"' },
  ],
  [
    "reset email link opens new-password page",
    async () => {
      resetLink = await resetLinkFor(email);
      return resetLink ? request(resetLink) : noResetLink();
    },
    { status: 302, location: "/auth/new-password", exact: true },
  ],
  [
    "new-password page renders for recovery session",
    () => request("/auth/new-password"),
    { status: 200, bodyIncludes: 'data-testid="new-password-form"' },
  ],
  // Run this step after the recovery session exists, so that the next step still has its cookies.
  [
    "used reset link is rejected",
    () => (resetLink ? request(resetLink) : noResetLink()),
    { status: 302, location: "/auth/reset?error=link_invalid", exact: true },
  ],
  [
    "new password saves and signs out",
    () => request("/api/auth/new-password", { method: "POST", form: { password: newPassword } }),
    { status: 302, location: "/auth/signin?notice=password_changed", exact: true },
  ],
  [
    "sign-in page shows password changed",
    () => request("/auth/signin?notice=password_changed"),
    { status: 200, bodyIncludes: 'data-testid="auth-notice"' },
  ],
  [
    "old password is rejected",
    () => request("/api/auth/signin", { method: "POST", form: { email, password } }),
    { status: 302, location: "/auth/signin?error=invalid_credentials" },
  ],
  [
    "new password signs in",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: newPassword } }),
    { status: 302, location: "/", exact: true },
  ],
  [
    "password session cannot open new-password page",
    () => request("/auth/new-password"),
    { status: 302, location: "/auth/reset?error=link_invalid", exact: true },
  ],
  // BEGIN sample-resource
  // The notes steps. User A is the main smoke user, signed in by "new password signs in".
  // User B signs up, so that these steps do not use the sign-in limit that the last step needs.
  [
    "notes page redirects anonymous user",
    () => request("/dashboard/notes", { cookies: new Map() }),
    { status: 302, location: "/auth/signin" },
  ],
  [
    "user A creates a note",
    () => request("/api/notes", { method: "POST", form: { title: noteTitle, body: "Smoke note body" } }),
    { status: 302, location: "/dashboard/notes?notice=created", exact: true },
  ],
  [
    "user A sees the note",
    async () => {
      const result = await request("/dashboard/notes");
      noteId = result.body.match(NOTE_LINK)?.[1] ?? null;
      return result;
    },
    { status: 200, bodyIncludes: 'data-testid="note-item"' },
  ],
  [
    "user A updates the note",
    () =>
      withNote((id) =>
        request(`/api/notes/${id}/update`, { method: "POST", form: { title: updatedTitle, body: "Smoke note body" } }),
      ),
    // A getter, because the id is known only after "user A sees the note".
    {
      status: 302,
      exact: true,
      get location() {
        return `/dashboard/notes/${noteId}?notice=updated`;
      },
    },
  ],
  [
    "user B signs up",
    () => request("/api/auth/signup", { method: "POST", form: { email: emailB, password }, cookies: jarB }),
    { status: 302, location: "/auth/confirm-email" },
  ],
  [
    "user B sees no notes",
    () => request("/dashboard/notes", { cookies: jarB }),
    { status: 200, bodyIncludes: 'data-testid="notes-empty"', bodyExcludes: 'data-testid="note-item"' },
  ],
  [
    "user B cannot open user A's note",
    () => withNote((id) => request(`/dashboard/notes/${id}`, { cookies: jarB })),
    { status: 404, bodyExcludes: updatedTitle },
  ],
  [
    "user B cannot update user A's note",
    () =>
      withNote((id) =>
        request(`/api/notes/${id}/update`, { method: "POST", form: { title: "By B", body: "" }, cookies: jarB }),
      ),
    { status: 302, location: "/dashboard/notes?error=not_found", exact: true },
  ],
  [
    "user B cannot delete user A's note",
    () => withNote((id) => request(`/api/notes/${id}/delete`, { method: "POST", cookies: jarB })),
    { status: 302, location: "/dashboard/notes?error=not_found", exact: true },
  ],
  [
    "user A still has the note",
    () => withNote((id) => request(`/dashboard/notes/${id}`)),
    { status: 200, bodyIncludes: updatedTitle },
  ],
  [
    "user A deletes the note",
    () => withNote((id) => request(`/api/notes/${id}/delete`, { method: "POST" })),
    { status: 302, location: "/dashboard/notes?notice=deleted", exact: true },
  ],
  // END sample-resource
  // The settings steps. The main jar has the session of "new password signs in".
  // Sign-in budget: the limit is 10 calls to /api/auth/signin in 60 seconds, in one bucket for all local runs.
  // Before the last step, this file sends 9 sign-in calls: 6 sign-in steps, 2 reset steps, and "second session signs in".
  // In CI, the phone check signs in once just before the smoke test. Then the bucket holds 10, and the last step gets 429 at once.
  // Thus no step before the last step can add a sign-in call. The change route has its own bucket "password".
  // The OAuth start route has its own bucket "oauth", so the OAuth steps do not count against this budget.
  // For this reason, the change route proves the old and the changed password, not /api/auth/signin.
  [
    "settings page renders",
    () => request("/dashboard/settings"),
    { status: 200, bodyIncludes: 'data-testid="change-password-form"' },
  ],
  [
    "second session signs in",
    () => request("/api/auth/signin", { method: "POST", form: { email, password: newPassword }, cookies: otherJar }),
    { status: 302, location: "/", exact: true },
  ],
  [
    "change rejects wrong current password",
    () =>
      request("/api/auth/change-password", {
        method: "POST",
        form: { current_password: "wrong", password: changedPassword, password_confirm: changedPassword },
      }),
    { status: 302, location: "/dashboard/settings?error=current_password_invalid", exact: true },
  ],
  [
    "change rejects mismatched confirmation",
    () =>
      request("/api/auth/change-password", {
        method: "POST",
        form: { current_password: newPassword, password: changedPassword, password_confirm: `${changedPassword}-x` },
      }),
    { status: 302, location: "/dashboard/settings?error=password_mismatch", exact: true },
  ],
  [
    "change saves new password",
    () =>
      request("/api/auth/change-password", {
        method: "POST",
        form: { current_password: newPassword, password: changedPassword, password_confirm: changedPassword },
      }),
    { status: 302, location: "/dashboard/settings?notice=password_updated", exact: true },
  ],
  [
    "settings page shows password changed",
    () => request("/dashboard/settings?notice=password_updated"),
    { status: 200, bodyIncludes: "Password changed. Other devices are signed out." },
  ],
  ["change keeps this session", () => request("/dashboard"), { status: 200, bodyIncludes: 'data-testid="app-shell"' }],
  [
    "change signs out other sessions",
    () => request("/dashboard", { cookies: otherJar }),
    { status: 302, location: "/auth/signin" },
  ],
  // The route signs in with the current password before it saves. The old password must fail that sign-in.
  [
    "old password is rejected after change",
    () =>
      request("/api/auth/change-password", {
        method: "POST",
        form: { current_password: newPassword, password: changedPassword, password_confirm: changedPassword },
      }),
    { status: 302, location: "/dashboard/settings?error=current_password_invalid", exact: true },
  ],
  // Supabase answers same_password only after the sign-in with the current password passed. The password does not change.
  [
    "changed password signs in",
    () =>
      request("/api/auth/change-password", {
        method: "POST",
        form: { current_password: changedPassword, password: changedPassword, password_confirm: changedPassword },
      }),
    { status: 302, location: "/dashboard/settings?error=same_password", exact: true },
  ],
  [
    "healthcheck returns ok",
    () => request("/healthcheck", { cookies: new Map() }),
    { status: 200, bodyIncludes: '"status":"ok"' },
  ],
  ...hookSteps,
  // Keep this step last. It uses up the sign-in limit for about 60 seconds,
  // so a second smoke run in that window fails on its sign-in steps.
  ["signin rate limit returns 429", () => signinUntilLimited(12), { status: 429, retryAfter: true }],
];

function locationMatches(actual, expected) {
  if (expected.locationIncludes !== undefined) return actual.location.includes(expected.locationIncludes);
  if (expected.location === undefined) return true;
  return expected.exact ? actual.location === expected.location : actual.location.startsWith(expected.location);
}

if (!HOOK_SECRET) {
  console.log("SKIP  send email hook steps  -> SMOKE_HOOK_SECRET is not set");
}

let failed = 0;
for (const [name, run, expected] of steps) {
  const actual = await run();
  const ok =
    actual.status === expected.status &&
    locationMatches(actual, expected) &&
    (!expected.retryAfter || Boolean(actual.retryAfter)) &&
    (expected.bodyIncludes === undefined || actual.body.includes(expected.bodyIncludes)) &&
    (expected.bodyMatches === undefined || expected.bodyMatches.test(actual.body)) &&
    (expected.bodyExcludes === undefined || !actual.body.includes(expected.bodyExcludes)) &&
    (expected.setCookieMatches === undefined || actual.setCookieNames.some((n) => expected.setCookieMatches.test(n)));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  -> ${actual.status} ${actual.location}`);
  if (!ok) {
    failed++;
    console.log(`      expected ${expected.status} ${expected.location ?? expected.locationIncludes ?? ""}`);
    if (expected.bodyIncludes !== undefined && !actual.body.includes(expected.bodyIncludes)) {
      console.log(`      missing marker in body: ${expected.bodyIncludes}`);
    }
    if (expected.bodyMatches !== undefined && !expected.bodyMatches.test(actual.body)) {
      console.log(`      no match in body: ${expected.bodyMatches}`);
    }
    if (expected.bodyExcludes !== undefined && actual.body.includes(expected.bodyExcludes)) {
      console.log(`      unexpected marker in body: ${expected.bodyExcludes}`);
    }
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
