// The polite crawl of an open course site with Crawlee: first the start page, then the lesson pages.
// The crawl respects robots.txt, reads at most 2 pages at a time, and says honestly what it is (see http.ts).
// It never passes a bot check by deception. A site that blocks the bot gets the extension hint.
//
// The crawl uses HttpCrawler and builds the DOM of each page with jsdom itself. JSDOMCrawler would also load the
// stylesheets and frames of a page, with a browser user agent, outside the robots.txt check.

import {
  Configuration,
  HttpCrawler,
  log as crawleeLog,
  LogLevel,
  type HttpCrawlerOptions,
  type HttpCrawlingContext,
} from "@crawlee/http";
import { RobotsTxtFile } from "@crawlee/utils";
import { JSDOM } from "jsdom";
import type { LessonRow } from "../queue.ts";
import { AddressNotAllowedError, createHttpClient, ROBOTS_AGENT, type HttpClientOptions } from "./http.ts";
import { cleanText, pageToMarkdown } from "./markdown.ts";

// Crawlee writes text logs, and an error text can hold a part of a page. The worker writes its own JSON lines.
crawleeLog.setLevel(LogLevel.OFF);

export const BLOCKED_REASON = "This site does not allow automated reads. Use the browser extension.";
export const NOT_READ_REASON = "The page was not read.";
export const READ_FAILED_REASON = "The page could not be read.";
export const NOT_HTML_REASON = "The page is not an HTML page.";
export const EMPTY_REASON = "The page has no readable text.";
export const TOO_LARGE_REASON = "The page text is larger than 1 MB.";
export const ROBOTS_REASON = "robots.txt does not allow this page.";
export const ROBOTS_NO_ANSWER_REASON = "robots.txt did not answer.";
export const ADDRESS_REASON = "The address of this page is not allowed.";

// The size limit of the markdown column of the lessons table.
export const MAX_MARKDOWN_BYTES = 1_048_576;
// The start page plus 200 lessons.
export const MAX_REQUESTS = 201;
// The most links that the worker reads from a start page.
export const MAX_LINKS = 1_000;
const MAX_LINK_TEXT = 200;
// The longest link text that becomes a lesson title. A longer text is often a card with a title, a summary and a
// button text, for example "Explore quickstartsExplore quickstart guides to get up and running with ClickHouseNext".
export const MAX_LINK_TITLE_LENGTH = 80;
const PAGE_TIMEOUT_SECS = 20;
// A site answers with these codes when it does not want the bot.
const BLOCKED_STATUS = new Set([401, 403, 429]);
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
// robots.txt rules for a site whose robots.txt cannot be read (RFC 9309: an unreachable file disallows all).
const DISALLOW_ALL = "User-agent: *\nDisallow: /\n";
// A 5xx answer of robots.txt is an outage, not a rule of the site.
const ROBOTS_SERVER_ERROR = 500;

export interface Link {
  url: string;
  text: string;
}

// A link as the page has it: the href attribute and the text.
export interface Anchor {
  href: string | null;
  text: string | null;
}

export interface StartPage {
  // The URL after redirects.
  url: string;
  title: string | null;
  links: Link[];
}

export type StartResult =
  | { kind: "page"; page: StartPage }
  // The site answers 401, 403 or 429, or robots.txt disallows the start page.
  | { kind: "blocked"; status?: number }
  // The host or a redirect has an address that the crawl must not read.
  | { kind: "rejected" }
  // No status: no answer, for example a network error, a timeout, or no answer from robots.txt.
  | { kind: "failed"; status?: number };

export type Lesson = LessonRow;

// One log line for each page. A line never holds the page text.
export interface PageLog {
  event: "page";
  url: string;
  result: "loaded" | "failed" | "blocked" | "skipped_by_robots";
  status?: number;
  reason?: string;
}

// The fetch, the DNS lookup and the address setting of the HTTP client (see http.ts).
export interface CrawlOptions extends HttpClientOptions {
  signal: AbortSignal;
  log: (line: PageLog) => void;
}

export interface LessonOptions extends CrawlOptions {
  // Called after each lesson page, with the number of pages done so far.
  onPage?: (done: number) => Promise<void>;
}

// The URL without the fragment and without a trailing slash, the same form as the extension sends.
// Two links with the same key show the same page, and a lesson keeps the same URL from the crawl and from the extension.
function pageKey(url: URL): string {
  const copy = new URL(url);
  copy.hash = "";
  return copy.href.replace(/\/+$/, "");
}

