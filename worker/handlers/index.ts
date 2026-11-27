// The handler of each job type. A new job type adds one entry here and its name to the type check of the jobs table.

import type { Handler } from "../run.ts";
import { createBuildTopicMap, type BuildTopicMapOptions } from "./build-topic-map.ts";
import { demo } from "./demo.ts";
import { createLoadCourse, type LoadCourseOptions } from "./load-course.ts";

export interface HandlerOptions {
  // The demo job is only for checks. Production keeps it off, so a demo row from the REST API fails at once.
  allowDemo: boolean;
  // The course calls, the lesson picker and the log of the load_course job.
  loadCourse: LoadCourseOptions;
  // The topic calls, the engine client and the log of the build_topic_map job.
  buildTopicMap: BuildTopicMapOptions;
}

export function createHandlers(options: HandlerOptions): ReadonlyMap<string, Handler> {
  const entries: [string, Handler][] = [
    ["load_course", createLoadCourse(options.loadCourse)],
    // The job is always available. Without an engine address it fails with a safe reason.
    ["build_topic_map", createBuildTopicMap(options.buildTopicMap)],
  ];
  if (options.allowDemo) entries.push(["demo", demo]);
  return new Map(entries);
}
