// Fixture server: serves the small course site in scripts/fixtures/course, so CI can load a course without the internet.
// Zero dependencies on purpose. Run it with: node scripts/fixture-server.mjs
// The start page of the course is http://localhost:8799/duck-basics. FIXTURE_PORT overrides the port.
// The site allows automated reads, except the path that its robots.txt disallows.
// The server logs one line for each request with the status and the user agent, so the CI log shows the crawl.

import { Buffer } from "node:buffer";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { URL } from "node:url";

const PORT = Number(process.env.FIXTURE_PORT ?? 8799);
const ROOT = resolve(import.meta.dirname, "fixtures", "course");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

// Returns the file for a URL path, or null when the path leaves the site folder or names no file.
// A folder gives its index.html, with or without a trailing slash.
async function fileFor(pathname) {
  let path;
  try {
    path = resolve(ROOT, `.${decodeURIComponent(pathname)}`);
  } catch {
    return null;
  }
  if (path !== ROOT && !path.startsWith(ROOT + sep)) return null;
  try {
    const info = await stat(path);
    if (info.isDirectory()) path = join(path, "index.html");
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

function send(response, status, type, body) {
  response.writeHead(status, { "Content-Type": type, "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  let status = 200;
  if (request.method !== "GET" && request.method !== "HEAD") {
    status = 405;
    send(response, status, TYPES[".txt"], "Method not allowed\n");
  } else {
    const file = await fileFor(pathname);
    if (file) {
      send(response, status, TYPES[extname(file)] ?? "application/octet-stream", await readFile(file));
    } else {
      // The 404 page is HTML, as on a real site. The crawl marks the lesson failed.
      status = 404;
      send(response, status, TYPES[".html"], "<!doctype html><title>Not found</title><h1>Not found</h1>\n");
    }
  }
  console.log(`${request.method} ${pathname} ${status} ${request.headers["user-agent"] ?? "-"}`);
});

// No host: the server listens on all addresses, IPv4 and IPv6, so "localhost" works with both.
server.listen(PORT, () => {
  console.log(`The fixture course site runs at http://localhost:${PORT}/duck-basics`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