// Make each link absolute, keep only http and https links to the same site, remove the fragment, the trailing slash
// and the duplicates. The order stays the page order. A link to the page itself goes.
export function normalizeLinks(anchors: readonly Anchor[], pageUrl: string): Link[] {
  const page = new URL(pageUrl);
  const seen = new Set([pageKey(page)]);
  const links: Link[] = [];
  for (const anchor of anchors) {
    if (!anchor.href) continue;
    let url: URL;
    try {
      url = new URL(anchor.href, page);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.origin !== page.origin) continue;
    const key = pageKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ url: key, text: cleanText(anchor.text, MAX_LINK_TEXT) ?? "" });
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

// The title of a lesson. The link text comes first when it has 1 to MAX_LINK_TITLE_LENGTH characters.
// Else the title that Readability finds, else the link text cut to MAX_LINK_TITLE_LENGTH characters.
export function lessonTitle(linkText: string, pageTitle: string | null): string | null {
  const text = cleanText(linkText);
  if (text && text.length <= MAX_LINK_TITLE_LENGTH) return text;
  return pageTitle ?? cleanText(linkText, MAX_LINK_TITLE_LENGTH);
}

// Read the title and the links of a start page.
export function readStartDocument(document: Document, pageUrl: string): StartPage {
  const title = cleanText(document.querySelector("h1")?.textContent) ?? cleanText(document.title);
  const anchors = Array.from(document.querySelectorAll("a[href]"), (anchor) => ({
    href: anchor.getAttribute("href"),
    text: anchor.textContent,
  }));
  return { url: pageUrl, title, links: normalizeLinks(anchors, pageUrl) };
}

// The robots.txt of a site. no_answer: a network error, a timeout or a 5xx answer. rejected: a private address.
export type RobotsResult = { kind: "file"; file: RobotsTxtFile } | { kind: "no_answer" } | { kind: "rejected" };

// Read robots.txt with the honest client. A 2xx answer gives the rules. A 4xx answer allows all.
export async function loadRobotsTxt(pageUrl: string, http: HttpClientOptions = {}): Promise<RobotsResult> {
  const url = new URL("/robots.txt", pageUrl).toString();
  try {
    const response = await createHttpClient(http).sendRequest({
      url,
      timeout: { request: PAGE_TIMEOUT_SECS * 1_000 },
    });
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return { kind: "file", file: RobotsTxtFile.from(url, response.body) };
    }
    if (response.statusCode >= 400 && response.statusCode < ROBOTS_SERVER_ERROR) {
      return { kind: "file", file: RobotsTxtFile.from(url, "") };
    }
  } catch (error) {
    if (error instanceof AddressNotAllowedError) return { kind: "rejected" };
  }
  return { kind: "no_answer" };
}

// Crawlee reads robots.txt with its default client, which sends browser-like headers. This crawler reads it with the
// honest client instead. Crawlee still decides with respectRobotsTxtFile which page it may read.
// A robots.txt that does not answer, or that has a private address, disallows the whole site (RFC 9309).
// The crawler keeps the cause, so a skipped page gets the true reason, not "blocked".
class CourseCrawler extends HttpCrawler<HttpCrawlingContext> {
  readonly robotsFiles = new Map<string, Promise<RobotsTxtFile>>();
  readonly robotsProblems = new Map<string, "no_answer" | "rejected">();
  http: HttpClientOptions = {};

  protected override getRobotsTxtFileForUrl(url: string): Promise<RobotsTxtFile | undefined> {
    const origin = new URL(url).origin;
    let file = this.robotsFiles.get(origin);
    if (!file) {
      file = loadRobotsTxt(url, this.http).then((robots) => {
        if (robots.kind === "file") return robots.file;
        this.robotsProblems.set(origin, robots.kind);
        return RobotsTxtFile.from(new URL("/robots.txt", url).toString(), DISALLOW_ALL);
      });
      this.robotsFiles.set(origin, file);
    }
    return file;
  }

  // The cause of a robots.txt skip: no_answer, rejected, or undefined when the rules of the site disallow the page.
  robotsProblem(url: string): "no_answer" | "rejected" | undefined {
    return this.robotsProblems.get(new URL(url).origin);
  }
}

type CrawlerHandlers = Pick<
  HttpCrawlerOptions<HttpCrawlingContext>,
  "requestHandler" | "failedRequestHandler" | "onSkippedRequest"
>;

