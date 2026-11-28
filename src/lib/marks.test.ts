import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_MARK_IDS,
  isFormContentType,
  markErrorKey,
  markErrorText,
  markNoticeText,
  parseMarkForm,
} from "./marks.ts";

const SQL = "11111111-1111-4111-8111-111111111111";
const JOIN = "22222222-2222-4222-8222-222222222222";
const OLAP = "33333333-3333-4333-8333-333333333333";

// A form with the repeated fields of the checklist page.
function form(fields: [string, string | Blob][]): FormData {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

// A topic id for each number, for example 00000000-0000-4000-8000-000000000007.
function topicId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

test("parseMarkForm gives the marks, the unmarks and the lesson", () => {
  const fields = form([
    ["mark", SQL],
    ["mark", JOIN],
    ["unmark", OLAP],
    ["lesson", "2"],
  ]);
  assert.deepEqual(parseMarkForm(fields), { mark: [SQL, JOIN], unmark: [OLAP], lesson: 2 });
});

test("parseMarkForm accepts a form with no lesson or an empty lesson", () => {
  assert.deepEqual(parseMarkForm(form([["unmark", SQL]])), { mark: [], unmark: [SQL], lesson: null });
  const emptyLesson = form([
    ["mark", SQL],
    ["lesson", ""],
  ]);
  assert.deepEqual(parseMarkForm(emptyLesson), { mark: [SQL], unmark: [], lesson: null });
});

test("parseMarkForm refuses a lesson that is not a position", () => {
  for (const lesson of ["two", "-1", "1.5", "1234567890"]) {
    const fields = form([
      ["mark", SQL],
      ["lesson", lesson],
    ]);
    assert.deepEqual(parseMarkForm(fields), { error: "invalid_marks" }, lesson);
  }
});

test("parseMarkForm refuses a value that is not a UUID", () => {
  assert.deepEqual(parseMarkForm(form([["mark", "not-a-topic-id"]])), { error: "invalid_marks" });
  const oneBadId = form([
    ["mark", SQL],
    ["unmark", `${JOIN}x`],
  ]);
  assert.deepEqual(parseMarkForm(oneBadId), { error: "invalid_marks" });
  assert.deepEqual(parseMarkForm(form([["mark", new Blob([SQL])]])), { error: "invalid_marks" });
});

test("parseMarkForm refuses an empty form", () => {
  assert.deepEqual(parseMarkForm(new FormData()), { error: "invalid_marks" });
  assert.deepEqual(parseMarkForm(form([["lesson", "1"]])), { error: "invalid_marks" });
});

test("parseMarkForm accepts at most 500 ids", () => {
  assert.equal(MAX_MARK_IDS, 500);
  const ids = Array.from({ length: MAX_MARK_IDS + 1 }, (_, index) => topicId(index));
  const atLimit = parseMarkForm(form(ids.slice(0, MAX_MARK_IDS).map((id): [string, string] => ["mark", id])));
  assert.ok(!("error" in atLimit) && atLimit.mark.length === MAX_MARK_IDS);
  const split = ids.slice(0, MAX_MARK_IDS).map((id, index): [string, string] => [index % 2 ? "mark" : "unmark", id]);
  assert.ok(!("error" in parseMarkForm(form(split))));
  const overLimit = ids.map((id): [string, string] => ["mark", id]);
  assert.deepEqual(parseMarkForm(form(overLimit)), { error: "invalid_marks" });
});

test("parseMarkForm refuses an id in both lists, in any case", () => {
  const both = form([
    ["mark", SQL],
    ["unmark", JOIN],
    ["unmark", SQL.toUpperCase()],
  ]);
  assert.deepEqual(parseMarkForm(both), { error: "invalid_marks" });
});

test("parseMarkForm collapses duplicates and gives the ids in lowercase", () => {
  const duplicates = form([
    ["mark", SQL],
    ["mark", JOIN.toUpperCase()],
    ["mark", SQL.toUpperCase()],
    ["unmark", OLAP],
    ["unmark", OLAP],
  ]);
  assert.deepEqual(parseMarkForm(duplicates), { mark: [SQL, JOIN], unmark: [OLAP], lesson: null });
});

test("markErrorKey maps each database code to an error key", () => {
  assert.equal(markErrorKey("23514"), "marks_stale");
  assert.equal(markErrorKey("23503"), "marks_stale");
  assert.equal(markErrorKey("42501"), "not_found");
  assert.equal(markErrorKey("RD005"), "too_many_marks");
  assert.equal(markErrorKey("RD004"), "unknown");
  assert.equal(markErrorKey("23505"), "unknown");
  assert.equal(markErrorKey("PGRST301"), "unknown");
  assert.equal(markErrorKey(""), "unknown");
});

test("markErrorText and markNoticeText give fixed texts", () => {
  assert.equal(markErrorText(null), null);
  assert.equal(markErrorText("marks_stale"), "The page is out of date. Reload the page.");
  assert.equal(markErrorText("<script>"), markErrorText("unknown"));
  assert.equal(markErrorText("toString"), markErrorText("unknown"));
  assert.equal(markNoticeText("marks_saved"), "Marks saved.");
  assert.equal(markNoticeText("constructor"), null);
  assert.equal(markNoticeText(null), null);
});

test("isFormContentType accepts only the two form content types", () => {
  assert.equal(isFormContentType("application/x-www-form-urlencoded"), true);
  assert.equal(isFormContentType("application/x-www-form-urlencoded;charset=UTF-8"), true);
  assert.equal(isFormContentType("multipart/form-data; boundary=----form"), true);
  assert.equal(isFormContentType("Multipart/Form-Data; boundary=x"), true);
  assert.equal(isFormContentType("application/json"), false);
  assert.equal(isFormContentType("text/plain"), false);
  assert.equal(isFormContentType("application/json; x=multipart/form-data"), false);
  assert.equal(isFormContentType(""), false);
  assert.equal(isFormContentType(null), false);
});
