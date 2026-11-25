// The HTTP client of the crawl. It reads a page with the fetch of Node and says honestly what it is.
// Crawlee's default client sends browser-like headers and a browser-like TLS handshake. This client does not:
// it sends only the user agent of the bot and a plain Accept header, and it checks TLS certificates.
//
// The client reads only public addresses. Before each request it resolves the host with DNS and refuses a private,
// loopback, link-local, shared, multicast, unspecified or metadata address. It follows each redirect itself, with the
// same check on each hop. A DNS answer can change between the check and the connect. The check does not close that gap.

import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  NonRetryableError,
  type BaseHttpClient,
  type HttpRequest,
  type HttpResponse,
  type ResponseTypes,
  type StreamingHttpResponse,
} from "@crawlee/http";

// The repo URL tells a site owner who sends the requests.
export const USER_AGENT = "RubberDuckBot/0.1 (+https://github.com/plancys/rubber-duck-on-steroids)";
// The product token that robots.txt rules name.
export const ROBOTS_AGENT = "RubberDuckBot";
// A larger page stops the download. The Markdown of a lesson is at most 1 MB, so 5 MB of HTML is enough.
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
// A longer redirect chain stops the request.
export const MAX_REDIRECTS = 10;

const ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1";
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export type Fetch = typeof fetch;
// Gives all addresses of a host name. The unit tests give a fake lookup, so they need no network.
export type Lookup = (hostname: string) => Promise<string[]>;

export interface HttpClientOptions {
  // The fetch of Node. The unit tests give a fake fetch.
  fetch?: Fetch;
  // The DNS lookup of Node. The unit tests give a fake lookup.
  lookup?: Lookup;
  // True only for a local run and CI, where the course site is on localhost. Production never sets it.
  allowPrivateAddresses?: boolean;
}

// The crawl must not read this address. The error is final, so Crawlee does not send the request again.
export class AddressNotAllowedError extends NonRetryableError {
  constructor(url: string) {
    super(`The address of ${url} is not allowed.`);
    this.name = "AddressNotAllowedError";
  }
}

// The address ranges that the crawl never reads.
const BLOCKED_ADDRESSES = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "this network" and the unspecified address
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // shared address space (CGNAT)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, with the metadata address 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.168.0.0", 16], // private
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96], // the unspecified address, loopback and the old IPv4-compatible form
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // the old site-local range
  ["ff00::", 8], // multicast
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

/** True when the crawl can read this IP address. The IPv4 rules also cover an IPv4-mapped IPv6 address. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !BLOCKED_ADDRESSES.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function systemLookup(hostname: string): Promise<string[]> {
  const answers = await dnsLookup(hostname, { all: true, order: "verbatim" });
  return answers.map((answer) => answer.address);
}

// Refuse a URL that is not http or https, or a host with a private address. Each address of the host must be public.
async function checkAddress(url: URL, options: HttpClientOptions): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AddressNotAllowedError(url.toString());
  if (options.allowPrivateAddresses) return;
  // The URL parser gives an IPv6 address in brackets.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  const addresses = isIP(host) ? [host] : await (options.lookup ?? systemLookup)(host);
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw new AddressNotAllowedError(url.toString());
}

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

function tooLarge(limit: number): Error {
  return new Error(`The page is larger than ${limit} bytes.`);
}

// Stop the stream when the page is larger than the limit.
function limitSize(limit: number): Transform {
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > limit) {
        callback(tooLarge(limit));
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

// Read the whole body, but stop at the limit. A larger body costs no more memory than the limit.
async function readBody(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// The answer of the last hop, with its URL and the URL of each redirect.
interface Sent {
  response: Response;
  url: string;
  redirectUrls: URL[];
}

async function send(options: HttpClientOptions, request: HttpRequest<keyof ResponseTypes>): Promise<Sent> {
  const method = (request.method ?? "GET").toUpperCase();
  // The crawl only reads pages. A request with a body is a mistake in the crawl code.
  if (method !== "GET" && method !== "HEAD") throw new Error(`The crawl does not send ${method} requests.`);
  const fetchPage = options.fetch ?? fetch;
  const signal = requestSignal(request);
  const redirectUrls: URL[] = [];
  let url = new URL(String(request.url));

  for (;;) {
    await checkAddress(url, options);
    const response = await fetchPage(url.toString(), {
      method,
      headers: requestHeaders(request),
      redirect: "manual",
      signal,
    });
    const location = REDIRECT_STATUS.has(response.status) ? response.headers.get("location") : null;
    if (location === null) return { response, url: url.toString(), redirectUrls };

    await response.body?.cancel();
    if (redirectUrls.length >= MAX_REDIRECTS) throw new Error(`The page has more than ${MAX_REDIRECTS} redirects.`);
    url = new URL(location, url);
    redirectUrls.push(url);
  }
}

// The response fields that Crawlee reads. url is the URL of the last hop.
function responseData({ response, url, redirectUrls }: Sent) {
  return {
    url,
    redirectUrls,
    statusCode: response.status,
    statusMessage: response.statusText,
    headers: responseHeaders(response),
    trailers: {},
    complete: true,
  };
}

export function createHttpClient(options: HttpClientOptions = {}): BaseHttpClient {
  return {
    async sendRequest<TResponseType extends keyof ResponseTypes = "text">(
      request: HttpRequest<TResponseType>,
    ): Promise<HttpResponse<TResponseType>> {
      const sent = await send(options, request);
      const buffer = await readBody(sent.response, MAX_PAGE_BYTES);
      const text = buffer.toString(request.encoding ?? "utf8");
      const bodies: ResponseTypes = { text, buffer, json: undefined };
      if (request.responseType === "json") bodies.json = JSON.parse(text) as unknown;
      const body = bodies[request.responseType ?? "text"] as ResponseTypes[TResponseType];
      return { ...responseData(sent), request, body };
    },

    async stream(request: HttpRequest): Promise<StreamingHttpResponse> {
      const sent = await send(options, request);
      return {
        ...responseData(sent),
        request,
        stream: bodyStream(sent.response),
        downloadProgress: { percent: 0, transferred: 0 },
        uploadProgress: { percent: 0, transferred: 0 },
      };
    },
  };
}
