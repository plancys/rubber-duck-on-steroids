import assert from "node:assert/strict";
import { test } from "node:test";
import { errorForResponse, errorText, normalizeBaseUrl } from "./api.ts";

test("the product address must use https, and only localhost and 127.0.0.1 can use http", () => {
  assert.equal(normalizeBaseUrl(" https://duck.example.com/dashboard "), "https://duck.example.com");
  assert.equal(normalizeBaseUrl("http://localhost:4321/"), "http://localhost:4321");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:4321"), "http://127.0.0.1:4321");
  assert.equal(normalizeBaseUrl("http://duck.example.com"), null);
  assert.equal(normalizeBaseUrl("http://192.168.1.10:4321"), null);
  assert.equal(normalizeBaseUrl("http://localhost.example.com"), null);
  assert.equal(normalizeBaseUrl("ftp://duck.example.com"), null);
  assert.equal(normalizeBaseUrl("duck.example.com"), null);
});

test("a 409 answer gives the key in its body, and the course_loading key without a known key", () => {
  assert.equal(errorForResponse(409, "crawl_course"), "crawl_course");
  assert.equal(errorForResponse(409, "course_full"), "course_full");
  assert.equal(errorForResponse(409, "course_loading"), "course_loading");
  assert.equal(errorForResponse(409, "network"), "course_loading");
  assert.equal(errorForResponse(409, null), "course_loading");
  assert.equal(errorForResponse(401, "crawl_course"), "invalid_token");
  assert.equal(errorForResponse(500, null), "unknown");
  assert.match(errorText("crawl_course"), /Reload it there/);
  assert.match(errorText("course_full"), /500 pages/);
});
