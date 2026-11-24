import { useEffect, useState } from "react";
import type { JobView } from "@/lib/jobs";

const POLL_INTERVAL_MS = 3_000;
// After this many failed requests in a row the page stops asking. A reload starts again.
const MAX_ERRORS_IN_A_ROW = 5;

function isInProgress(status: JobView["status"]): boolean {
  return status === "waiting" || status === "running";
}

/** Waits for the given time. An abort ends the wait at once. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/** Asks for the job every 3 seconds until it is done or failed. Each request starts after the previous one ends. */
async function pollJob(
  jobId: string,
  signal: AbortSignal,
  onChange: (job: JobView) => void,
  onError: () => void,
): Promise<void> {
  // The loop ends with a return: on an abort, at the end of the job, when the job cannot be read,
  // or after MAX_ERRORS_IN_A_ROW failed requests.
  let errors = 0;
  for (;;) {
    await wait(POLL_INTERVAL_MS, signal);
    if (signal.aborted) return;
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal });
      // Without a session, or without access to the job, more requests cannot succeed.
      if (response.status === 401 || response.status === 404) return;
      if (response.ok) {
        errors = 0;
        const next = (await response.json()) as JobView;
        onChange(next);
        if (!isInProgress(next.status)) return;
        continue;
      }
    } catch {
      // The page closed, or the network failed. After a close the next pass ends the loop.
    }
    errors += 1;
    if (errors >= MAX_ERRORS_IN_A_ROW) {
      onError();
      return;
    }
  }
}

/**
 * Keeps the state of one job current while the job waits or runs. It stops when the job is done or failed,
 * or after 5 failed requests in a row. Then `stalled` is true.
 */
export function useJobStatus(jobId: string, initial: JobView): { job: JobView; stalled: boolean } {
  const [job, setJob] = useState(initial);
  const [stalled, setStalled] = useState(false);
  const inProgress = isInProgress(job.status);

  useEffect(() => {
    if (!inProgress) return;
    const controller = new AbortController();
    void pollJob(jobId, controller.signal, setJob, () => {
      setStalled(true);
    });
    return () => {
      controller.abort();
    };
  }, [jobId, inProgress]);

  return { job, stalled };
}
