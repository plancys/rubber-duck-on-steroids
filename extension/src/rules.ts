// The rules that decide which pages the extension saves. They are pure, so the unit tests run them without a browser.

/** The product accepts a request body of at most 1 MB. A larger page does not go to the product. */
export const MAX_BODY_BYTES = 1048576;

/** The site and the path of a running course. Only a page on the same site and under the start path is a lesson. */
export interface CourseScope {
  // The origin of the start page, for example "https://learn.example.com".
  origin: string;
  // The path of the start page without a trailing slash. An empty text means the whole site.
  startPath: string;
  // The start page in the form of pageKey.
  startUrl: string;
}

/**
 * Gives the form of a page URL that the extension compares and sends: http or https only, no fragment,
 * no trailing slash. The product stores a course URL in the same form. Returns null for any other URL.
 */
export function pageKey(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  url.hash = "";
  let href = url.href;
  while (href.endsWith("/")) href = href.slice(0, -1);
  return href;
}

/** Gives the scope of a course that starts on this page, or null when the page cannot start a course. */
export function courseScope(startUrl: string): CourseScope | null {
  const key = pageKey(startUrl);
  if (key === null) return null;
  const url = new URL(key);
  let startPath = url.pathname;
  while (startPath.endsWith("/")) startPath = startPath.slice(0, -1);
  return { origin: url.origin, startPath, startUrl: key };
}

/**
 * True when the page belongs to the course: the same site as the start page, and a path that is the start path
 * or under it. The start page itself is the course page, not a lesson.
 */
export function isCoursePage(scope: CourseScope, pageUrl: string): boolean {
  const key = pageKey(pageUrl);
  if (key === null || key === scope.startUrl) return false;
  const url = new URL(key);
  if (url.origin !== scope.origin) return false;
  if (scope.startPath === "") return true;
  return url.pathname === scope.startPath || url.pathname.startsWith(`${scope.startPath}/`);
}

/** True when the course has not saved this page yet. The extension saves a page once for each URL. */
export function isNewPage(savedUrls: readonly string[], pageUrl: string): boolean {
  const key = pageKey(pageUrl);
  return key !== null && !savedUrls.includes(key);
}

/** The size of a text in bytes as UTF-8. The product counts the body and the Markdown in bytes. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
