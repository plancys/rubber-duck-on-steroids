import assert from "node:assert/strict";
import { test } from "node:test";
import type { BuildTopicMapOptions } from "./build-topic-map.ts";
import type { LoadCourseOptions } from "./load-course.ts";
import { createHandlers } from "./index.ts";

// The handlers only keep these options. No test here calls them.
const loadCourse: LoadCourseOptions = {
  courses: {
    startCourseLoad: () => Promise.resolve(null),
    finishCourseLoad: () => Promise.resolve(true),
    failCourseLoad: () => Promise.resolve(true),
  },
  picker: null,
  log: () => undefined,
};

const buildTopicMap: BuildTopicMapOptions = {
  topics: {
    startTopicMap: () => Promise.resolve(null),
    readLessonText: () => Promise.resolve(null),
    saveLessonAnalysis: () => Promise.resolve(true),
    finishTopicMap: () => Promise.resolve(true),
  },
  engine: null,
  log: () => undefined,
};

test("the demo job is available only when allowDemo is on", () => {
  assert.equal(createHandlers({ allowDemo: true, loadCourse, buildTopicMap }).has("demo"), true);
  assert.equal(createHandlers({ allowDemo: false, loadCourse, buildTopicMap }).has("demo"), false);
});

test("the load_course job is always available", () => {
  assert.equal(createHandlers({ allowDemo: true, loadCourse, buildTopicMap }).has("load_course"), true);
  assert.equal(createHandlers({ allowDemo: false, loadCourse, buildTopicMap }).has("load_course"), true);
});

test("the build_topic_map job is always available, also without an engine address", () => {
  assert.equal(createHandlers({ allowDemo: true, loadCourse, buildTopicMap }).has("build_topic_map"), true);
  assert.equal(createHandlers({ allowDemo: false, loadCourse, buildTopicMap }).has("build_topic_map"), true);
});