// The options of the HTTP client from the crawl options.
function httpOptions(options: CrawlOptions): HttpClientOptions {
  return { fetch: options.fetch, lookup: options.lookup, allowPrivateAddresses: options.allowPrivateAddresses };
}

function createCrawler(options: CrawlOptions, handlers: CrawlerHandlers): CourseCrawler {
  const http = httpOptions(options);
  const crawler = new CourseCrawler(
    {
      ...handlers,
      httpClient: createHttpClient(http),
      respectRobotsTxtFile: { userAgent: ROBOTS_AGENT },
      maxConcurrency: 2,
      maxRequestsPerCrawl: MAX_REQUESTS,
      navigationTimeoutSecs: PAGE_TIMEOUT_SECS,
      requestHandlerTimeoutSecs: PAGE_TIMEOUT_SECS + 10,
      // One more try after a server error or a timeout.
      maxRequestRetries: 1,
      // Sessions rotate cookies and identities against bot checks. The crawl does not need them.
      useSessionPool: false,
      persistCookiesPerSession: false,
      ignoreSslErrors: false,
      // The handlers read each answer, so a blocked page with any content type reaches them.
      additionalMimeTypes: ["*/*"],
    },
    // Each crawl has its own storage in memory. Nothing goes to the disk.
    new Configuration({ persistStorage: false }),
  );
  crawler.http = http;
  return crawler;
}

// Run the crawler until it ends or the signal aborts. After an abort the crawler takes no new page.
async function runCrawler(crawler: CourseCrawler, requests: { url: string; uniqueKey: string }[], signal: AbortSignal) {
  signal.throwIfAborted();
  const stop = (): void => {
    crawler.stop("The job stops.");
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    await crawler.run(requests);
  } finally {
    signal.removeEventListener("abort", stop);
  }
  signal.throwIfAborted();
}

function isHtml(context: HttpCrawlingContext): boolean {
  return HTML_TYPES.has(context.contentType.type);
}

// The status code of the answer. 0 when the answer has none.
function statusOf(context: HttpCrawlingContext): number {
  return context.response.statusCode ?? 0;
}

// True for an answer that is not a 2xx or 3xx answer.
function isErrorStatus(status: number): boolean {
  return status < 200 || status >= 400;
}

function pageUrl(context: HttpCrawlingContext): string {
  return context.request.loadedUrl ?? context.request.url;
}

// The DOM of the page. The body comes as bytes, so jsdom gets the charset of the answer.
// Without it, jsdom reads a page with no charset meta tag as windows-1252 and breaks each non-ASCII character.
function pageDom(context: HttpCrawlingContext): JSDOM {
  const contentType = `text/html; charset=${context.contentType.encoding}`;
  return new JSDOM(context.body, { url: pageUrl(context), contentType });
}

// Read the start page: its title and its links.
export async function readStartPage(url: string, options: CrawlOptions): Promise<StartResult> {
  const { log } = options;
  const state: { result: StartResult } = { result: { kind: "failed" } };

  const crawler: CourseCrawler = createCrawler(options, {
    requestHandler: (context) => {
      const status = statusOf(context);
      if (BLOCKED_STATUS.has(status)) {
        state.result = { kind: "blocked", status };
        log({ event: "page", url, result: "blocked", status });
        return;
      }
      if (isErrorStatus(status) || !isHtml(context)) {
        state.result = { kind: "failed", status };
        const reason = isErrorStatus(status) ? READ_FAILED_REASON : NOT_HTML_REASON;
        log({ event: "page", url, result: "failed", status, reason });
        return;
      }
      const loadedUrl = pageUrl(context);
      const { window } = pageDom(context);
      try {
        state.result = { kind: "page", page: readStartDocument(window.document, loadedUrl) };
      } finally {
        window.close();
      }
      log({ event: "page", url, result: "loaded", status });
    },
    failedRequestHandler: (_context, error) => {
      if (error instanceof AddressNotAllowedError) {
        state.result = { kind: "rejected" };
        log({ event: "page", url, result: "failed", reason: ADDRESS_REASON });
        return;
      }
      state.result = { kind: "failed" };
      log({ event: "page", url, result: "failed", reason: READ_FAILED_REASON });
    },
    onSkippedRequest: ({ reason }) => {
      if (reason !== "robotsTxt") return;
      const problem = crawler.robotsProblem(url);
      if (problem === "rejected") {
        state.result = { kind: "rejected" };
        log({ event: "page", url, result: "failed", reason: ADDRESS_REASON });
      } else if (problem === "no_answer") {
        // An outage of robots.txt can end soon. The start page fails as a network error, so the job gets a new start.
        state.result = { kind: "failed" };
        log({ event: "page", url, result: "failed", reason: ROBOTS_NO_ANSWER_REASON });
      } else {
        state.result = { kind: "blocked" };
        log({ event: "page", url, result: "skipped_by_robots", reason: ROBOTS_REASON });
      }
    },
  });

  await runCrawler(crawler, [{ url, uniqueKey: url }], options.signal);
  return state.result;
}

