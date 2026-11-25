import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { Job, Queue } from "./queue.ts";
import { createRunner, GENERIC_REASON, SafeError, UNKNOWN_TYPE_REASON, type Handler, type LogLine } from "./run.ts";

interface Call {
  name: keyof Queue;
  args: unknown[];
}

function job(fields: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    user_id: "user-1",
    type: "test",
    payload: { note: "payload-marker" },
    status: "running",
    step_index: 0,
    step_count: 0,
    step_label: null,
    attempts: 1,
    error: null,
    result: null,
    lease_id: "lease-1",
    lease_expires_at: null,
    created_at: "2026-11-24T12:00:00Z",
    updated_at: "2026-11-24T12:00:00Z",
    finished_at: null,
    ...fields,
  };
}

// A queue in memory. It hands out the given jobs in order and records each call.
// alive is the reply of each heartbeat: false means that the job lost its lease.
function fakeQueue(jobs: Job[], alive: boolean): Queue & { calls: Call[] } {
  const calls: Call[] = [];
  function record<T>(name: keyof Queue, args: unknown[], value: T): Promise<T> {
    calls.push({ name, args });
    return Promise.resolve(value);
  }
  return {
    calls,
    claimJob: () => record("claimJob", [], jobs.shift() ?? null),
    heartbeatJob: (...args) => record("heartbeatJob", args, alive),
    completeJob: (...args) => record("completeJob", args, true),
    failJob: (...args) => record("failJob", args, true),
    releaseJob: (...args) => record("releaseJob", args, true),
  };
}

// A runner with a fake queue and a sleep that records each wait and returns at once.
function setup(
  jobs: Job[],
  handlers: Record<string, Handler>,
  options: { alive?: boolean; heartbeatMs?: number } = {},
) {
  const queue = fakeQueue(jobs, options.alive ?? true);
  const lines: LogLine[] = [];
  const waits: number[] = [];
  const runner = createRunner({
    queue,
    handlers: new Map(Object.entries(handlers)),
    log: (line) => {
      lines.push(line);
    },
    heartbeatMs: options.heartbeatMs,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
  });
  return {
    runner,
    lines,
    waits,
    events: () => lines.map((line) => line.event),
    // The calls after claim_job.
    endCalls: () => queue.calls.filter((call) => call.name !== "claimJob"),
    claims: () => queue.calls.filter((call) => call.name === "claimJob").length,
  };
}

// A handler that waits until the job stops.
const waitForAbort: Handler = async ({ signal }) => {
  await delay(60_000, undefined, { signal });
  return null;
};

test("a job that ends gets its result, and the log holds no payload and no result", async () => {
  const run = setup([job()], {
    test: async ({ step }) => {
      await step(1, 2, "One");
      return { answer: "result-marker" };
    },
  });
  await run.runner.wake();
  assert.deepEqual(run.endCalls(), [
    { name: "heartbeatJob", args: ["job-1", "lease-1", 1, 2, "One"] },
    { name: "completeJob", args: ["job-1", "lease-1", { answer: "result-marker" }] },
  ]);
  assert.deepEqual(run.events(), ["claimed", "step", "done"]);
  assert.deepEqual(run.lines[0], { event: "claimed", jobId: "job-1", type: "test", attempt: 1 });
  const log = JSON.stringify(run.lines);
  assert.ok(!log.includes("payload-marker"));
  assert.ok(!log.includes("result-marker"));
});

test("a safe handler error waits attempt × 5 seconds, then fails the job with its message", async () => {
  const run = setup([job({ attempts: 2 })], {
    test: () => Promise.reject(new SafeError("The course page is empty.")),
  });
  await run.runner.wake();
  assert.deepEqual(run.waits, [10_000]);
  assert.deepEqual(run.endCalls(), [
    { name: "failJob", args: ["job-1", "lease-1", "The course page is empty.", true] },
  ]);
  assert.deepEqual(run.events(), ["claimed", "failed"]);
  assert.equal(run.lines.find((line) => line.event === "failed")?.retry, true);
});

test("a final safe handler error fails the job at once with its message and no wait", async () => {
  const run = setup([job({ attempts: 1 })], {
    test: () => Promise.reject(new SafeError("The site blocks the bot.", { retry: false })),
  });
  await run.runner.wake();
  assert.deepEqual(run.waits, []);
  assert.deepEqual(run.endCalls(), [
    { name: "failJob", args: ["job-1", "lease-1", "The site blocks the bot.", false] },
  ]);
  assert.deepEqual(run.events(), ["claimed", "failed"]);
  assert.equal(run.lines.find((line) => line.event === "failed")?.retry, false);
});

