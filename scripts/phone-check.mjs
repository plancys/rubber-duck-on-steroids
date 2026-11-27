// Phone check: proves that every page fits a phone. It opens each page in headless Chromium at 375x667 and 320x568
// and fails on sideways scroll, an element past the right edge, a bar over 64px, a link or button under 44px, or an input under 16px.
// It signs up and signs in once, at 375px, and the 320px pass starts from the saved cookies.
// It does not check /auth/new-password, because that page needs a recovery session from an email link.
// The only dependency is the playwright library. One-time setup: npx playwright install chromium
// Run it against a live server: BASE_URL=http://localhost:4321 node scripts/phone-check.mjs
// LOOKS selects the looks: empty means one pass with no look cookie, "all" means every look, and "calm,dock" means those looks.
// For a look, the check sets the cookie "look". The server uses the cookie only when ALLOW_LOOK_OVERRIDE is true.
// The course pages: the check loads one course once, then checks /dashboard/courses and the page of that course.
// The load needs ALLOW_PRIVATE_COURSE_URLS=true on the server, because the course is the local fixture site.
// Without the setting, the check skips the course page. FIXTURE_COURSE_URL overrides the start page of the course.
// Run scripts/fixture-server.mjs and the worker to get a course with lessons. Without them, the course does not load,
// but its page still renders. A load that ends ready starts a topic job, so the check waits for the end of that job too.
/* global document, window */

import { setTimeout as sleep } from "node:timers/promises";
import { URL } from "node:url";
import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const email = `phone-check+${Date.now()}@example.com`;
const password = "Phone-Check-Passw0rd!";
const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 320, height: 568 },
];
// The pages that a visitor sees. The signed-in pages come after the sign-in.
const VISITOR_PAGES = ["/", "/auth/signin", "/auth/signup", "/auth/reset", "/auth/confirm-email"];
// The rules. A new page must meet them too.
const RULES = { maxBarHeight: 64, minTapSize: 44, minFontSize: 16 };
const NAV = '[data-testid="shell-nav"]';
// The looks of the app. This list is a copy of LOOKS in src/lib/looks.ts. Change both together.
const ALL_LOOKS = ["warm", "editorial", "calm", "swiss", "dock"];
const COURSES = "/dashboard/courses";
// The start page of the course that the check loads. CI serves it with scripts/fixture-server.mjs.
const FIXTURE_COURSE_URL = process.env.FIXTURE_COURSE_URL ?? "http://localhost:8799/duck-basics";
const COURSE_LINK = /^\/dashboard\/courses\/([0-9a-f-]{36})\?job=([0-9a-f-]{36})$/;
// The course page path after the one load of the run. Undefined before the load, null after a failed or skipped load.
let coursePath;
// A course id that no course has. The reload route checks for a job in progress before it reads the course.
// So a reload of this id answers job_active while the learner has a job in progress, and not_found after it.
// The not_found answer changes no row.
const NO_COURSE_ID = "00000000-0000-0000-0000-000000000000";
const NO_JOB_LOCATION = `${COURSES}?error=not_found`;

// Returns the looks to check. The value null means one pass with no look cookie.
function selectedLooks(value = "") {
  const text = value.trim();
  if (text === "") return [null];
  if (text === "all") return ALL_LOOKS;
  const looks = text.split(",").map((look) => look.trim());
  const unknown = looks.filter((look) => !ALL_LOOKS.includes(look));
  if (unknown.length > 0) {
    console.log(`Unknown look in LOOKS: ${unknown.join(", ")}. Use all, or a comma list of: ${ALL_LOOKS.join(", ")}`);
    process.exit(1);
  }
  return looks;
}

const LOOKS = selectedLooks(process.env.LOOKS);
// The look of the current pass. Each output line starts with it.
let currentLook = null;

let failed = 0;

function report(status, name, width, detail = "") {
  const look = currentLook ? `[${currentLook}] ` : "";
  console.log(`${status}  ${look}${name} @${width}  ${detail}`.trimEnd());
}

// Sets the cookie "look" in `context` and makes `look` the label of the output lines. The value null sets no cookie.
async function useLook(context, look) {
  currentLook = look;
  if (look) await context.addCookies([{ name: "look", value: look, url: BASE_URL }]);
}

// Prints one PASS or FAIL line. More failures of the same page go on their own indented lines.
function record(name, width, failures) {
  if (failures.length === 0) {
    report("PASS", name, width);
    return;
  }
  failed++;
  report("FAIL", name, width, failures[0]);
  for (const failure of failures.slice(1)) console.log(`      ${failure}`);
}

