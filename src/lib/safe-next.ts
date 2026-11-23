// Returns a same-site path plus query string for a `next` value, or null when the value is not safe.
export function safeNextPath(next: string | null, origin: string): string | null {
  if (!next?.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(next, origin);
  } catch {
    return null;
  }

  // The URL parser drops tabs and newlines, so check the origin after parsing.
  if (url.origin !== new URL(origin).origin) {
    return null;
  }

  const path = url.pathname + url.search;
  // Dot segments can turn "/.//host" into "//host", so check the result too.
  if (path.startsWith("//") || path.startsWith("/\\")) {
    return null;
  }

  return path;
}
