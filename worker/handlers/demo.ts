// The demo job. It does no real work. It proves the path from a job row to a result.
// The payload is { steps, stepSeconds, failTimes }. demoSettings in rules.ts puts each value inside its limit.

import { setTimeout as delay } from "node:timers/promises";
import { demoSettings } from "../rules.ts";
import { SafeError, type Handler } from "../run.ts";

export const demo: Handler = async ({ payload, attempt, step, signal }) => {
  const { steps, stepSeconds, failTimes } = demoSettings(payload);
  for (let index = 1; index <= steps; index += 1) {
    await step(index, steps, `Step ${index} of ${steps}`);
    await delay(stepSeconds * 1_000, undefined, { signal });
  }
  // The first failTimes starts fail on purpose. This shows the retry path.
  if (attempt <= failTimes) {
    throw new SafeError(`The demo failed on purpose in attempt ${attempt}.`);
  }
  return { steps };
};
