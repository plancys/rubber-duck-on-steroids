import assert from "node:assert/strict";
import { test } from "node:test";
import { byteLength, courseScope, isCoursePage, isNewPage, pageKey } from "./rules.ts";

test("pageKey removes the fragment and the trailing slash", () => {
  assert.equal(pageKey("https://learn.example.com/course/lesson-1/#part"), "https://learn.example.com/course/lesson-1");
  assert.equal(pageKey("https://learn.example.com/"), "https://learn.example.com");
});

test("pageKey keeps the query", () => {
  assert.equal(pageKey("https://learn.example.com/course?lesson=2#top"), "https://learn.example.com/course?lesson=2");
});

test("pageKey refuses a page that is not http or https", () => {
  assert.equal(pageKey("chrome://extensions"), null);
  assert.equal(pageKey("file:///home/duck/lesson.html"), null);
  assert.equal(pageKey("not a url"), null);
});

test("courseScope takes the site and the path of the start page", () => {
  assert.deepEqual(courseScope("https://learn.example.com/course/#intro"), {
    origin: "https://learn.example.com",
    startPath: "/course",
    startUrl: "https://learn.example.com/course",
  });
  assert.equal(courseScope("about:blank"), null);
});

test("a page under the start path on the same site is a course page", () => {
  const scope = courseScope("https://learn.example.com/course");
  assert.ok(scope);
  assert.equal(isCoursePage(scope, "https://learn.example.com/course/lesson-1"), true);
  assert.equal(isCoursePage(scope, "https://learn.example.com/course/part-2/lesson-3/"), true);
  assert.equal(isCoursePage(scope, "https://learn.example.com/course?lesson=2"), true);
});

test("a page on another site or outside the start path is not a course page", () => {
  const scope = courseScope("https://learn.example.com/course");
  assert.ok(scope);
  assert.equal(isCoursePage(scope, "https://other.example.com/course/lesson-1"), false);
  assert.equal(isCoursePage(scope, "http://learn.example.com/course/lesson-1"), false);
  assert.equal(isCoursePage(scope, "https://learn.example.com/courses/lesson-1"), false);
  assert.equal(isCoursePage(scope, "https://learn.example.com/pricing"), false);
});

test("the start page itself is not a lesson", () => {
  const scope = courseScope("https://learn.example.com/course");
  assert.ok(scope);
  assert.equal(isCoursePage(scope, "https://learn.example.com/course/"), false);
  assert.equal(isCoursePage(scope, "https://learn.example.com/course#lessons"), false);
});

test("a course that starts on the home page covers the whole site", () => {
  const scope = courseScope("https://learn.example.com/");
  assert.ok(scope);
  assert.equal(isCoursePage(scope, "https://learn.example.com/any/lesson"), true);
  assert.equal(isCoursePage(scope, "https://other.example.com/any/lesson"), false);
});

test("a page that the course saved is not new, also with a fragment or a trailing slash", () => {
  const saved = ["https://learn.example.com/course/lesson-1"];
  assert.equal(isNewPage(saved, "https://learn.example.com/course/lesson-1"), false);
  assert.equal(isNewPage(saved, "https://learn.example.com/course/lesson-1/#part"), false);
  assert.equal(isNewPage(saved, "https://learn.example.com/course/lesson-2"), true);
  assert.equal(isNewPage(saved, "chrome://newtab"), false);
});

test("byteLength counts UTF-8 bytes", () => {
  assert.equal(byteLength("duck"), 4);
  assert.equal(byteLength("kaczka żółta"), 15);
});
