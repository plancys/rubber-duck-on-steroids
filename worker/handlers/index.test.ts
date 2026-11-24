import assert from "node:assert/strict";
import { test } from "node:test";
import { createHandlers } from "./index.ts";

test("the demo job is available only when allowDemo is on", () => {
  assert.equal(createHandlers({ allowDemo: true }).has("demo"), true);
  assert.equal(createHandlers({ allowDemo: false }).has("demo"), false);
});
