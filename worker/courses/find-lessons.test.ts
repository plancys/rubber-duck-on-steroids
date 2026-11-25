import assert from "node:assert/strict";
import { test } from "node:test";
import type { LessonPicker, PickResult } from "../llm.ts";
import type { Link, StartPage } from "./crawl.ts";
import { findLessons, MAX_LESSONS, ruleLessons } from "./find-lessons.ts";

function link(path: string, text = path): Link {
  return { url: `https://docs.example${path}`, text };
}

const page: StartPage = {
  url: "https://docs.example/docs/ducks",
  title: "Intro to Ducks",
  links: [
    link("/"),
    link("/docs/ducks/first"),
    link("/docs/ducks-extra/page"),
    link("/docs/other/page"),
    link("/docs/ducks/second/part"),
    link("/docs/ducks/third"),
  ],
};

const signal = new AbortController().signal;

function picker(answer: PickResult | Error): LessonPicker & { calls: number } {
  const fake = {
    calls: 0,
    pickLessons: () => {
      fake.calls += 1;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return fake;
}

test("the rule keeps the links under the path of the start page, in page order", () => {
  assert.deepEqual(
    ruleLessons(page).map((item) => item.url),
    [
      "https://docs.example/docs/ducks/first",
      "https://docs.example/docs/ducks/second/part",
      "https://docs.example/docs/ducks/third",
    ],
  );
});

test("the rule on a start page at the site root keeps every link but the root", () => {
  const root: StartPage = { url: "https://docs.example/", title: null, links: [link("/"), link("/a"), link("/b/c")] };
  assert.deepEqual(
    ruleLessons(root).map((item) => item.url),
    ["https://docs.example/a", "https://docs.example/b/c"],
  );
});

test("the rule returns at most 200 lessons", () => {
  const many: StartPage = {
    url: "https://docs.example/docs",
    title: null,
    links: Array.from({ length: 250 }, (_, index) => link(`/docs/lesson-${index}`)),
  };
  const lessons = ruleLessons(many);
  assert.equal(lessons.length, MAX_LESSONS);
  assert.equal(lessons[0]?.url, "https://docs.example/docs/lesson-0");
  assert.equal(lessons.at(-1)?.url, "https://docs.example/docs/lesson-199");
});

test("without a picker the finder uses the rule", async () => {
  const found = await findLessons(page, null, signal);
  assert.equal(found.source, "rule");
  assert.equal(found.lessons.length, 3);
  assert.equal(found.fallback, undefined);
});

test("the model picks the lessons and their order", async () => {
  const fake = picker({ indexes: [5, 1, 3], inputTokens: 120, outputTokens: 15 });
  const found = await findLessons(page, fake, signal);
  assert.deepEqual(found, {
    lessons: [page.links[5], page.links[1], page.links[3]],
    source: "model",
    inputTokens: 120,
    outputTokens: 15,
  });
  assert.equal(fake.calls, 1);
});

test("the model picks at most 200 lessons", async () => {
  const many: StartPage = {
    url: "https://docs.example/docs",
    title: null,
    links: Array.from({ length: 250 }, (_, index) => link(`/docs/lesson-${index}`)),
  };
  const indexes = Array.from({ length: 250 }, (_, index) => 249 - index);
  const found = await findLessons(many, picker({ indexes, inputTokens: 1, outputTokens: 1 }), signal);
  assert.equal(found.source, "model");
  assert.equal(found.lessons.length, MAX_LESSONS);
  assert.equal(found.lessons[0]?.url, "https://docs.example/docs/lesson-249");
});

test("a model answer without a valid lesson falls back to the rule", async () => {
  const found = await findLessons(page, picker({ indexes: null, inputTokens: 100, outputTokens: 5 }), signal);
  assert.equal(found.source, "rule");
  assert.equal(found.lessons.length, 3);
  assert.equal(found.inputTokens, 100);
  assert.ok(found.fallback);
});

test("a failed model call falls back to the rule", async () => {
  const found = await findLessons(page, picker(new Error("529 overloaded")), signal);
  assert.equal(found.source, "rule");
  assert.equal(found.lessons.length, 3);
  assert.equal(found.fallback, "529 overloaded");
});

test("a stop of the job during the model call is not a fallback", async () => {
  const controller = new AbortController();
  controller.abort(new Error("The job stops."));
  await assert.rejects(findLessons(page, picker(new Error("aborted")), controller.signal), /The job stops/);
});

test("a start page without links does not call the model", async () => {
  const fake = picker({ indexes: [0], inputTokens: 1, outputTokens: 1 });
  const found = await findLessons({ ...page, links: [] }, fake, signal);
  assert.deepEqual(found, { lessons: [], source: "rule" });
  assert.equal(fake.calls, 0);
});
