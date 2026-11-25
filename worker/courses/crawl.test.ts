import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ADDRESS_REASON,
  BLOCKED_REASON,
  lessonTitle,
  MAX_LINK_TITLE_LENGTH,
  normalizeLinks,
  NOT_HTML_REASON,
  readLessons,
  readStartPage,
  ROBOTS_NO_ANSWER_REASON,
  ROBOTS_REASON,
  type PageLog,
} from "./crawl.ts";
import { USER_AGENT, type Fetch, type Lookup } from "./http.ts";

const START_HTML = readFileSync(new URL("fixtures/start.html", import.meta.url), "utf8");
const LESSON_HTML = readFileSync(new URL("fixtures/lesson.html", import.meta.url), "utf8");

const START_URL = "https://docs.example/docs/ducks";

interface Page {
  status?: number;
  body?: string;
  type?: string;
  // The target of a redirect.
  location?: string;
  // The fetch rejects, as on a network error.
  noAnswer?: boolean;
}

// A fake fetch that serves the given pages and records each request. A page that is not listed answers 404.
function fakeSite(pages: Record<string, Page>) {
  const requests: { url: string; headers: Headers }[] = [];
  const fetchPage: Fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({ url, headers: new Headers(init?.headers) });
    const page = pages[url] ?? { status: 404, body: "<html><body>Not found</body></html>" };
    if (page.noAnswer) return Promise.reject(new TypeError("fetch failed"));
    const headers: Record<string, string> = { "content-type": page.type ?? "text/html; charset=utf-8" };
    if (page.location) headers.location = page.location;
    return Promise.resolve(new Response(page.body ?? "", { status: page.status ?? 200, headers }));
  };
  return { fetchPage, requests };
}

// A fake DNS lookup. docs.example has a public address. A host in privateHosts has a private address.
function fakeLookup(privateHosts: readonly string[] = []): Lookup {
  return (hostname) => Promise.resolve(privateHosts.includes(hostname) ? ["10.0.0.5"] : ["93.184.216.34"]);
}

function options(fetchPage: Fetch, lookup: Lookup = fakeLookup()) {
  const lines: PageLog[] = [];
  return {
    lines,
    crawl: {
      fetch: fetchPage,
      lookup,
      signal: new AbortController().signal,
      log: (line: PageLog) => {
        lines.push(line);
      },
    },
  };
}

const ROBOTS_ALLOW = { body: "User-agent: *\nAllow: /\n", type: "text/plain" };

test("links become absolute, stay on the site, lose the fragment, the trailing slash and the duplicates, and keep the page order", () => {
  const links = normalizeLinks(
    [
      { href: "/docs/ducks/one", text: " One \n lesson " },
      { href: "two", text: "Two" },
      { href: "/docs/ducks/one#part", text: "One again" },
      { href: "/docs/ducks/one/", text: "One with a slash" },
      { href: "https://other.example/docs/ducks/three", text: "Other site" },
      { href: "mailto:team@example.com", text: "Mail" },
      { href: "javascript:void(0)", text: "Script" },
      { href: "/docs/ducks/", text: "This page" },
      { href: null, text: "No href" },
      { href: "http://[bad", text: "Bad URL" },
      { href: "/docs/ducks/four?step=2#top", text: null },
      { href: "/docs/ducks/five/", text: "Five" },
    ],
    "https://docs.example/docs/ducks/",
  );
  assert.deepEqual(links, [
    { url: "https://docs.example/docs/ducks/one", text: "One lesson" },
    { url: "https://docs.example/docs/ducks/two", text: "Two" },
    { url: "https://docs.example/docs/ducks/four?step=2", text: "" },
    { url: "https://docs.example/docs/ducks/five", text: "Five" },
  ]);
});