// Runs in the browser. Returns the failures of the page as strings.
// `scope` limits the element checks to one container. `layout` adds the sideways scroll and the bar checks.
// `expectBar` makes a missing bar a failure. The signed-in pages and the visitor home page have the bar.
function measure({ maxBarHeight, minTapSize, minFontSize, scope, layout, expectBar }) {
  const failures = [];
  const root = scope ? document.querySelector(scope) : document.body;
  if (!root) return [`no element matches ${scope}`];
  if (layout) {
    const html = document.documentElement;
    if (html.scrollWidth > html.clientWidth) {
      failures.push(`sideways scroll: ${html.scrollWidth}px wide in ${html.clientWidth}px`);
    }
    const bar = document.querySelector('[data-testid="shell-nav"]');
    if (bar) {
      const height = Math.round(bar.getBoundingClientRect().height);
      if (height > maxBarHeight) failures.push(`shell-nav height ${height}px > ${maxBarHeight}px`);
    } else if (expectBar) {
      failures.push("shell-nav missing");
    }
  }
  // Chromium gives a bounding box to an element inside a closed details. Only the summary of a closed details counts.
  const inClosedDetails = (element) => {
    for (let details = element.closest("details"); details; details = details.parentElement?.closest("details")) {
      const summary = details.querySelector(":scope > summary");
      if (!details.open && !summary?.contains(element)) return true;
    }
    return false;
  };
  const visible = (element) => element.checkVisibility({ visibilityProperty: true }) && !inClosedDetails(element);
  const describe = (element) => {
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 30);
    const label = element.getAttribute("aria-label") ?? element.getAttribute("name") ?? element.id;
    const tag = element.tagName.toLowerCase();
    if (text) return `${tag} "${text}"`;
    return label ? `${tag}[${label}]` : tag;
  };
  if (layout) {
    // A wrapper with overflow clipping hides a too-wide element from the scroll check, but the user still
    // sees a cut element. The decorative orbs reach past the edge on purpose and have pointer-events: none.
    const edge = document.documentElement.clientWidth + 1;
    const wide = [...document.body.querySelectorAll("*")].filter((element) => {
      if (!visible(element) || window.getComputedStyle(element).pointerEvents === "none") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.right > edge;
    });
    for (const element of wide.slice(0, 3)) {
      failures.push(
        `${describe(element)} reaches ${Math.round(element.getBoundingClientRect().right)}px, past ${edge - 1}px`,
      );
    }
  }
  for (const element of root.querySelectorAll('a, button, summary, input[type="submit"]')) {
    if (!visible(element)) continue;
    const rect = element.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width < minTapSize || height < minTapSize) {
      failures.push(`${describe(element)} ${width}x${height}px < ${minTapSize}x${minTapSize}px`);
    }
  }
  for (const element of root.querySelectorAll("input, textarea, select")) {
    if (!visible(element)) continue;
    const size = parseFloat(window.getComputedStyle(element).fontSize);
    if (size < minFontSize) failures.push(`${describe(element)} font ${size}px < ${minFontSize}px`);
  }
  return failures;
}

// Waits for the hydration of every island, so that a fill reaches the React state.
async function waitForIslands(page) {
  await page.waitForFunction(() => !document.querySelector("astro-island[ssr]"));
}

// Opens a page in `context` with the timeout of the run.
async function openPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  return page;
}

// Runs one step. A thrown error, as a Playwright timeout, counts as one failure of `name`, and the run goes on.
async function guarded(name, width, step) {
  try {
    return await step();
  } catch (error) {
    record(name, width, [error.message.split("\n")[0]]);
    return false;
  }
}

// Opens `path` and runs the checks. A 404 counts as skipped. A redirect to another page fails.
// For a requested look, the page must render that look in data-theme on <html>. Else the server ignored the cookie.
async function checkPage(page, path, width, { expectBar = false } = {}) {
  const response = await page.goto(BASE_URL + path);
  const status = response?.status() ?? 0;
  if (status === 404) {
    report("SKIP", path, width, "404");
    return false;
  }
  const landed = new URL(page.url());
  if (status !== 200 || landed.pathname !== path) {
    record(path, width, [`answered ${status} at ${landed.pathname}${landed.search}`]);
    return false;
  }
  const failures = await page.evaluate(measure, { ...RULES, scope: null, layout: true, expectBar });
  if (currentLook) {
    const rendered = await page.evaluate(() => document.documentElement.dataset.theme ?? "none");
    if (rendered !== currentLook) failures.unshift(`look ${rendered} != ${currentLook}`);
  }
  record(path, width, failures);
  return true;
}

