// Smoke test: proves the built app, the Cloudflare adapter and the Supabase auth flow still work together.
// Zero dependencies on purpose. Run against a live server: BASE_URL=http://localhost:4321 node scripts/smoke.mjs
// The reset steps read the email from Mailpit. MAILPIT_URL overrides the default address.
// The Send Email Hook steps run only when SMOKE_HOOK_SECRET holds the SEND_EMAIL_HOOK_SECRET value of the server.
// The job steps run only when SMOKE_JOB_CHECK is set. They need ENABLE_JOB_CHECK=true on the server and a running worker.
// The course steps run only when SMOKE_COURSES is set. They need ALLOW_PRIVATE_COURSE_URLS=true on the server,
// a running worker without ANTHROPIC_API_KEY, and the fixture course site of scripts/fixture-server.mjs.
// FIXTURE_COURSE_URL overrides the start page of the fixture course.
// The topic steps run only when SMOKE_TOPICS and SMOKE_COURSES are set. They need the topic engine with the fake model
// (npm run engine -- --fake), and a worker that sends its topic jobs to that engine.

import { Buffer } from "node:buffer";
import { createHmac, randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { URL } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const HOOK_SECRET = process.env.SMOKE_HOOK_SECRET ?? "";
const JOB_CHECK = Boolean(process.env.SMOKE_JOB_CHECK);
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
// The second user of the job steps proves that one user cannot read the job of another user.
// The notes steps have a second user too, but the sample removal deletes it.
const jobEmail = `smoke-job-${Date.now()}@example.com`;
const jobJar = new Map();
// The id of the newest job that the main smoke user started.
let jobId = null;
// The course steps. The course learner has its own jar, so its load jobs never block the job steps of the main user.
// The main smoke user is the second learner, who must not see the course.
const COURSES = Boolean(process.env.SMOKE_COURSES);
const FIXTURE_COURSE_URL = process.env.FIXTURE_COURSE_URL ?? "http://localhost:8799/duck-basics";
const courseEmail = `smoke-course-${Date.now()}@example.com`;
const courseJar = new Map();
// The course of the fixture site and the newest load job of that course.
let courseId = null;
let courseJobId = null;
// The access token of the course learner. The script never prints it.
let accessToken = null;
let accessTokenId = null;
// The course that the extension routes create for the course learner.
let extensionCourseId = null;
// The topic steps use the courses of the course steps, so they run only together with the course steps.
const TOPICS_REQUESTED = Boolean(process.env.SMOKE_TOPICS);
const TOPICS = TOPICS_REQUESTED && COURSES;
// The lesson that the topic steps open on the map page. The fixture course has 3 lessons in page order.
// Lesson 2 answers 404, so the map holds lessons 1 and 3.
const MAP_LESSON = 1;
// The newest topic job that the course learner started with the start route.
let topicJobId = null;
// A topic of the open lesson. The mark steps mark it and remove the mark. The checklist steps mark it again.
let markTopicId = null;

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

// `form` sends the fields as a URL-encoded form. Without `form`, `body` is the body as it is, for example a FormData
// or a JSON text, and `headers` can name its content type. `headers` also adds other headers, such as Accept.
async function request(path, { method = "GET", form, body, headers = {}, cookies = jar } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      Cookie: cookieHeader(cookies),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...headers,
    },
    body: form ? new URLSearchParams(form).toString() : body,
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

const JOB_LINK = /^\/dashboard\/job-check\?job=([0-9a-f-]{36})$/;

// Starts a demo job for the main smoke user and keeps its id. A failed start clears the id,
// so that a later step cannot use the job of an earlier step.
async function startJob(fields) {
  const result = await request("/api/jobs", { method: "POST", form: { type: "demo", ...fields } });
  jobId = result.location.match(JOB_LINK)?.[1] ?? null;
  return result;
}

// Runs `run` with the id of the newest job. Without an id the step fails, so it cannot pass by accident.
function withJob(run) {
  if (jobId) return run(jobId);
  return { status: 0, location: "no job id from the start route", retryAfter: null, body: "" };
}

// Returns the status of the job view in the body, or null when the body is not a job view.
function jobStatus(result) {
  try {
    return JSON.parse(result.body).status ?? null;
  } catch {
    return null;
  }
}

// Asks for the job about once a second until it is done or failed, or until `seconds` pass. Returns the last answer.
// `cookies` is the jar of the user who started the job.
async function waitForJob(id, seconds, cookies = jar) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const result = await request(`/api/jobs/${id}`, { cookies });
    const status = jobStatus(result);
    if (result.status !== 200 || status === "done" || status === "failed" || Date.now() >= deadline) return result;
    await sleep(1000);
  }
}

