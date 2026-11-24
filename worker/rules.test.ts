import assert from "node:assert/strict";
import { test } from "node:test";
import { demoSettings, isWakeAuthorized, retryWaitMs } from "./rules.ts";

test("the wait before a retry is 5 seconds for each start", () => {
  assert.equal(retryWaitMs(1), 5_000);
  assert.equal(retryWaitMs(2), 10_000);
  assert.equal(retryWaitMs(3), 15_000);
});

test("the wake check accepts the bearer secret", () => {
  assert.equal(isWakeAuthorized("Bearer local-wake-secret", "local-wake-secret"), true);
});

test("the wake check refuses a wrong secret", () => {
  // The same length as the secret, and a different length.
  assert.equal(isWakeAuthorized("Bearer other-wake-secret", "local-wake-secret"), false);
  assert.equal(isWakeAuthorized("Bearer short", "local-wake-secret"), false);
  // The secret without the bearer scheme.
  assert.equal(isWakeAuthorized("local-wake-secret", "local-wake-secret"), false);
  // An empty secret never matches.
  assert.equal(isWakeAuthorized("Bearer ", ""), false);
});

test("the wake check refuses a request without the header", () => {
  assert.equal(isWakeAuthorized(undefined, "local-wake-secret"), false);
  assert.equal(isWakeAuthorized("", "local-wake-secret"), false);
});

test("the demo payload keeps values inside the limits", () => {
  assert.deepEqual(demoSettings({ steps: 1, stepSeconds: 0, failTimes: 0 }), {
    steps: 1,
    stepSeconds: 0,
    failTimes: 0,
  });
  assert.deepEqual(demoSettings({ steps: 7, stepSeconds: 3, failTimes: 2 }), {
    steps: 7,
    stepSeconds: 3,
    failTimes: 2,
  });
  assert.deepEqual(demoSettings({ steps: 10, stepSeconds: 5, failTimes: 3 }), {
    steps: 10,
    stepSeconds: 5,
    failTimes: 3,
  });
});

test("the demo payload moves values below a limit up to the limit", () => {
  assert.deepEqual(demoSettings({ steps: 0, stepSeconds: -1, failTimes: -1 }), {
    steps: 1,
    stepSeconds: 0,
    failTimes: 0,
  });
});

test("the demo payload moves values above a limit down to the limit", () => {
  assert.deepEqual(demoSettings({ steps: 11, stepSeconds: 6, failTimes: 4 }), {
    steps: 10,
    stepSeconds: 5,
    failTimes: 3,
  });
});

test("the demo payload gives the default to a missing value or a value of a wrong type", () => {
  const defaults = { steps: 5, stepSeconds: 2, failTimes: 0 };
  assert.deepEqual(demoSettings({}), defaults);
  assert.deepEqual(demoSettings({ steps: "3", stepSeconds: null, failTimes: true }), defaults);
  assert.deepEqual(demoSettings(null), defaults);
  assert.deepEqual(demoSettings([3, 1, 0]), defaults);
  assert.deepEqual(demoSettings("steps"), defaults);
});
