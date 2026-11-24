// The handler of each job type. A new job type adds one entry here and its name to the type check of the jobs table.

import type { Handler } from "../run.ts";
import { demo } from "./demo.ts";

export const handlers: ReadonlyMap<string, Handler> = new Map([["demo", demo]]);
