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
import { createHttpClient, ROBOTS_AGENT, type Fetch } from "./http.ts";
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

export interface CrawlOptions {
  signal: AbortSignal;
  log: (line: PageLog) => void;
  // The fetch of Node. The unit tests give a fake fetch.
  fetch?: Fetch;
}

export interface LessonOptions extends CrawlOptions {
  // Called after each lesson page, with the number of pages done so far.
  onPage?: (done: number) => Promise<void>;
}

// The URL without the fragment and without a trailing slash of the path. Two links with the same key show the same page.
function pageKey(url: URL): string {
  const copy = new URL(url);
  copy.hash = "";
  if (copy.pathname.length > 1) copy.pathname = copy.pathname.replace(/\/+$/, "");
  return copy.toString();
}

// Make each link absolute, keep only http and https links to the same site, remove the fragment and the duplicates.
// The order stays the page order. A link to the page itself goes.
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
    url.hash = "";
    const key = pageKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ url: url.toString(), text: cleanText(anchor.text, MAX_LINK_TEXT) ?? "" });
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

// Read robots.txt with the honest client. A 4xx answer allows all. A 5xx answer or no answer disallows all.
export async function loadRobotsTxt(pageUrl: string, fetchPage?: Fetch): Promise<RobotsTxtFile> {
  const url = new URL("/robots.txt", pageUrl).toString();
  try {
    const response = await createHttpClient(fetchPage).sendRequest({
      url,
      timeout: { request: PAGE_TIMEOUT_SECS * 1_000 },
    });
    if (response.statusCode >= 200 && response.statusCode < 300) return RobotsTxtFile.from(url, response.body);
    if (response.statusCode >= 400 && response.statusCode < 500) return RobotsTxtFile.from(url, "");
  } catch {
    // No answer. The crawl reads nothing from the site.
  }
  return RobotsTxtFile.from(url, DISALLOW_ALL);
}

// Crawlee reads robots.txt with its default client, which sends browser-like headers. This crawler reads it with the
// honest client instead. Crawlee still decides with respectRobotsTxtFile which page it may read.
class CourseCrawler extends HttpCrawler<HttpCrawlingContext> {
  readonly robotsFiles = new Map<string, Promise<RobotsTxtFile>>();
  fetchPage: Fetch | undefined;

  protected override getRobotsTxtFileForUrl(url: string): Promise<RobotsTxtFile | undefined> {
    const origin = new URL(url).origin;
    let file = this.robotsFiles.get(origin);
    if (!file) {
      file = loadRobotsTxt(url, this.fetchPage);
      this.robotsFiles.set(origin, file);
    }
    return file;
  }
}

type CrawlerHandlers = Pick<
  HttpCrawlerOptions<HttpCrawlingContext>,
  "requestHandler" | "failedRequestHandler" | "onSkippedRequest"
>;

function createCrawler(fetchPage: Fetch | undefined, handlers: CrawlerHandlers): CourseCrawler {
  const crawler = new CourseCrawler(
    {
      ...handlers,
      httpClient: createHttpClient(fetchPage),
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
  crawler.fetchPage = fetchPage;
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

  const crawler = createCrawler(options.fetch, {
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
    failedRequestHandler: () => {
      state.result = { kind: "failed" };
      log({ event: "page", url, result: "failed", reason: READ_FAILED_REASON });
    },
    onSkippedRequest: ({ reason }) => {
      if (reason !== "robotsTxt") return;
      state.result = { kind: "blocked" };
      log({ event: "page", url, result: "skipped_by_robots", reason: ROBOTS_REASON });
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

  const crawler = createCrawler(options.fetch, {
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
    failedRequestHandler: async ({ request }) => {
      const lesson = byUrl.get(request.uniqueKey);
      if (lesson) await fail(lesson, READ_FAILED_REASON, "failed");
    },
    onSkippedRequest: async ({ url, reason }) => {
      const lesson = byUrl.get(url);
      if (!lesson) return;
      if (reason === "robotsTxt") await fail(lesson, ROBOTS_REASON, "skipped_by_robots");
      else await fail(lesson, NOT_READ_REASON, "failed");
    },
  });

  await runCrawler(
    crawler,
    lessons.map((lesson) => ({ url: lesson.url, uniqueKey: lesson.url })),
    options.signal,
  );
  return lessons;
}
