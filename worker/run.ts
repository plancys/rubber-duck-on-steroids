// The job loop. It takes jobs one at a time until the queue is empty, and ends each job with one database call.
// The loop gets the queue, the handlers, the log and the timers as inputs, so the unit tests run it without real waits.

import { setTimeout as delay } from "node:timers/promises";
import type { Job, Json, Queue } from "./queue.ts";
import { retryWaitMs } from "./rules.ts";

// The reason for a job type that has no handler.
export const UNKNOWN_TYPE_REASON = "This kind of work is not available.";
// The reason for each handler error that is not a SafeError.
export const GENERIC_REASON = "The work did not finish.";

// A handler throws a SafeError when its message is safe to show to the learner.
// The message goes to the error column of the job. Each other error goes only to the worker log.
export class SafeError extends Error {
  name = "SafeError";
}

export interface HandlerContext {
  // The payload of the job, as the web app wrote it. Check each value before use.
  payload: Json;
  // The number of this start: 1, 2 or 3.
  attempt: number;
  // Report the progress. The call also extends the lease. It throws when the job must stop.
  step: (index: number, count: number, label: string) => Promise<void>;
  // Aborts when the job lost its lease or the worker stops.
  signal: AbortSignal;
}

// A handler does the work of one job type and returns the result as JSON.
export type Handler = (context: HandlerContext) => Promise<Json>;

interface JobIds {
  jobId: string;
  type: string;
  attempt: number;
}

// One log line. A line never holds the payload, the result or a key.
export interface LogLine extends Partial<JobIds> {
  event: "claimed" | "step" | "done" | "failed" | "released" | "lost" | "error";
  step?: number;
  count?: number;
  // The short reason that goes to the error column.
  reason?: string;
  // The raw error. It goes only to the log.
  error?: string;
  // The database function of a call that failed.
  call?: string;
}

