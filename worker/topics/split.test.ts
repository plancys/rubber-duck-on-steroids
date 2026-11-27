import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { splitLesson } from "./split.ts";

function shape(markdown: string): { path: string[]; text: string }[] {
  return splitLesson(markdown).map((passage) => ({ path: passage.headingPath, text: passage.text }));
}

test("the text before the first heading is a passage with an empty heading path", () => {
  assert.deepEqual(shape("Welcome to the course.\n\n# Ducks\n\nDucks swim."), [
    { path: [], text: "Welcome to the course." },
    { path: ["Ducks"], text: "Ducks swim." },
  ]);
});

test("headings of level 1 to 3 start a passage, and the heading path follows the levels", () => {
  const markdown = "# Course\n\nIntro.\n\n## Part one\n\nOne.\n\n### Detail\n\nDetail text.\n\n## Part two\n\nTwo.";
  assert.deepEqual(shape(markdown), [
    { path: ["Course"], text: "Intro." },
    { path: ["Course", "Part one"], text: "One." },
    { path: ["Course", "Part one", "Detail"], text: "Detail text." },
    { path: ["Course", "Part two"], text: "Two." },
  ]);
});

test("a heading of level 4 stays inside its section", () => {
  assert.deepEqual(shape("## Setup\n\nInstall it.\n\n#### Note\n\nRead the note."), [
    { path: ["Setup"], text: "Install it.\n\n#### Note\n\nRead the note." },
  ]);
});

test("a heading with no body gives no passage, and its title stays in the path of its children", () => {
  assert.deepEqual(shape("# Course\n\n## Part\n\n### Detail\n\nDetail text."), [
    { path: ["Course", "Part", "Detail"], text: "Detail text." },
  ]);
});

test("a heading inside a code block is not a section border", () => {
  const markdown = "## Shell\n\nRun this:\n\n```sh\n# install the tool\nnpm install\n```\n\nThen go on.";
  assert.deepEqual(shape(markdown), [
    { path: ["Shell"], text: "Run this:\n\n```sh\n# install the tool\nnpm install\n```\n\nThen go on." },
  ]);
});

test("a level skip keeps only the titles that exist", () => {
  assert.deepEqual(shape("# Course\n\n### Deep part\n\nText."), [{ path: ["Course", "Deep part"], text: "Text." }]);
});

test("a heading title loses its Markdown marks", () => {
  assert.deepEqual(shape("## The *fast* `SELECT` [path](https://example.com)\n\nText."), [
    { path: ["The fast SELECT path"], text: "Text." },
  ]);
});

test("each passage has its position, reference, offsets and the SHA-256 of its text", () => {
  const markdown = "Intro 🦆 text.\r\n\r\n# Ducks\r\n\r\nDucks swim.\r\n";
  const passages = splitLesson(markdown);
  assert.equal(passages.length, 2);
  passages.forEach((passage, index) => {
    assert.equal(passage.position, index + 1);
    assert.equal(passage.ref, `P${index + 1}`);
    assert.equal(markdown.slice(passage.startOffset, passage.endOffset), passage.text);
    assert.equal(passage.contentHash, createHash("sha256").update(passage.text).digest("hex"));
  });
  assert.equal(passages[1]?.text, "Ducks swim.");
  assert.equal(passages[1]?.startOffset, markdown.indexOf("Ducks swim."));
});

test("the same text gives the same hash, and a changed text gives a new hash", () => {
  const first = splitLesson("# Ducks\n\nDucks swim.").at(0);
  const again = splitLesson("# Ducks\n\nDucks swim.").at(0);
  const changed = splitLesson("# Ducks\n\nDucks fly.").at(0);
  assert.equal(first?.contentHash, again?.contentHash);
  assert.notEqual(first?.contentHash, changed?.contentHash);
});

test("an empty lesson gives no passage", () => {
  assert.deepEqual(splitLesson(""), []);
  assert.deepEqual(splitLesson(" \n\n "), []);
  assert.deepEqual(splitLesson("# Only a title\n"), []);
});