test("a subclass of SafeError keeps its retry choice", async () => {
  class Final extends SafeError {}
  const run = setup([job()], {
    test: () => Promise.reject(new Final("Final reason.", { retry: false })),
  });
  await run.runner.wake();
  assert.deepEqual(run.endCalls(), [{ name: "failJob", args: ["job-1", "lease-1", "Final reason.", false] }]);
});

test("any other handler error fails the job with the general reason, and the raw error goes only to the log", async () => {
  const run = setup([job()], {
    test: () => Promise.reject(new Error("raw-error-marker")),
  });
  await run.runner.wake();
  assert.deepEqual(run.waits, [5_000]);
  assert.deepEqual(run.endCalls(), [{ name: "failJob", args: ["job-1", "lease-1", GENERIC_REASON, true] }]);
  const failed = run.lines.find((line) => line.event === "failed");
  assert.ok(failed);
  assert.equal(failed.reason, GENERIC_REASON);
  assert.equal(failed.retry, true);
  assert.equal(failed.error, "raw-error-marker");
});

test("a lost lease in a step stops the handler and writes no result", async () => {
  let afterStep = false;
  const run = setup(
    [job()],
    {
      test: async ({ step }) => {
        await step(1, 2, "One");
        afterStep = true;
        return { done: true };
      },
    },
    { alive: false },
  );
  await run.runner.wake();
  assert.equal(afterStep, false);
  assert.deepEqual(run.endCalls(), [{ name: "heartbeatJob", args: ["job-1", "lease-1", 1, 2, "One"] }]);
  assert.deepEqual(run.events(), ["claimed", "step", "lost"]);
});

test("a lost lease in the heartbeat timer stops the handler and writes no result", async () => {
  const run = setup([job()], { test: waitForAbort }, { alive: false, heartbeatMs: 5 });
  await run.runner.wake();
  assert.ok(run.endCalls().every((call) => call.name === "heartbeatJob"));
  assert.deepEqual(run.events(), ["claimed", "lost"]);
});

test("a job type without a handler fails with its reason and no wait", async () => {
  const run = setup([job({ type: "unknown" })], {});
  await run.runner.wake();
  assert.deepEqual(run.waits, []);
  assert.deepEqual(run.endCalls(), [{ name: "failJob", args: ["job-1", "lease-1", UNKNOWN_TYPE_REASON, true] }]);
  assert.deepEqual(run.events(), ["claimed", "failed"]);
});

test("an empty queue ends the loop after one look", async () => {
  const run = setup([], {});
  await run.runner.wake();
  assert.equal(run.claims(), 1);
  assert.deepEqual(run.endCalls(), []);
  assert.deepEqual(run.lines, []);
});

test("a wake request during a running loop starts no second loop", async () => {
  const run = setup([job({ id: "job-1" }), job({ id: "job-2" })], { test: () => Promise.resolve(null) });
  const first = run.runner.wake();
  const second = run.runner.wake();
  assert.equal(first, second);
  await first;
  assert.equal(run.claims(), 3);
  assert.deepEqual(run.events(), ["claimed", "done", "claimed", "done"]);
});

test("a stop releases the current job and takes no new job", async () => {
  const started = Promise.withResolvers<undefined>();
  const run = setup([job({ id: "job-1" }), job({ id: "job-2" })], {
    test: (context) => {
      started.resolve(undefined);
      return waitForAbort(context);
    },
  });
  const loop = run.runner.wake();
  await started.promise;
  await run.runner.stop();
  await loop;
  await run.runner.wake();
  assert.equal(run.claims(), 1);
  assert.deepEqual(run.endCalls(), [{ name: "releaseJob", args: ["job-1", "lease-1"] }]);
  assert.deepEqual(run.events(), ["claimed", "released"]);
});

test("a stop during the wait after a failed start still records the failure", async () => {
  const queue = fakeQueue([job({ id: "job-1" })], true);
  const waiting = Promise.withResolvers<undefined>();
  const runner = createRunner({
    queue,
    handlers: new Map<string, Handler>([["test", () => Promise.reject(new SafeError("Planned failure."))]]),
    log: () => undefined,
    // The wait ends only on the stop signal.
    sleep: (_ms, signal) =>
      new Promise<void>((resolve) => {
        waiting.resolve(undefined);
        signal.addEventListener(
          "abort",
          () => {
            resolve();
          },
          { once: true },
        );
      }),
  });
  const loop = runner.wake();
  await waiting.promise;
  await runner.stop();
  await loop;
  const ends = queue.calls.filter((call) => call.name !== "claimJob" && call.name !== "heartbeatJob");
  assert.deepEqual(ends, [{ name: "failJob", args: ["job-1", "lease-1", "Planned failure.", true] }]);
});