test("the start page gives the course title and its links in page order", async () => {
  const site = fakeSite({
    "https://docs.example/robots.txt": ROBOTS_ALLOW,
    [START_URL]: { body: START_HTML },
  });
  const { crawl, lines } = options(site.fetchPage);
  const result = await readStartPage(START_URL, crawl);
  assert.equal(result.kind, "page");
  assert.equal(result.page.title, "Intro to Ducks");
  assert.deepEqual(
    result.page.links.map((link) => [link.url, link.text]),
    [
      ["https://docs.example", "Home"],
      ["https://docs.example/blog", "Blog"],
      ["https://docs.example/docs/ducks/first-steps", "First steps"],
      ["https://docs.example/docs/ducks/second", "Second lesson"],
      ["https://docs.example/docs/ducks/private", "Private lesson"],
      ["https://docs.example/docs/ducks/missing", "Missing lesson"],
      ["https://docs.example/docs/other/page", "Outside the course"],
    ],
  );
  assert.deepEqual(lines, [{ event: "page", url: START_URL, result: "loaded", status: 200 }]);
});

test("each request says that it comes from the bot and sends no browser-like headers", async () => {
  const site = fakeSite({
    "https://docs.example/robots.txt": ROBOTS_ALLOW,
    [START_URL]: { body: START_HTML },
  });
  await readStartPage(START_URL, options(site.fetchPage).crawl);
  assert.deepEqual(
    site.requests.map((request) => request.url),
    ["https://docs.example/robots.txt", START_URL],
  );
  for (const request of site.requests) {
    assert.equal(request.headers.get("user-agent"), USER_AGENT);
    assert.ok(!request.headers.has("sec-ch-ua"));
    assert.ok(!request.headers.has("accept-language"));
  }
});

test("a start page that answers 403 is blocked", async () => {
  for (const status of [401, 403, 429]) {
    const site = fakeSite({
      "https://docs.example/robots.txt": { status: 403, body: "Forbidden", type: "text/plain" },
      [START_URL]: { status, body: "Access denied", type: "text/plain" },
    });
    const { crawl, lines } = options(site.fetchPage);
    assert.deepEqual(await readStartPage(START_URL, crawl), { kind: "blocked", status });
    assert.deepEqual(lines, [{ event: "page", url: START_URL, result: "blocked", status }]);
  }
});

test("a start page that robots.txt disallows is blocked, and the crawl does not read it", async () => {
  const site = fakeSite({
    "https://docs.example/robots.txt": { body: "User-agent: RubberDuckBot\nDisallow: /docs/\n", type: "text/plain" },
    [START_URL]: { body: START_HTML },
  });
  const { crawl, lines } = options(site.fetchPage);
  assert.deepEqual(await readStartPage(START_URL, crawl), { kind: "blocked" });
  assert.deepEqual(
    site.requests.map((request) => request.url),
    ["https://docs.example/robots.txt"],
  );
  assert.deepEqual(lines, [{ event: "page", url: START_URL, result: "skipped_by_robots", reason: ROBOTS_REASON }]);
});

test("a robots.txt that does not answer fails the start page as a network error, and the crawl does not read it", async () => {
  for (const robots of [{ status: 500, body: "Server error", type: "text/plain" }, { noAnswer: true }]) {
    const site = fakeSite({ "https://docs.example/robots.txt": robots, [START_URL]: { body: START_HTML } });
    const { crawl, lines } = options(site.fetchPage);
    assert.deepEqual(await readStartPage(START_URL, crawl), { kind: "failed" });
    assert.deepEqual(
      site.requests.map((request) => request.url),
      ["https://docs.example/robots.txt"],
    );
    assert.deepEqual(lines, [{ event: "page", url: START_URL, result: "failed", reason: ROBOTS_NO_ANSWER_REASON }]);
  }
});

test("a start page on a private address is rejected, and the crawl sends no request", async () => {
  const site = fakeSite({ "https://docs.example/robots.txt": ROBOTS_ALLOW, [START_URL]: { body: START_HTML } });
  const { crawl, lines } = options(site.fetchPage, fakeLookup(["docs.example"]));
  assert.deepEqual(await readStartPage(START_URL, crawl), { kind: "rejected" });
  assert.deepEqual(site.requests, []);
  assert.deepEqual(lines, [{ event: "page", url: START_URL, result: "failed", reason: ADDRESS_REASON }]);

  const literal = fakeSite({});
  const local = options(literal.fetchPage);
  assert.deepEqual(await readStartPage("http://127.0.0.1:8080/course", local.crawl), { kind: "rejected" });
  assert.deepEqual(literal.requests, []);
});