export interface RunnerOptions {
  queue: Queue;
  handlers: ReadonlyMap<string, Handler>;
  log: (line: LogLine) => void;
  // The time between two heartbeats while a job runs. The lease lasts 60 seconds.
  heartbeatMs?: number;
  // The wait before the worker records a failed start.
  retryWaitMs?: (attempt: number) => number;
  // Wait for a time. The wait ends early when the signal aborts.
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface Runner {
  // Start the loop when no loop runs. The promise ends when the loop ends.
  wake: () => Promise<void>;
  // Take no new job, release the current job, and wait for the loop to end.
  stop: () => Promise<void>;
}

type Outcome = { kind: "done"; result: Json } | { kind: "error"; error: unknown } | { kind: "aborted" };

// The state of the job that runs now.
interface JobControl {
  controller: AbortController;
  lost: boolean;
}

async function sleepFor(ms: number, signal: AbortSignal): Promise<void> {
  await delay(ms, undefined, { signal });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Run the handler until it ends or the signal aborts.
// After an abort the loop does not wait for the handler, so a handler that ignores the signal cannot block a stop.
function settle(handler: Handler, context: HandlerContext): Promise<Outcome> {
  const { signal } = context;
  return new Promise<Outcome>((resolve) => {
    const onAbort = (): void => {
      resolve({ kind: "aborted" });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve()
      .then(() => handler(context))
      .then(
        (result) => {
          resolve({ kind: "done", result });
        },
        (error: unknown) => {
          resolve({ kind: "error", error });
        },
      )
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}

export function createRunner(options: RunnerOptions): Runner {
  const { queue, handlers, log } = options;
  const heartbeatMs = options.heartbeatMs ?? 20_000;
  const waitMs = options.retryWaitMs ?? retryWaitMs;
  const sleep = options.sleep ?? sleepFor;

  let loop: Promise<void> | null = null;
  let stopping = false;
  let current: JobControl | null = null;
  // Each wake request adds one. When a wake request comes while the loop looks at an empty queue, the loop looks again.
  let wakes = 0;

  function wake(): Promise<void> {
    wakes += 1;
    if (stopping) return Promise.resolve();
    loop ??= runLoop()
      .catch((error: unknown) => {
        log({ event: "error", error: errorText(error) });
      })
      .finally(() => {
        loop = null;
      });
    return loop;
  }

  async function stop(): Promise<void> {
    stopping = true;
    current?.controller.abort(new Error("The worker stops."));
    if (loop) await loop;
  }

  async function runLoop(): Promise<void> {
    while (!stopping) {
      const seen = wakes;
      const job = await claim();
      if (job) {
        await runJob(job);
      } else if (wakes === seen) {
        // The queue is empty, and no wake request came during the look.
        return;
      }
    }
  }

  // Take the next job. A failed call ends the loop. The next wake request or poll tries again.
  async function claim(): Promise<Job | null> {
    try {
      return await queue.claimJob();
    } catch (error) {
      log({ event: "error", call: "claim_job", error: errorText(error) });
      return null;
    }
  }

  async function runJob(job: Job): Promise<void> {
    const ids: JobIds = { jobId: job.id, type: job.type, attempt: job.attempts };
    log({ event: "claimed", ...ids });
    // A stop signal can come while claim_job runs. Give the job back at once.
    if (stopping) {
      await release(job, ids);
      return;
    }
    const handler = handlers.get(job.type);
    if (!handler) {
      log({ event: "failed", ...ids, reason: UNKNOWN_TYPE_REASON, error: `No handler for the type ${job.type}.` });
      await end("fail_job", ids, () => queue.failJob(job.id, job.lease_id, UNKNOWN_TYPE_REASON));
      return;
    }
    await runHandler(job, ids, handler);
  }

  async function runHandler(job: Job, ids: JobIds, handler: Handler): Promise<void> {
    const control: JobControl = { controller: new AbortController(), lost: false };
    const { signal } = control.controller;
    current = control;
    let progress = { index: job.step_index, count: job.step_count, label: job.step_label };

    // Extend the lease and write the progress. A false reply means that the job no longer runs with this lease.
    const heartbeat = async (): Promise<void> => {
      try {
        const alive = await queue.heartbeatJob(job.id, job.lease_id, progress.index, progress.count, progress.label);
        if (!alive) {
          control.lost = true;
          control.controller.abort(new Error("The job lost its lease."));
        }
      } catch (error) {
        // A failed call does not end the lease at once. The next heartbeat tries again.
        log({ event: "error", call: "heartbeat_job", ...ids, error: errorText(error) });
      }
    };

    const step = async (index: number, count: number, label: string): Promise<void> => {
      signal.throwIfAborted();
      progress = { index, count, label };
      log({ event: "step", ...ids, step: index, count });
      await heartbeat();
      signal.throwIfAborted();
    };

    // The timer keeps the lease alive until the job ends, also during the wait after an error.
    const timer = setInterval(() => {
      void heartbeat();
    }, heartbeatMs);

    try {
      const outcome = await settle(handler, { payload: job.payload, attempt: job.attempts, step, signal });
      if (outcome.kind === "done" && !control.lost) {
        // The work is done. Store the result, also when a stop signal came after the handler ended.
        await end("complete_job", ids, () => queue.completeJob(job.id, job.lease_id, outcome.result), "done");
        return;
      }
      if (outcome.kind === "error") {
        const reason = outcome.error instanceof SafeError ? outcome.error.message : GENERIC_REASON;
        log({ event: "failed", ...ids, reason, error: errorText(outcome.error) });
        // Wait before the job goes back to the queue. A stop signal or a lost lease ends the wait early.
        await pause(waitMs(job.attempts), signal);
        if (!signal.aborted) {
          await end("fail_job", ids, () => queue.failJob(job.id, job.lease_id, reason));
          return;
        }
      }
      // The job stops before its end and gets no result.
      // After a lost lease, another worker owns the job. After a stop signal, the job goes back to the queue.
      if (control.lost) log({ event: "lost", ...ids });
      else await release(job, ids);
    } finally {
      clearInterval(timer);
      current = null;
    }
  }

  async function pause(ms: number, signal: AbortSignal): Promise<void> {
    try {
      await sleep(ms, signal);
    } catch {
      // An abort ends the wait early. The caller reads the signal.
    }
  }

  function release(job: Job, ids: JobIds): Promise<void> {
    return end("release_job", ids, () => queue.releaseJob(job.id, job.lease_id), "released");
  }

  // Send the call that ends the job. A false reply means that the lease ended before the call.
  async function end(
    call: string,
    ids: JobIds,
    send: () => Promise<boolean>,
    event?: "done" | "released",
  ): Promise<void> {
    try {
      const ok = await send();
      if (!ok) log({ event: "lost", ...ids });
      else if (event) log({ event, ...ids });
    } catch (error) {
      // The lease ends without a heartbeat. Then claim_job gives the job to the next worker.
      log({ event: "error", call, ...ids, error: errorText(error) });
    }
  }

  return { wake, stop };
}
