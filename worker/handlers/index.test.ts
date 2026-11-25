import assert from "node:assert/strict";
import { test } from "node:test";
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

test("the demo job is available only when allowDemo is on", () => {
  assert.equal(createHandlers({ allowDemo: true, loadCourse }).has("demo"), true);
  assert.equal(createHandlers({ allowDemo: false, loadCourse }).has("demo"), false);
});

test("the load_course job is always available", () => {
  assert.equal(createHandlers({ allowDemo: true, loadCourse }).has("load_course"), true);
  assert.equal(createHandlers({ allowDemo: false, loadCourse }).has("load_course"), true);
});
