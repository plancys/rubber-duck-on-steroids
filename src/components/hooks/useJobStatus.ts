import { useEffect, useState } from "react";
import type { JobView } from "@/lib/jobs";

const POLL_INTERVAL_MS = 3_000;

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
async function pollJob(jobId: string, signal: AbortSignal, onChange: (job: JobView) => void): Promise<void> {
  // The loop ends with a return: on an abort, at the end of the job, or when the job cannot be read.
  for (;;) {
    await wait(POLL_INTERVAL_MS, signal);
    if (signal.aborted) return;
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal });
      // Without a session, or without access to the job, more requests cannot succeed.
      if (response.status === 401 || response.status === 404) return;
      if (response.ok) {
        const next = (await response.json()) as JobView;
        onChange(next);
        if (!isInProgress(next.status)) return;
      }
    } catch {
      // The page closed, or the network failed. The loop tries again, unless the page closed.
    }
  }
}

/** Keeps the state of one job current while the job waits or runs. It stops when the job is done or failed. */
export function useJobStatus(jobId: string, initial: JobView): JobView {
  const [job, setJob] = useState(initial);
  const inProgress = isInProgress(job.status);

  useEffect(() => {
    if (!inProgress) return;
    const controller = new AbortController();
    void pollJob(jobId, controller.signal, setJob);
    return () => {
      controller.abort();
    };
  }, [jobId, inProgress]);

  return job;
}