test("a start page that redirects to a private address is rejected, and the crawl does not follow the redirect", async () => {
  const site = fakeSite({
    "https://docs.example/robots.txt": ROBOTS_ALLOW,
    [START_URL]: { status: 302, location: "http://internal.example/admin" },
  });
  const { crawl } = options(site.fetchPage, fakeLookup(["internal.example"]));
  assert.deepEqual(await readStartPage(START_URL, crawl), { kind: "rejected" });
  assert.deepEqual(
    site.requests.map((request) => request.url),
    ["https://docs.example/robots.txt", START_URL],
  );
});

test("a start page that redirects on the site gives the links of the page after the redirect", async () => {
  const site = fakeSite({
    "https://docs.example/robots.txt": ROBOTS_ALLOW,
    "https://docs.example/old/ducks": { status: 301, location: "/docs/ducks" },
    [START_URL]: { body: START_HTML },
  });
  const result = await readStartPage("https://docs.example/old/ducks", options(site.fetchPage).crawl);
  assert.equal(result.kind, "page");
  assert.equal(result.page.url, START_URL);
  assert.ok(result.page.links.some((link) => link.url === "https://docs.example/docs/ducks/first-steps"));
});

test("with allowPrivateAddresses the crawl reads a private address", async () => {
  const site = fakeSite({ "https://docs.example/robots.txt": ROBOTS_ALLOW, [START_URL]: { body: START_HTML } });
  const { crawl } = options(site.fetchPage, fakeLookup(["docs.example"]));
  const result = await readStartPage(START_URL, { ...crawl, allowPrivateAddresses: true });
  assert.equal(result.kind, "page");
});

test("a start page that answers 404 fails without the blocked reason", async () => {
  const site = fakeSite({ "https://docs.example/robots.txt": ROBOTS_ALLOW });
  assert.deepEqual(await readStartPage(START_URL, options(site.fetchPage).crawl), { kind: "failed", status: 404 });
  assert.ok(BLOCKED_REASON.includes("browser extension"));
});

