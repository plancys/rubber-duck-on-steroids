// Rules and texts of the background jobs. The worker in worker/ does the work. This module is for the web app.
// Do not import from worker/: its modules use Node APIs, and the web app runs on workerd.
// Client code imports only the types of this module, because the wake request reads server secrets.

import { WORKER_WAKE_SECRET, WORKER_WAKE_URL } from "astro:env/server";
import { waitUntil } from "cloudflare:workers";
import type { Json, Tables } from "@/db/database.types";

/** The database functions mark a job failed at its fourth start, so a job has 3 attempts. */
export const JOB_MAX_ATTEMPTS = 3;

/** The columns of a job view. The lease columns, the payload and the owner stay in the database. */
export const JOB_VIEW_COLUMNS =
  "id, type, status, step_index, step_count, step_label, attempts, error, result, updated_at";

export type JobViewRow = Pick<
  Tables<"jobs">,
  "id" | "type" | "status" | "step_index" | "step_count" | "step_label" | "attempts" | "error" | "result" | "updated_at"
>;

/** The state of one job, as the page and GET /api/jobs/<id> show it. */
export interface JobView {
  id: string;
  type: string;
  status: "waiting" | "running" | "done" | "failed";
  stepIndex: number;
  stepCount: number;
  stepLabel: string | null;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  result: Json | null;
  updatedAt: string;
}

/** Maps a database row to a job view. */
export function toJobView(row: JobViewRow): JobView {
  return {
    id: row.id,
    type: row.type,
    // The check jobs_status_check allows only these four values.
    status: row.status as JobView["status"],
    stepIndex: row.step_index,
    stepCount: row.step_count,
    stepLabel: row.step_label,
    attempts: row.attempts,
    maxAttempts: JOB_MAX_ATTEMPTS,
    error: row.error,
    result: row.result,
    updatedAt: row.updated_at,
  };
}

/** The limits of the demo payload. They match demoSettings in worker/rules.ts. */
export const DEMO_LIMITS = {
  steps: { min: 1, max: 10, fallback: 5 },
  stepSeconds: { min: 0, max: 5, fallback: 2 },
  failTimes: { min: 0, max: 3, fallback: 0 },
} as const;

export interface DemoPayload {
  steps: number;
  stepSeconds: number;
  failTimes: number;
}

/** Reads the demo values from the form and puts each value inside its limit. A missing value gets the default. */
export function parseDemoForm(form: FormData): DemoPayload {
  return {
    steps: limitField(form, "steps"),
    stepSeconds: limitField(form, "stepSeconds"),
    failTimes: limitField(form, "failTimes"),
  };
}

function limitField(form: FormData, name: keyof DemoPayload): number {
  const { min, max, fallback } = DEMO_LIMITS[name];
  const raw = form.get(name);
  // Number("") is 0, so an empty field must get the default before the conversion.
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true when the value is a UUID. A route uses it to skip the query for a bad id. */
export function isJobId(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** A job in progress that did not change for this time gets another wake request. */
const STALE_JOB_MS = 30_000;

/**
 * True when the job waits or runs, and did not change for more than 30 seconds.
 * A lost wake request then gets a second chance.
 */
export function needsWake(row: Pick<JobViewRow, "status" | "updated_at">, now: Date): boolean {
  if (row.status !== "waiting" && row.status !== "running") return false;
  return now.getTime() - Date.parse(row.updated_at) > STALE_JOB_MS;
}

const WAKE_TIMEOUT_MS = 5_000;

/**
 * Tells the worker to look for jobs. The response does not wait for the request, and the function never throws.
 * Without WORKER_WAKE_URL or WORKER_WAKE_SECRET it does nothing. The job table keeps the job in each case.
 */
export function wakeWorker(): void {
  if (!WORKER_WAKE_URL || !WORKER_WAKE_SECRET) return;
  try {
    waitUntil(sendWake(WORKER_WAKE_URL, WORKER_WAKE_SECRET));
  } catch {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn("The wake request could not start.");
  }
}

async function sendWake(url: string, secret: string): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
    });
    if (!response.ok) {
      // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
      console.warn(`The worker returned HTTP ${response.status} for the wake request.`);
    }
  } catch {
    // eslint-disable-next-line no-console -- the warning is the only signal in Workers Logs
    console.warn("The wake request failed or timed out. The job waits until the worker looks for jobs.");
  }
}

export type JobErrorKey = "job_active" | "not_available" | "not_configured" | "unknown";

const JOB_ERROR_TEXTS: Record<JobErrorKey, string> = {
  job_active: "You already have a job in progress. Wait until it ends.",
  not_available: "This job is not available.",
  not_configured: "Jobs are not available right now.",
  unknown: "Something went wrong. Try again.",
};

/** Maps an error key from the URL to a fixed text. Unknown keys give the generic text. */
export function jobErrorText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(JOB_ERROR_TEXTS, key)) {
    return JOB_ERROR_TEXTS[key as JobErrorKey];
  }
  return JOB_ERROR_TEXTS.unknown;
}