// Fills the form that posts to `action`, submits it and expects a redirect to `expected`.
// `expected` is the exact path and query, or a RegExp for a redirect with an id in it.
// `skip` names a redirect that means a server setting is off. Then the step counts as skipped, not failed.
// On a 429 answer it waits for Retry-After or 60 seconds and tries once more.
async function submitForm(page, { name, path, action, fields, expected, width, skip }) {
  const matches = (value) => (expected instanceof RegExp ? expected.test(value) : value === expected);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto(BASE_URL + path);
    await waitForIslands(page);
    const form = `form[action="${action}"]`;
    for (const [field, value] of Object.entries(fields)) await page.fill(`${form} [name="${field}"]`, value);
    const posted = page.waitForResponse((r) => r.request().method() === "POST" && r.url() === BASE_URL + action);
    await page.click(`${form} button[type="submit"]`);
    const response = await posted;
    const status = response.status();
    if (status === 429 && attempt === 1) {
      const seconds = Number(response.headers()["retry-after"]) || 60;
      report("WAIT", name, width, `429, next try in ${seconds}s`);
      await sleep(seconds * 1000);
      continue;
    }
    const location = response.headers().location ?? "";
    if (skip && status === 302 && location === skip.location) {
      report("SKIP", name, width, skip.reason);
      return false;
    }
    const ok = status === 302 && matches(location);
    if (!ok) failed++;
    report(ok ? "PASS" : "FAIL", name, width, `-> ${status} ${location}`);
    if (ok) await page.waitForURL((url) => matches(url.pathname + url.search));
    return ok;
  }
  return false;
}

// Waits until the job `jobId` is done or failed, at most `seconds`. Returns false when the time runs out.
// The course page reloads itself when its load job ends, so a check during the load can lose its page.
async function waitForJobEnd(page, jobId, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const response = await page.request.get(`${BASE_URL}/api/jobs/${jobId}`);
    const job = response.ok() ? await response.json() : null;
    if (job?.status === "done" || job?.status === "failed") return true;
    await sleep(1000);
  }
  return false;
}

// Waits until the learner has no job in progress, at most `seconds`. Returns false when the time runs out.
// A crawl load that ends ready starts a topic job, and a learner has one job in progress at a time.
async function waitForNoJob(page, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const response = await page.request.post(`${BASE_URL}/api/courses/${NO_COURSE_ID}/reload`, {
      headers: { Origin: BASE_URL },
      maxRedirects: 0,
    });
    if (response.status() === 302 && response.headers().location === NO_JOB_LOCATION) return true;
    await sleep(1000);
  }
  return false;
}

// Loads the fixture course through the form and waits for the end of its load job and of the topic job after it.
// Returns the path of the course page, or null when the load did not start.
async function loadCourse(page, width) {
  const started = await submitForm(page, {
    name: "load course",
    path: COURSES,
    action: "/api/courses",
    fields: { url: FIXTURE_COURSE_URL },
    expected: COURSE_LINK,
    width,
    skip: { location: `${COURSES}?error=url_private`, reason: "ALLOW_PRIVATE_COURSE_URLS is not true on the server" },
  });
  if (!started) return null;
  const landed = new URL(page.url());
  const [, , jobId] = COURSE_LINK.exec(landed.pathname + landed.search) ?? [];
  // Without a worker the job never ends. Then the page does not reload, and the check can measure it anyway.
  if (jobId && !(await waitForJobEnd(page, jobId, 60))) {
    report("WAIT", "load course", width, "the load job did not end in 60s, check the page anyway");
  } else if (!(await waitForNoJob(page, 60))) {
    report("WAIT", "load course", width, "a job was still in progress after 60s, check the page anyway");
  }
  return landed.pathname;
}