// Starts a demo job and waits for its end. A failed start gives the answer of the start route.
async function runJob(fields, seconds) {
  const start = await startJob(fields);
  return jobId ? waitForJob(jobId, seconds) : start;
}

// The job steps. The main smoke user has the session of the settings steps.
// A user can have one job in progress. Each step that starts a job runs after the earlier job is done or failed.
// Only "second job start is refused" starts a job while one is in progress, on purpose.
// The worker waits attempt x 5 seconds after a failed start, so 3 failed starts take about 30 seconds.
const jobSteps = JOB_CHECK
  ? [
      [
        "job check page renders",
        () => request("/dashboard/job-check"),
        { status: 200, bodyIncludes: 'data-testid="job-start-form"' },
      ],
      [
        "job start redirects to the job",
        () => startJob({ steps: "2", stepSeconds: "1", failTimes: "0" }),
        { status: 302, location: "/dashboard/job-check?job=" },
      ],
      // The job of the step before takes at least 2 seconds, so it still waits or runs.
      [
        "second job start is refused",
        () =>
          request("/api/jobs", {
            method: "POST",
            form: { type: "demo", steps: "1", stepSeconds: "0", failTimes: "0" },
          }),
        { status: 302, location: "/dashboard/job-check?error=job_active", exact: true },
      ],
      [
        "job ends done",
        () => withJob((id) => waitForJob(id, 60)),
        { status: 200, json: { status: "done", stepCount: 2 } },
      ],
      [
        "second job user signs up",
        () => request("/api/auth/signup", { method: "POST", form: { email: jobEmail, password }, cookies: jobJar }),
        { status: 302, location: "/auth/confirm-email" },
      ],
      [
        "second job user cannot read the job",
        () => withJob((id) => request(`/api/jobs/${id}`, { cookies: jobJar })),
        { status: 404, json: { error: "not_found" } },
      ],
      [
        "job without session returns 401",
        () => withJob((id) => request(`/api/jobs/${id}`, { cookies: new Map() })),
        { status: 401 },
      ],
      [
        "job with 1 failed start ends done on attempt 2",
        () => runJob({ steps: "1", stepSeconds: "0", failTimes: "1" }, 60),
        { status: 200, json: { status: "done", attempts: 2 } },
      ],
      [
        "job with 3 failed starts ends failed",
        () => runJob({ steps: "1", stepSeconds: "0", failTimes: "3" }, 90),
        { status: 200, json: { status: "failed", attempts: 3 } },
      ],
      [
        "job retry redirects to the job",
        () => withJob((id) => request(`/api/jobs/${id}/retry`, { method: "POST" })),
        // A getter, because the id is known only after the step before.
        {
          status: 302,
          exact: true,
          get location() {
            return `/dashboard/job-check?job=${jobId}`;
          },
        },
      ],
      // The retry sets attempts to 0. The worker can take the job at once, so the status can be running with attempt 1.
      [
        "retried job is in progress again",
        () => withJob((id) => request(`/api/jobs/${id}`)),
        { status: 200, json: { status: ["waiting", "running"], attempts: [0, 1] } },
      ],
    ]
  : [];

const COURSE_LINK = /^\/dashboard\/courses\/([0-9a-f-]{36})\?job=([0-9a-f-]{36})$/;
// One lesson row of the course page: its status, then the link to the original page.
const LESSON_ITEM = /data-testid="lesson-item" data-status="(\w+)"[\s\S]*?href="([^"]+)"/g;
// The path of the fixture course. The lesson paths come from the files in scripts/fixtures/course.
const FIXTURE_COURSE_PATH = new URL(FIXTURE_COURSE_URL).pathname.replace(/\/+$/, "");
// The extension routes accept only an extension origin. The smoke test acts as the extension.
const EXTENSION_ORIGIN = "chrome-extension://smoke-test";
// The course that the extension steps start. The extension never reads it, so any public URL works.
const EXTENSION_COURSE_URL = "https://example.com/smoke-extension-course";
const EXTENSION_PAGE_URL = `${EXTENSION_COURSE_URL}/lesson-1`;