test("a failed lesson does not stop the other lessons, and the lessons keep the link order", async () => {
  const site = fakeSite({
    "https://docs.example/robots.txt": {
      body: "User-agent: *\nDisallow: /docs/ducks/private\n",
      type: "text/plain",
    },
    "https://docs.example/docs/ducks/first-steps": { body: LESSON_HTML },
    "https://docs.example/docs/ducks/second": { body: LESSON_HTML },
    "https://docs.example/docs/ducks/data.json": { body: "{}", type: "application/json" },
    "https://docs.example/docs/ducks/moved": { status: 302, location: "http://internal.example/secret" },
  });
  const { crawl, lines } = options(site.fetchPage, fakeLookup(["internal.example"]));
  const done: number[] = [];
  const lessons = await readLessons(
    [
      { url: "https://docs.example/docs/ducks/first-steps", text: "First steps" },
      { url: "https://docs.example/docs/ducks/missing", text: "Missing lesson" },
      { url: "https://docs.example/docs/ducks/private", text: "Private lesson" },
      { url: "https://docs.example/docs/ducks/data.json", text: "" },
      { url: "https://docs.example/docs/ducks/second", text: "Second lesson" },
      { url: "https://docs.example/docs/ducks/moved", text: "Moved lesson" },
    ],
    {
      ...crawl,
      onPage: (count) => {
        done.push(count);
        return Promise.resolve();
      },
    },
  );

  assert.deepEqual(
    lessons.map((lesson) => [lesson.position, lesson.title, lesson.status, lesson.error]),
    [
      [1, "First steps", "loaded", null],
      [2, "Missing lesson", "failed", "The page answered with status 404."],
      [3, "Private lesson", "failed", ROBOTS_REASON],
      [4, null, "failed", NOT_HTML_REASON],
      [5, "Second lesson", "loaded", null],
      [6, "Moved lesson", "failed", ADDRESS_REASON],
    ],
  );
  assert.equal(lessons[1]?.markdown, null);
  // Readability keeps the title apart from the text, so the text starts below the first heading.
  assert.match(lessons[0]?.markdown ?? "", /^## Setup$/m);
  assert.match(lessons[0]?.markdown ?? "", /^```sql\nSELECT count\(\)\nFROM ducks;\n```$/m);
  // Each lesson reports its end once, and the private page is never read.
  assert.deepEqual(done, [1, 2, 3, 4, 5, 6]);
  assert.ok(!site.requests.some((request) => request.url.endsWith("/private")));
  assert.ok(!site.requests.some((request) => request.url.startsWith("http://internal.example")));
  const results = new Map(lines.map((line) => [line.url, line.result]));
  assert.equal(results.get("https://docs.example/docs/ducks/private"), "skipped_by_robots");
  assert.equal(results.get("https://docs.example/docs/ducks/second"), "loaded");
  // The log holds no page text.
  assert.ok(!JSON.stringify(lines).includes("SELECT"));
});

test("a lesson title is the short link text, else the page title, else the cut link text", () => {
  const card = "Explore quickstartsExplore quickstart guides to get up and running with ClickHouseNext";
  assert.ok(card.length > MAX_LINK_TITLE_LENGTH);
  assert.equal(lessonTitle("  First \n steps ", "Page title"), "First steps");
  assert.equal(lessonTitle("x".repeat(MAX_LINK_TITLE_LENGTH), "Page title"), "x".repeat(MAX_LINK_TITLE_LENGTH));
  assert.equal(lessonTitle(card, "Quickstarts"), "Quickstarts");
  assert.equal(lessonTitle(card, null), card.slice(0, MAX_LINK_TITLE_LENGTH));
  assert.equal(lessonTitle(" ", "Page title"), "Page title");
  assert.equal(lessonTitle("", null), null);
});

test("a card link gets the page title when its page loads, and the cut link text when its page fails", async () => {
  const card = `Explore the first steps ${"of the duck course ".repeat(5)}Next`;
  const site = fakeSite({
    "https://docs.example/robots.txt": ROBOTS_ALLOW,
    "https://docs.example/docs/ducks/first-steps": { body: LESSON_HTML },
  });
  const lessons = await readLessons(
    [
      { url: "https://docs.example/docs/ducks/first-steps", text: card },
      { url: "https://docs.example/docs/ducks/missing", text: card },
    ],
    options(site.fetchPage).crawl,
  );
  assert.deepEqual(
    lessons.map((lesson) => [lesson.status, lesson.title]),
    [
      // The title that Readability finds in the fixture.
      ["loaded", "First steps | Fixture Docs"],
      ["failed", card.slice(0, MAX_LINK_TITLE_LENGTH)],
    ],
  );
});

test("a UTF-8 page with no charset meta tag keeps its non-ASCII characters", async () => {
  const body =
    "<!doctype html><html><head><title>Ducks</title></head><body><article><h1>Ducks</h1>" +
    "<p>ClickHouse® reads “quoted” text, and the duck says żółw.</p>" +
    "<p>A second paragraph gives Readability enough text to keep the article as the main content.</p>" +
    "</article></body></html>";
  const site = fakeSite({
    "https://docs.example/robots.txt": ROBOTS_ALLOW,
    "https://docs.example/docs/ducks/utf8": { body },
  });
  const [lesson] = await readLessons([{ url: "https://docs.example/docs/ducks/utf8", text: "UTF-8" }], {
    ...options(site.fetchPage).crawl,
  });
  assert.equal(lesson.status, "loaded");
  assert.match(lesson.markdown ?? "", /ClickHouse® reads “quoted” text, and the duck says żółw\./);
});

test("an aborted signal stops the crawl before it reads a page", async () => {
  const site = fakeSite({ "https://docs.example/robots.txt": ROBOTS_ALLOW });
  const controller = new AbortController();
  controller.abort(new Error("The job stops."));
  await assert.rejects(
    readLessons([{ url: "https://docs.example/docs/ducks/first-steps", text: "First steps" }], {
      signal: controller.signal,
      log: () => undefined,
      fetch: site.fetchPage,
      lookup: fakeLookup(),
    }),
    /The job stops/,
  );
  assert.deepEqual(site.requests, []);
});
