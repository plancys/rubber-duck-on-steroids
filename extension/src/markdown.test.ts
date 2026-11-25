import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { htmlToMarkdown, pageToMarkdown } from "./markdown.ts";

const fixture = await readFile(new URL("./fixtures/lesson.html", import.meta.url), "utf8");

function readFixture() {
  const { document } = new JSDOM(fixture, { url: "https://learn.example.com/course/lesson-2" }).window;
  return pageToMarkdown(document);
}

test("the lesson page gives its title and its main text", () => {
  const page = readFixture();
  assert.ok(page);
  assert.equal(page.title, "Lesson 2: Ducks in tables");
  assert.match(page.markdown, /A table keeps the ducks in rows\./);
});

test("the navigation and the footer stay out of the Markdown", () => {
  const page = readFixture();
  assert.ok(page);
  assert.doesNotMatch(page.markdown, /Next lesson/);
  assert.doesNotMatch(page.markdown, /Copyright/);
});

test("the lesson keeps its headings, code, lists and links in Markdown", () => {
  const page = readFixture();
  assert.ok(page);
  assert.match(page.markdown, /^## Create the table$/m);
  assert.match(page.markdown, /```sql\nCREATE TABLE ducks \(name String, weight Float32\)\nORDER BY name;\n```/);
  assert.match(page.markdown, /^- {3}How a table keeps rows$/m);
  assert.match(page.markdown, /\[the duck docs\]\(https:\/\/docs\.example\/docs\/ducks\)/);
  assert.doesNotMatch(page.markdown, /\[\]\(#create\)/);
});

test("a page with no text gives null", () => {
  const { document } = new JSDOM("<!doctype html><html><body></body></html>").window;
  assert.equal(pageToMarkdown(document), null);
});

test("the conversion uses the same options as the worker", () => {
  assert.equal(htmlToMarkdown("<h1>Course</h1><ul><li>One</li></ul><hr>"), "# Course\n\n-   One\n\n---");
});