// Runs `run` with `value`. Without a value the step fails with `missing`, so it cannot pass by accident.
function withValue(value, missing, run) {
  if (value) return run(value);
  return { status: 0, location: missing, retryAfter: null, body: "" };
}

// Starts a load of the fixture course for the course learner and keeps the id of its job.
// A failed start clears the job id, so that a later step cannot wait for the job of an earlier step.
async function loadFixtureCourse() {
  const result = await request("/api/courses", {
    method: "POST",
    form: { url: FIXTURE_COURSE_URL },
    cookies: courseJar,
  });
  const match = COURSE_LINK.exec(result.location);
  courseJobId = match?.[2] ?? null;
  return { result, linkedCourseId: match?.[1] ?? null };
}

// A course id that no course has. The reload route checks for a job in progress before it reads the course.
// So a reload of this id answers job_active while the learner has a job in progress, and not_found after it.
// The not_found answer changes no row.
const NO_COURSE_ID = "00000000-0000-0000-0000-000000000000";
const JOB_ACTIVE_LOCATION = `/dashboard/courses/${NO_COURSE_ID}?error=job_active`;

// Asks about once a second until the learner of `cookies` has no job in progress, or until `seconds` pass.
// A crawl load that ends ready starts a topic job, and a learner has one job in progress at a time.
// Returns the last answer of the reload route.
async function waitForNoJob(seconds, cookies) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const result = await request(`/api/courses/${NO_COURSE_ID}/reload`, { method: "POST", cookies });
    if (result.location !== JOB_ACTIVE_LOCATION || Date.now() >= deadline) return result;
    await sleep(1000);
  }
}

// Puts a JSON summary in place of the HTML body, so that the json check can compare it. Status and location stay.
function summarize(result, summary) {
  return { ...result, body: JSON.stringify(summary(result.body)) };
}

// The state of the course page and its lessons in order, as "status path" pairs.
function courseSummary(body) {
  const state = /data-testid="course-state" data-status="(\w+)"/.exec(body)?.[1] ?? null;
  const lessons = [...body.matchAll(LESSON_ITEM)].map(([, status, href]) => {
    try {
      return `${status} ${new URL(href.replaceAll("&amp;", "&"), BASE_URL).pathname}`;
    } catch {
      return `${status} ${href}`;
    }
  });
  return { state, lessons: lessons.join(", ") };
}

