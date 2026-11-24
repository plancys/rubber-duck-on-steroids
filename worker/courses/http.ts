// The HTTP client of the crawl. It reads a page with the fetch of Node and says honestly what it is.
// Crawlee's default client sends browser-like headers and a browser-like TLS handshake. This client does not:
// it sends only the user agent of the bot and a plain Accept header, and it checks TLS certificates.

import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { BaseHttpClient, HttpRequest, HttpResponse, ResponseTypes, StreamingHttpResponse } from "@crawlee/http";

// The repo URL tells a site owner who sends the requests.
export const USER_AGENT = "RubberDuckBot/0.1 (+https://github.com/plancys/rubber-duck-on-steroids)";
// The product token that robots.txt rules name.
export const ROBOTS_AGENT = "RubberDuckBot";
// A larger page stops the download. The Markdown of a lesson is at most 1 MB, so 5 MB of HTML is enough.
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;

const ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1";

export type Fetch = typeof fetch;

// The headers of each request: the request headers of Crawlee, then the bot user agent and the Accept header.
function requestHeaders(request: HttpRequest<keyof ResponseTypes>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  headers.set("user-agent", USER_AGENT);
  headers.set("accept", ACCEPT);
  return headers;
}

// The signal of one request: the signal of the caller and the request timeout of Crawlee.
function requestSignal(request: HttpRequest<keyof ResponseTypes>): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (request.signal) signals.push(request.signal);
  const timeout = request.timeout;
  if (timeout && "request" in timeout && typeof timeout.request === "number") {
    signals.push(AbortSignal.timeout(timeout.request));
  }
  return signals.length > 0 ? AbortSignal.any(signals) : undefined;
}

function responseHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.entries());
}

// Stop the stream when the page is larger than the limit.
function limitSize(limit: number): Transform {
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > limit) {
        callback(new Error(`The page is larger than ${limit} bytes.`));
        return;
      }
      callback(null, chunk);
    },
  });
}

function bodyStream(response: Response): Readable {
  if (!response.body) return Readable.from([]);
  // The web stream types of the DOM library and of Node differ only in name.
  const web = response.body as unknown as NodeReadableStream<Uint8Array>;
  return Readable.fromWeb(web).pipe(limitSize(MAX_PAGE_BYTES));
}

async function send(fetchPage: Fetch, request: HttpRequest<keyof ResponseTypes>): Promise<Response> {
  const method = (request.method ?? "GET").toUpperCase();
  // The crawl only reads pages. A request with a body is a mistake in the crawl code.
  if (method !== "GET" && method !== "HEAD") throw new Error(`The crawl does not send ${method} requests.`);
  return fetchPage(String(request.url), {
    method,
    headers: requestHeaders(request),
    redirect: "follow",
    signal: requestSignal(request),
  });
}

// The response fields that Crawlee reads. requestUrl is the URL when the response has none.
function responseData(response: Response, requestUrl: string) {
  const url = response.url || requestUrl;
  return {
    url,
    redirectUrls: response.redirected ? [new URL(url)] : [],
    statusCode: response.status,
    statusMessage: response.statusText,
    headers: responseHeaders(response),
    trailers: {},
    complete: true,
  };
}

// fetchPage is the fetch of Node. The unit tests give a fake fetch, so they need no network.
export function createHttpClient(fetchPage: Fetch = fetch): BaseHttpClient {
  return {
    async sendRequest<TResponseType extends keyof ResponseTypes = "text">(
      request: HttpRequest<TResponseType>,
    ): Promise<HttpResponse<TResponseType>> {
      const response = await send(fetchPage, request);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_PAGE_BYTES) throw new Error(`The page is larger than ${MAX_PAGE_BYTES} bytes.`);
      const text = buffer.toString(request.encoding ?? "utf8");
      const bodies: ResponseTypes = { text, buffer, json: undefined };
      if (request.responseType === "json") bodies.json = JSON.parse(text) as unknown;
      const body = bodies[request.responseType ?? "text"] as ResponseTypes[TResponseType];
      return { ...responseData(response, String(request.url)), request, body };
    },

    async stream(request: HttpRequest): Promise<StreamingHttpResponse> {
      const response = await send(fetchPage, request);
      return {
        ...responseData(response, String(request.url)),
        request,
        stream: bodyStream(response),
        downloadProgress: { percent: 0, transferred: 0 },
        uploadProgress: { percent: 0, transferred: 0 },
      };
    },
  };
}