// The signed-in pages. The dashboard check also opens the phone menu and measures the open panel.
async function checkSignedInPages(page, width) {
  await guarded("/", width, () => checkPage(page, "/", width, { expectBar: true }));
  if (await guarded("/dashboard", width, () => checkPage(page, "/dashboard", width, { expectBar: true }))) {
    await guarded("/dashboard menu", width, async () => {
      // A shell with no phone menu, as Warm soft, has no summary in the bar. Then the check skips the menu.
      if ((await page.locator(`${NAV} summary`).count()) === 0) {
        report("SKIP", "/dashboard menu", width, "no phone menu in this look");
        return;
      }
      await page.click(`${NAV} summary`);
      const panel = `${NAV} details[open]`;
      record("/dashboard menu", width, await page.evaluate(measure, { ...RULES, scope: panel, layout: false }));
    });
  }
  const settings = "/dashboard/settings";
  await guarded(settings, width, () => checkPage(page, settings, width, { expectBar: true }));
  // The job check page. Without ENABLE_JOB_CHECK on the server, it answers 404 and the check skips it.
  const jobCheck = "/dashboard/job-check";
  await guarded(jobCheck, width, () => checkPage(page, jobCheck, width, { expectBar: true }));
  // The course pages. The first pass loads one course, and every pass checks the list and the page of that course.
  if (await guarded(COURSES, width, () => checkPage(page, COURSES, width, { expectBar: true }))) {
    if (coursePath === undefined) {
      coursePath = (await guarded("load course", width, () => loadCourse(page, width))) || null;
    }
    if (coursePath) {
      await guarded(coursePath, width, () => checkPage(page, coursePath, width, { expectBar: true }));
    }
  }
  // BEGIN sample-resource
  // The notes pages. After the removal of the sample, the list page answers 404 and the check skips it.
  const notes = "/dashboard/notes";
  if (await guarded(notes, width, () => checkPage(page, notes, width, { expectBar: true }))) {
    const created = await guarded("create note", width, () =>
      submitForm(page, {
        name: "create note",
        path: notes,
        action: "/api/notes",
        fields: { title: `Phone check note ${Date.now()}`, body: "Phone check note body" },
        expected: `${notes}?notice=created`,
        width,
      }),
    );
    // A failed create step has its own FAIL line, so the link lookup runs only after a success.
    if (created) {
      const name = `${notes}/<id>`;
      const href = await guarded(name, width, async () => {
        const links = page.locator('[data-testid="note-item"] a');
        if ((await links.count()) === 0) {
          record(name, width, ["no note link on the notes page"]);
          return null;
        }
        return links.first().getAttribute("href");
      });
      if (href) await guarded(href, width, () => checkPage(page, href, width, { expectBar: true }));
    }
  }
  // END sample-resource
}

async function run(browser) {
  let signedUp = false;
  // The cookies of the signed-in user. The first viewport signs in once, and every signed-in context starts from them.
  let storageState;
  for (const viewport of VIEWPORTS) {
    const { width } = viewport;
    // The visitor pages, in a context without a session cookie. Each look sets its look cookie in the same context.
    const visitor = await browser.newContext({ viewport });
    try {
      const page = await openPage(visitor);
      for (const look of LOOKS) {
        await useLook(visitor, look);
        for (const path of VISITOR_PAGES) {
          await guarded(path, width, () => checkPage(page, path, width, { expectBar: path === "/" }));
        }
      }
      // One sign-up and one sign-in for the whole run. The steps run in the first look.
      if (!storageState) {
        await useLook(visitor, LOOKS[0]);
        if (!signedUp) {
          signedUp = await guarded("sign up", width, () =>
            submitForm(page, {
              name: "sign up",
              path: "/auth/signup",
              action: "/api/auth/signup",
              fields: { email, password, confirmPassword: password },
              expected: "/auth/confirm-email",
              width,
            }),
          );
        }
        const signedIn = await guarded("sign in", width, () =>
          submitForm(page, {
            name: "sign in",
            path: "/auth/signin",
            action: "/api/auth/signin",
            fields: { email, password },
            expected: "/",
            width,
          }),
        );
        if (!signedIn) continue;
        storageState = await visitor.storageState();
      }
    } finally {
      await visitor.close();
    }
    // The signed-in pages, in a context that starts from the saved cookies. Each look sets its look cookie in it.
    const context = await browser.newContext({ viewport, storageState });
    try {
      const page = await openPage(context);
      for (const look of LOOKS) {
        await useLook(context, look);
        await checkSignedInPages(page, width);
      }
    } finally {
      await context.close();
    }
  }
}

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  if (/Executable doesn't exist/.test(error.message)) {
    console.log("Run npx playwright install chromium");
    process.exit(1);
  }
  throw error;
}
try {
  await run(browser);
} catch (error) {
  failed++;
  console.log(`FAIL  ${error.message.split("\n")[0]}`);
} finally {
  await browser.close();
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll phone checks passed");
process.exit(failed ? 1 : 0);
