// The decisions of the worker as pure functions. The unit tests check each one.

import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";

// The wait before the worker records a failed start: 5 seconds for each start so far.
export function retryWaitMs(attempt: number): number {
  return Math.max(0, attempt) * 5_000;
}

// True only when the Authorization header holds the wake secret as a bearer token.
// The comparison takes the same time for each wrong value of the same length, so the reply time tells nothing.
export function isWakeAuthorized(header: string | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  // timingSafeEqual needs two values of the same length.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface DemoSettings {
  steps: number;
  stepSeconds: number;
  failTimes: number;
}

// Read the demo values from a payload and put each value inside its limit.
// A missing value, or a value that is not a number, gets the default.
export function demoSettings(payload: unknown): DemoSettings {
  const values: Record<string, unknown> = isRecord(payload) ? payload : {};
  return {
    steps: limit(values.steps, 1, 10, 5),
    stepSeconds: limit(values.stepSeconds, 0, 5, 2),
    failTimes: limit(values.failTimes, 0, 3, 0),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Round a number to a whole number between min and max. Each other value gets the fallback.
function limit(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
