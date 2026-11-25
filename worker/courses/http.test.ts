import assert from "node:assert/strict";
import { test } from "node:test";
import { AddressNotAllowedError, createHttpClient, isPublicAddress, MAX_PAGE_BYTES, type Fetch } from "./http.ts";

test("an address in a private, loopback, link-local, shared, multicast or unspecified range is not public", () => {
  const blocked = [
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd00:ec2::254",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe",
    "::ffff:10.0.0.1",
    "not an address",
  ];
  for (const address of blocked) assert.equal(isPublicAddress(address), false, address);
  for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
});

// A fake fetch that answers from a table and records each URL. A URL that is not in the table answers 404.
function fakeFetch(pages: Record<string, { status?: number; location?: string; body?: BodyInit }>) {
  const requested: string[] = [];
  const fetchPage: Fetch = (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    requested.push(url);
    assert.equal(init?.redirect, "manual");
    const page = pages[url] ?? { status: 404 };
    const headers: Record<string, string> = { "content-type": "text/html" };
    if (page.location) headers.location = page.location;
    return Promise.resolve(new Response(page.body ?? "", { status: page.status ?? 200, headers }));
  };
  return { fetchPage, requested };
}

// A fake DNS lookup that records each host. A host in privateHosts has a private address.
function fakeLookup(privateHosts: readonly string[] = []) {
  const hosts: string[] = [];
  const lookup = (hostname: string) => {
    hosts.push(hostname);
    return Promise.resolve(privateHosts.includes(hostname) ? ["10.0.0.5"] : ["93.184.216.34"]);
  };
  return { lookup, hosts };
}

test("a host with a private address is refused before the request", async () => {
  const site = fakeFetch({ "https://course.example/": { body: "secret" } });
  const dns = fakeLookup(["course.example"]);
  const client = createHttpClient({ fetch: site.fetchPage, lookup: dns.lookup });
  await assert.rejects(client.sendRequest({ url: "https://course.example/" }), AddressNotAllowedError);
  await assert.rejects(client.stream({ url: "https://course.example/" }), AddressNotAllowedError);
  assert.deepEqual(site.requested, []);
  assert.deepEqual(dns.hosts, ["course.example", "course.example"]);
});

test("a literal private address is refused without a DNS lookup", async () => {
  const site = fakeFetch({});
  const dns = fakeLookup();
  const client = createHttpClient({ fetch: site.fetchPage, lookup: dns.lookup });
  for (const url of [
    "http://127.0.0.1/",
    "http://169.254.169.254/latest",
    "http://[::1]/",
    "http://[::ffff:7f00:1]/",
  ]) {
    await assert.rejects(client.sendRequest({ url }), AddressNotAllowedError, url);
  }
  assert.deepEqual(site.requested, []);
  assert.deepEqual(dns.hosts, []);
});

test("each redirect hop gets the address check", async () => {
  const site = fakeFetch({
    "https://course.example/start": { status: 302, location: "http://metadata.example/computeMetadata" },
  });
  const client = createHttpClient({ fetch: site.fetchPage, lookup: fakeLookup(["metadata.example"]).lookup });
  await assert.rejects(client.sendRequest({ url: "https://course.example/start" }), AddressNotAllowedError);
  assert.deepEqual(site.requested, ["https://course.example/start"]);
});

test("a redirect to a public address gives the final URL and each redirect URL", async () => {
  const site = fakeFetch({
    "https://course.example/a": { status: 301, location: "/b" },
    "https://course.example/b": { status: 307, location: "https://www.course.example/c" },
    "https://www.course.example/c": { body: "<h1>Course</h1>" },
  });
  const client = createHttpClient({ fetch: site.fetchPage, lookup: fakeLookup().lookup });
  const response = await client.sendRequest({ url: "https://course.example/a" });
  assert.equal(response.url, "https://www.course.example/c");
  assert.deepEqual(
    response.redirectUrls.map((url) => url.toString()),
    ["https://course.example/b", "https://www.course.example/c"],
  );
  assert.equal(response.body, "<h1>Course</h1>");
});

test("a redirect loop stops after the redirect limit", async () => {
  const site = fakeFetch({ "https://course.example/loop": { status: 302, location: "/loop" } });
  const client = createHttpClient({ fetch: site.fetchPage, lookup: fakeLookup().lookup });
  await assert.rejects(client.sendRequest({ url: "https://course.example/loop" }), /redirects/);
});

test("allowPrivateAddresses turns the address check off", async () => {
  const site = fakeFetch({ "http://localhost:8799/course": { body: "ok" } });
  const dns = fakeLookup(["localhost"]);
  const client = createHttpClient({ fetch: site.fetchPage, lookup: dns.lookup, allowPrivateAddresses: true });
  const response = await client.sendRequest({ url: "http://localhost:8799/course" });
  assert.equal(response.body, "ok");
  assert.deepEqual(dns.hosts, []);
});

test("sendRequest stops reading a body at the size limit", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let pulled = 0;
  // An endless body. Each read gives 1 MB.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      controller.enqueue(chunk);
    },
  });
  const site = fakeFetch({ "https://course.example/robots.txt": { body } });
  const client = createHttpClient({ fetch: site.fetchPage, lookup: fakeLookup().lookup });
  await assert.rejects(client.sendRequest({ url: "https://course.example/robots.txt" }), /larger than/);
  // The client reads at most one chunk past the limit, plus the chunks that the stream queues ahead.
  assert.ok(pulled <= MAX_PAGE_BYTES / chunk.byteLength + 3, `pulled ${pulled} chunks`);
});
