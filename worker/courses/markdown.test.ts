import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanText, htmlToMarkdown } from "./markdown.ts";

test("headings become ATX headings", () => {
  assert.equal(htmlToMarkdown("<h1>Course</h1><h2>Lesson</h2><h3>Part</h3>"), "# Course\n\n## Lesson\n\n### Part");
});

test("a link with no text before a heading goes, and the heading keeps its text", () => {
  assert.equal(
    htmlToMarkdown(
      '<h2><a href="#what-are-analytics"></a>What are analytics?</h2><h3><a href="#part"> \n </a>Part</h3>',
    ),
    "## What are analytics?\n\n### Part",
  );
});

test("a link around an image with no text goes, and the image stays", () => {
  assert.equal(
    htmlToMarkdown('<p><a href="/ducks"><img src="/duck.png" alt="A duck"></a></p>'),
    "![A duck](/duck.png)",
  );
});

test("a link with text keeps its Markdown link", () => {
  assert.equal(
    htmlToMarkdown('<p>Read <a href="https://docs.example/docs/ducks">the duck docs</a> first.</p>'),
    "Read [the duck docs](https://docs.example/docs/ducks) first.",
  );
});

test("a code block becomes a fenced block with its language", () => {
  const html = '<pre><code class="language-sql">SELECT 1\nFROM ducks;</code></pre>';
  assert.equal(htmlToMarkdown(html), "```sql\nSELECT 1\nFROM ducks;\n```");
});

test("a code block without a language becomes a plain fenced block", () => {
  assert.equal(htmlToMarkdown("<pre><code>npm start</code></pre>"), "```\nnpm start\n```");
});

test("inline code keeps its backticks", () => {
  assert.equal(htmlToMarkdown("<p>Run <code>npm test</code> now.</p>"), "Run `npm test` now.");
});

test("lists keep their markers and their order", () => {
  assert.equal(
    htmlToMarkdown("<ul><li>One</li><li>Two</li></ul><ol><li>First</li><li>Second</li></ol>"),
    "-   One\n-   Two\n\n1.  First\n2.  Second",
  );
});

test("an empty page gives empty Markdown", () => {
  assert.equal(htmlToMarkdown("<div>  </div>"), "");
});

test("cleanText removes extra spaces, cuts long text, and gives null for empty text", () => {
  assert.equal(cleanText("  Intro \n to   ducks "), "Intro to ducks");
  assert.equal(cleanText("abcdef", 3), "abc");
  assert.equal(cleanText(" \n "), null);
  assert.equal(cleanText(null), null);
});