// Sends a call of the browser extension: the extension origin, the bearer token, and a JSON body.
async function extensionRequest(path, token, body) {
  const response = await fetch(BASE_URL + path, {
    method: "POST",
    redirect: "manual",
    headers: {
      Origin: EXTENSION_ORIGIN,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, location: "", retryAfter: null, body: await response.text() };
}

// The state of the topic map on the course page: its status, a failed topic job, and the build button.
function topicMapSummary(body) {
  return {
    map: /data-testid="topic-map-state" data-status="(\w+)"/.exec(body)?.[1] ?? null,
    failed: body.includes('data-testid="topic-job-failed"'),
    button: body.includes('data-testid="topic-map-build-button"'),
  };
}

// The view of the map page and the lessons of its outline in order, as "position state" pairs.
function mapSummary(body) {
  const view = /data-testid="topic-map-page" data-view="(\w+)"/.exec(body)?.[1] ?? null;
  const lessons = [...body.matchAll(/data-testid="outline-lesson" data-position="(\d+)" data-state="(\w+)"/g)].map(
    ([, position, state]) => `${position} ${state}`,
  );
  return { view, lessons: lessons.join(", ") };
}

// The id of a topic in the outline of an open lesson: <li id="topic-<uuid>">. The space before "id" keeps
// data-testid="topic-..." out of the match.
const OUTLINE_TOPIC = /\sid="topic-([0-9a-f-]{36})"/;

// The mark of one topic on the checklist page: "true", "false", or null when the page does not list the topic.
// The topic element holds data-topic-id and then data-known. A topic id is a UUID, so it is safe in a RegExp.
function knownState(body, topicId) {
  return new RegExp(`data-topic-id="${topicId}"[^>]*data-known="(true|false)"`).exec(body)?.[1] ?? null;
}

// Starts a topic job of the course learner through the start route, and keeps the id of the job.
// A failed start clears the id, so that a later step cannot wait for the job of an earlier step.
async function startTopicJob(id) {
  const result = await request(`/api/courses/${id}/topics`, { method: "POST", cookies: courseJar });
  topicJobId = COURSE_LINK.exec(result.location)?.[2] ?? null;
  return result;
}

// The topic steps after the first load of the fixture course. The load starts the topic job by itself, and the course
// step before these steps waits for the end of that job. The fake model gives one topic for each heading of a lesson.
// A current map and no failed topic job on the course page show that the newest topic job ended done.
// Topic quota: a learner can start 5 topic jobs in one hour. The course learner gets 3: one after each load of the
// fixture course and one for the extension course. The main smoke user is the second learner. The database refuses
// its insert, so it gets no topic job.
const topicMapSteps = TOPICS
  ? [
      [
        "topic job after the load ends with a current map",
        () =>
          withValue(courseId, "no course id from the course load", async (id) =>
            summarize(await request(`/dashboard/courses/${id}`, { cookies: courseJar }), topicMapSummary),
          ),
        { status: 200, json: { map: "current", failed: false } },
      ],
      [
        "map page lists each loaded lesson",
        () =>
          withValue(courseId, "no course id from the course load", async (id) =>
            summarize(await request(`/dashboard/courses/${id}/map`, { cookies: courseJar }), mapSummary),
          ),
        { status: 200, json: { view: "overview", lessons: "1 analysed, 3 analysed" } },
      ],
      [
        "open lesson lists a topic with a quote",
        () =>
          withValue(courseId, "no course id from the course load", (id) =>
            request(`/dashboard/courses/${id}/map?lesson=${MAP_LESSON}`, { cookies: courseJar }),
          ),
        // Three lookaheads: the lesson view, a topic and a quote must show, in any order.
        {
          status: 200,
          bodyMatches:
            /^(?=[\s\S]*data-testid="topic-map-page" data-view="lesson")(?=[\s\S]*data-testid="outline-topic")(?=[\s\S]*data-testid="outline-quote")/,
        },
      ],
      // The mark steps. The course learner marks the first topic of the open lesson, then removes the mark.
      // The marks route answers a form post with a redirect, and a request that asks for JSON with JSON.
      [
        "open lesson gives a topic to mark",
        () =>
          withValue(courseId, "no course id from the course load", async (id) => {
            const result = await request(`/dashboard/courses/${id}/map?lesson=${MAP_LESSON}`, { cookies: courseJar });
            markTopicId = OUTLINE_TOPIC.exec(result.body)?.[1] ?? null;
            return result;
          }),
        { status: 200, bodyMatches: OUTLINE_TOPIC },
      ],
      [
        "learner marks a topic with a form post",
        () =>
          withValue(markTopicId, "no topic id from the open lesson", (topicId) =>
            request(`/api/courses/${courseId}/marks`, {
              method: "POST",
              form: { mark: topicId, lesson: String(MAP_LESSON) },
              cookies: courseJar,
            }),
          ),
        // A getter, because the id is known only after the first load.
        {
          status: 302,
          exact: true,
          get location() {
            return `/dashboard/courses/${courseId}/known?notice=marks_saved#lesson-${MAP_LESSON}`;
          },
        },
      ],
      // The island sends a FormData body and asks for JSON.
      [
        "learner removes the mark with a script request",
        () =>
          withValue(markTopicId, "no topic id from the open lesson", (topicId) => {
            const body = new globalThis.FormData();
            body.append("unmark", topicId);
            return request(`/api/courses/${courseId}/marks`, {
              method: "POST",
              body,
              headers: { Accept: "application/json" },
              cookies: courseJar,
            });
          }),
        { status: 200, json: { saved: 1 } },
      ],
      // Astro checks the origin only for a form body, so the route refuses every other body.
      [
        "marks route refuses a JSON body",
        () =>
          withValue(markTopicId, "no topic id from the open lesson", (topicId) =>
            request(`/api/courses/${courseId}/marks`, {
              method: "POST",
              body: JSON.stringify({ mark: [topicId] }),
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              cookies: courseJar,
            }),
          ),
        { status: 415, json: { error: "invalid_marks" } },
      ],
      [
        "marks route refuses a bad topic id",
        () =>
          withValue(courseId, "no course id from the course load", (id) =>
            request(`/api/courses/${id}/marks`, {
              method: "POST",
              form: { mark: "not-a-topic-id" },
              headers: { Accept: "application/json" },
              cookies: courseJar,
            }),
          ),
        { status: 400, json: { error: "invalid_marks" } },
      ],
      // The main smoke user is the second learner. The route reads nothing before the insert. The insert check of the
      // database cannot see the topics of another learner, so the answer is marks_stale.
      [
        "second learner cannot mark a topic of the course",
        () =>
          withValue(markTopicId, "no topic id from the open lesson", (topicId) =>
            request(`/api/courses/${courseId}/marks`, {
              method: "POST",
              form: { mark: topicId },
              headers: { Accept: "application/json" },
            }),
          ),
        { status: 409, json: { error: "marks_stale" } },
      ],
      // The checklist steps. The mark steps above end with the mark removed, so the topic shows no mark.
      [
        "checklist lists the topics of the course",
        () =>
          withValue(courseId, "no course id from the course load", async (id) =>
            summarize(await request(`/dashboard/courses/${id}/known`, { cookies: courseJar }), (body) => ({
              topics: body.includes('data-testid="known-topic"'),
              known: markTopicId ? knownState(body, markTopicId) : null,
            })),
          ),
        { status: 200, json: { topics: true, known: "false" } },
      ],
      // A form post with no script. The route redirects back to the lesson, and the page shows the mark and the notice.
      [
        "a mark shows on the checklist",
        () =>
          withValue(markTopicId, "no topic id from the open lesson", async (topicId) => {
            const mark = await request(`/api/courses/${courseId}/marks`, {
              method: "POST",
              form: { mark: topicId, lesson: String(MAP_LESSON) },
              cookies: courseJar,
            });
            if (mark.status !== 302) return mark;
            // A browser keeps the fragment of the redirect and does not send it.
            const page = await request(mark.location.split("#")[0], { cookies: courseJar });
            return summarize(page, (body) => ({
              known: knownState(body, topicId),
              notice: body.includes('data-testid="known-notice"'),
            }));
          }),
        { status: 200, json: { known: "true", notice: true } },
      ],
      // The main smoke user is the second learner. The checklist page answers 404 for a course of another learner.
      [
        "second learner gets 404 for the checklist",
        () =>
          withValue(courseId, "no course id from the course load", (id) => request(`/dashboard/courses/${id}/known`)),
        { status: 404, bodyExcludes: 'data-testid="known-page"' },
      ],
      // The main smoke user is the second learner. The map page answers 404 for a course of another learner.
      [
        "second learner cannot open the map",
        () => withValue(courseId, "no course id from the course load", (id) => request(`/dashboard/courses/${id}/map`)),
        { status: 404, bodyExcludes: 'data-testid="topic-map-page"' },
      ],
      // The start route inserts the job with the session of the learner and reads nothing before the insert.
      // So the answer comes from the job rule of the database: a course of another learner gives course_not_ready.
      [
        "second learner cannot insert a topic job for the course",
        () =>
          withValue(courseId, "no course id from the course load", (id) =>
            request(`/api/courses/${id}/topics`, { method: "POST" }),
          ),
        // A getter, because the id is known only after the first load.
        {
          status: 302,
          exact: true,
          get location() {
            return `/dashboard/courses/${courseId}?error=course_not_ready`;
          },
        },
      ],
    ]
  : [];

// The topic steps of the extension course. A course from the extension gets no topic job by itself.
// The learner starts one with the button on the course page, and the button posts to the start route.
// The saved page has one heading, so the fake model gives one topic.
const extensionTopicSteps = TOPICS
  ? [
      [
        "extension course offers the topic map button",
        () =>
          withValue(extensionCourseId, "no course id from the extension", async (id) =>
            summarize(await request(`/dashboard/courses/${id}`, { cookies: courseJar }), topicMapSummary),
          ),
        { status: 200, json: { map: "none", button: true } },
      ],
      [
        "topic map start redirects to the extension course",
        () => withValue(extensionCourseId, "no course id from the extension", (id) => startTopicJob(id)),
        // A getter, because the id is known only after the extension step.
        {
          status: 302,
          get location() {
            return `/dashboard/courses/${extensionCourseId}?job=`;
          },
        },
      ],
      [
        "extension course topic job ends done",
        () => withValue(topicJobId, "no job id from the topic map start", (id) => waitForJob(id, 90, courseJar)),
        { status: 200, json: { status: "done" } },
      ],
      [
        "extension course has a current map",
        () =>
          withValue(extensionCourseId, "no course id from the extension", async (id) =>
            summarize(await request(`/dashboard/courses/${id}`, { cookies: courseJar }), topicMapSummary),
          ),
        { status: 200, json: { map: "current", failed: false } },
      ],
    ]
  : [];

// The course steps. The course learner loads the fixture course through the worker, with the rule fallback.
// The worker has no ANTHROPIC_API_KEY in CI, so the lesson finder picks the links under the course path in page order.
// The fixture course has 3 lessons. The second lesson answers 404, so it fails and the other two load.
// A load that ends ready starts a topic job. After each load, the steps wait until the learner has no job in progress,
// so the next load can start. Without SMOKE_TOPICS, the end state of the topic job does not matter here.
// With SMOKE_TOPICS, the topic steps run after the first load and after the extension steps.
// The extension routes allow 10 calls per minute. These steps send 3 extension calls.
// No step here sends a sign-in call. The sign-up route has its own bucket "signup".
const courseSteps = COURSES
  ? [
      [
        "course learner signs up",
        () =>
          request("/api/auth/signup", { method: "POST", form: { email: courseEmail, password }, cookies: courseJar }),
        { status: 302, location: "/auth/confirm-email" },
      ],
      [
        "course load redirects to the course",
        async () => {
          const { result, linkedCourseId } = await loadFixtureCourse();
          courseId = linkedCourseId;
          return result;
        },
        { status: 302, location: "/dashboard/courses/" },
      ],
      [
        "course load ends done",
        () => withValue(courseJobId, "no job id from the course load", (id) => waitForJob(id, 90, courseJar)),
        { status: 200, json: { status: "done" } },
      ],
      [
        "course learner has no job in progress after the load",
        () => waitForNoJob(60, courseJar),
        { status: 302, location: "/dashboard/courses?error=not_found", exact: true },
      ],
      ...topicMapSteps,
      [
        "course has 2 loaded lessons and 1 failed lesson in order",
        () =>
          withValue(courseId, "no course id from the course load", async (id) =>
            summarize(await request(`/dashboard/courses/${id}`, { cookies: courseJar }), courseSummary),
          ),
        {
          status: 200,
          json: {
            state: "ready",
            lessons: [
              `loaded ${FIXTURE_COURSE_PATH}/first-steps.html`,
              `failed ${FIXTURE_COURSE_PATH}/missing-lesson.html`,
              `loaded ${FIXTURE_COURSE_PATH}/queries.html`,
            ].join(", "),
          },
        },
      ],
      [
        "second load of the same URL redirects to the same course",
        async () => (await loadFixtureCourse()).result,
        // A getter, because the id is known only after the first load.
        {
          status: 302,
          get location() {
            return `/dashboard/courses/${courseId}?job=`;
          },
        },
      ],
      [
        "second course load ends done",
        () => withValue(courseJobId, "no job id from the second course load", (id) => waitForJob(id, 90, courseJar)),
        { status: 200, json: { status: "done" } },
      ],
      [
        "course learner has no job in progress after the second load",
        () => waitForNoJob(60, courseJar),
        { status: 302, location: "/dashboard/courses?error=not_found", exact: true },
      ],
      [
        "course list keeps one course",
        async () =>
          summarize(await request("/dashboard/courses", { cookies: courseJar }), (body) => ({
            courses: body.split('data-testid="course-item"').length - 1,
          })),
        { status: 200, json: { courses: 1 } },
      ],
      // The main smoke user is the second learner. The course page answers 404 for a course of another learner.
      [
        "second learner cannot open the course",
        () => withValue(courseId, "no course id from the course load", (id) => request(`/dashboard/courses/${id}`)),
        { status: 404, bodyExcludes: 'data-testid="lesson-item"' },
      ],
      [
        "token is created",
        async () => {
          const result = await request("/api/tokens", {
            method: "POST",
            form: { name: "Smoke token" },
            cookies: courseJar,
          });
          try {
            const body = JSON.parse(result.body);
            accessToken = body.token ?? null;
            accessTokenId = body.id ?? null;
          } catch {
            accessToken = null;
            accessTokenId = null;
          }
          return result;
        },
        { status: 201, json: { name: "Smoke token" } },
      ],
      [
        "extension starts a course with the token",
        () =>
          withValue(accessToken, "no token from the token route", async (token) => {
            const result = await extensionRequest("/api/extension/courses", token, {
              sourceUrl: EXTENSION_COURSE_URL,
              title: "Smoke extension course",
            });
            try {
              extensionCourseId = JSON.parse(result.body).courseId ?? null;
            } catch {
              extensionCourseId = null;
            }
            return result;
          }),
        { status: 200, bodyMatches: /"courseId":"[0-9a-f-]{36}"/ },
      ],
      [
        "extension saves a page with the token",
        () =>
          withValue(accessToken, "no token from the token route", (token) =>
            withValue(extensionCourseId, "no course id from the extension", (id) =>
              extensionRequest("/api/extension/pages", token, {
                courseId: id,
                url: EXTENSION_PAGE_URL,
                title: "Smoke lesson 1",
                markdown: "# Smoke lesson 1\n\nThe extension saved this page.",
              }),
            ),
          ),
        { status: 200, json: { position: 1 } },
      ],
      [
        "course page lists the saved page",
        () =>
          withValue(extensionCourseId, "no course id from the extension", async (id) =>
            summarize(await request(`/dashboard/courses/${id}`, { cookies: courseJar }), courseSummary),
          ),
        { status: 200, json: { state: "ready", lessons: `loaded ${new URL(EXTENSION_PAGE_URL).pathname}` } },
      ],
      ...extensionTopicSteps,
      [
        "token revoke redirects to settings",
        () =>
          withValue(accessTokenId, "no token id from the token route", (id) =>
            request(`/api/tokens/${id}/revoke`, { method: "POST", cookies: courseJar }),
          ),
        { status: 302, location: "/dashboard/settings?token_notice=revoked" },
      ],
      [
        "revoked token gets 401",
        () =>
          withValue(accessToken, "no token from the token route", (token) =>
            withValue(extensionCourseId, "no course id from the extension", (id) =>
              extensionRequest("/api/extension/pages", token, {
                courseId: id,
                url: `${EXTENSION_COURSE_URL}/lesson-2`,
                title: "Smoke lesson 2",
                markdown: "# Smoke lesson 2\n\nThe revoked token must not save this page.",
              }),
            ),
          ),
        { status: 401, json: { error: "invalid_token" } },
      ],
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
  // The course steps run before the job steps, while the main smoke user still has its session from the settings steps.
  ...courseSteps,
  // The job steps send no sign-in call. They take about a minute, so the sign-in limit can reset before the last step.
  // Then the last step needs 11 calls, and it allows 12.
  ...jobSteps,
  // Keep this step last. It uses up the sign-in limit for about 60 seconds,
  // so a second smoke run in that window fails on its sign-in steps.
  ["signin rate limit returns 429", () => signinUntilLimited(12), { status: 429, retryAfter: true }],
];

function locationMatches(actual, expected) {
  if (expected.locationIncludes !== undefined) return actual.location.includes(expected.locationIncludes);
  if (expected.location === undefined) return true;
  return expected.exact ? actual.location === expected.location : actual.location.startsWith(expected.location);
}

// Returns one text for each field of the JSON body that differs from `expected`. An array lists the values that pass.
function jsonMismatches(body, expected) {
  let actual;
  try {
    actual = JSON.parse(body);
  } catch {
    return ["the body is not JSON"];
  }
  return Object.entries(expected)
    .filter(([key, value]) => (Array.isArray(value) ? !value.includes(actual?.[key]) : actual?.[key] !== value))
    .map(([key, value]) => `${key} is ${JSON.stringify(actual?.[key])}, expected ${JSON.stringify(value)}`);
}

if (!HOOK_SECRET) {
  console.log("SKIP  send email hook steps  -> SMOKE_HOOK_SECRET is not set");
}
if (!JOB_CHECK) {
  console.log("SKIP  job steps  -> SMOKE_JOB_CHECK is not set");
}
if (!COURSES) {
  console.log("SKIP  course steps  -> SMOKE_COURSES is not set");
}
if (!TOPICS_REQUESTED) {
  console.log("SKIP  topic steps  -> SMOKE_TOPICS is not set");
} else if (!TOPICS) {
  console.log("SKIP  topic steps  -> SMOKE_TOPICS needs SMOKE_COURSES");
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
    (expected.json === undefined || jsonMismatches(actual.body, expected.json).length === 0) &&
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
    if (expected.json !== undefined) {
      for (const mismatch of jsonMismatches(actual.body, expected.json)) console.log(`      ${mismatch}`);
    }
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
