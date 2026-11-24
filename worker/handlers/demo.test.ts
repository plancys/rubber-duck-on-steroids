import assert from "node:assert/strict";
import { test } from "node:test";
import type { Json } from "../queue.ts";
import { SafeError } from "../run.ts";
import { demo } from "./demo.ts";

// Run the demo and record each step that it reports. The payloads use stepSeconds 0, so no test waits.
function runDemo(payload: Json, attempt: number) {
  const steps: [number, number, string][] = [];
  const result = demo({
    payload,
    attempt,
    signal: new AbortController().signal,
    step: (index, count, label) => {
      steps.push([index, count, label]);
      return Promise.resolve();
    },
  });
  return { steps, result };
}

test("the demo reports each step and returns the step count", async () => {
  const { steps, result } = runDemo({ steps: 3, stepSeconds: 0 }, 1);
  assert.deepEqual(await result, { steps: 3 });
  assert.deepEqual(steps, [
    [1, 3, "Step 1 of 3"],
    [2, 3, "Step 2 of 3"],
    [3, 3, "Step 3 of 3"],
  ]);
});

test("with failTimes 0, attempt 1 passes", async () => {
  assert.deepEqual(await runDemo({ steps: 1, stepSeconds: 0, failTimes: 0 }, 1).result, { steps: 1 });
});

test("with failTimes 1, attempt 1 fails with a safe error and attempt 2 passes", async () => {
  const payload = { steps: 1, stepSeconds: 0, failTimes: 1 };
  await assert.rejects(runDemo(payload, 1).result, SafeError);
  assert.deepEqual(await runDemo(payload, 2).result, { steps: 1 });
});

test("with failTimes 3, each of the three attempts fails with a safe error", async () => {
  const payload = { steps: 1, stepSeconds: 0, failTimes: 3 };
  for (const attempt of [1, 2, 3]) {
    await assert.rejects(runDemo(payload, attempt).result, SafeError);
  }
});