// Convert one lesson page. The result is the Markdown, or the reason why the lesson failed.
function convertLesson(context: HttpCrawlingContext): { markdown: string; title: string | null } | { reason: string } {
  const status = statusOf(context);
  if (isErrorStatus(status)) {
    return { reason: status > 0 ? `The page answered with status ${status}.` : READ_FAILED_REASON };
  }
  if (!isHtml(context)) return { reason: NOT_HTML_REASON };
  const { window } = pageDom(context);
  try {
    const text = pageToMarkdown(window.document);
    if (!text) return { reason: EMPTY_REASON };
    if (Buffer.byteLength(text.markdown, "utf8") > MAX_MARKDOWN_BYTES) return { reason: TOO_LARGE_REASON };
    return text;
  } finally {
    window.close();
  }
}

// Read each lesson page and convert it to Markdown. A page that fails marks only its lesson failed.
// The lessons keep the order of the links: the first link is position 1.
export async function readLessons(links: readonly Link[], options: LessonOptions): Promise<Lesson[]> {
  const { log } = options;
  // A lesson that does not load keeps the title from its link text.
  const lessons: Lesson[] = links.map((link, index) => ({
    position: index + 1,
    title: lessonTitle(link.text, null),
    url: link.url,
    markdown: null,
    status: "failed",
    error: NOT_READ_REASON,
  }));
  const byUrl = new Map(lessons.map((lesson) => [lesson.url, lesson]));
  const linkText = new Map(links.map((link) => [link.url, link.text]));
  let done = 0;

  // Record the end of one page and report the progress. A failed report does not stop the crawl.
  // When the job must stop, the signal stops the crawler.
  async function finish(lesson: Lesson, line: Omit<PageLog, "event" | "url">): Promise<void> {
    done += 1;
    log({ event: "page", url: lesson.url, ...line });
    try {
      await options.onPage?.(done);
    } catch {
      // The signal handles a stop.
    }
  }

  async function fail(lesson: Lesson, reason: string, result: PageLog["result"], status?: number): Promise<void> {
    lesson.status = "failed";
    lesson.markdown = null;
    lesson.error = reason;
    await finish(lesson, { result, reason, status });
  }

  const crawler: CourseCrawler = createCrawler(options, {
    requestHandler: async (context) => {
      const lesson = byUrl.get(context.request.uniqueKey);
      if (!lesson) return;
      const status = statusOf(context);
      const page = convertLesson(context);
      if ("reason" in page) {
        await fail(lesson, page.reason, "failed", status);
        return;
      }
      lesson.status = "loaded";
      lesson.markdown = page.markdown;
      lesson.error = null;
      lesson.title = lessonTitle(linkText.get(lesson.url) ?? "", page.title);
      await finish(lesson, { result: "loaded", status });
    },
    failedRequestHandler: async ({ request }, error) => {
      const lesson = byUrl.get(request.uniqueKey);
      if (!lesson) return;
      await fail(lesson, error instanceof AddressNotAllowedError ? ADDRESS_REASON : READ_FAILED_REASON, "failed");
    },
    onSkippedRequest: async ({ url, reason }) => {
      const lesson = byUrl.get(url);
      if (!lesson) return;
      if (reason !== "robotsTxt") {
        await fail(lesson, NOT_READ_REASON, "failed");
        return;
      }
      const problem = crawler.robotsProblem(url);
      if (problem === "rejected") await fail(lesson, ADDRESS_REASON, "failed");
      else if (problem === "no_answer") await fail(lesson, ROBOTS_NO_ANSWER_REASON, "failed");
      else await fail(lesson, ROBOTS_REASON, "skipped_by_robots");
    },
  });

  await runCrawler(
    crawler,
    lessons.map((lesson) => ({ url: lesson.url, uniqueKey: lesson.url })),
    options.signal,
  );
  return lessons;
}
