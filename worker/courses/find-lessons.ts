// The lesson finder: it picks the lesson links of a course and their order from the links of the start page.
// The model picks them when the worker has a key. Without the key, or when the call fails or returns nothing valid,
// the rule picks them: the links whose path starts with the path of the start page, in page order.

import { MAX_PICKED, type LessonPicker } from "../llm.ts";
import type { Link, StartPage } from "./crawl.ts";

export const MAX_LESSONS = MAX_PICKED;

export interface FoundLessons {
  lessons: Link[];
  source: "model" | "rule";
  // The token counts of the model call, when the worker made one.
  inputTokens?: number;
  outputTokens?: number;
  // Why the rule picked the lessons although the worker has a key. It never holds the prompt.
  fallback?: string;
}

// The path without a trailing slash. The root path becomes "".
function trimPath(url: string): string {
  return new URL(url).pathname.replace(/\/+$/, "");
}

// The links under the path of the start page, in page order, at most 200.
export function ruleLessons(page: StartPage): Link[] {
  const base = trimPath(page.url);
  return page.links.filter((link) => trimPath(link.url).startsWith(`${base}/`)).slice(0, MAX_LESSONS);
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}

export async function findLessons(
  page: StartPage,
  picker: LessonPicker | null,
  signal: AbortSignal,
): Promise<FoundLessons> {
  if (!picker || page.links.length === 0) return { lessons: ruleLessons(page), source: "rule" };
  try {
    const answer = await picker.pickLessons({ title: page.title, url: page.url, links: page.links }, signal);
    const usage = { inputTokens: answer.inputTokens, outputTokens: answer.outputTokens };
    const lessons = (answer.indexes ?? []).flatMap((index) => page.links[index] ?? []).slice(0, MAX_LESSONS);
    if (lessons.length > 0) return { lessons, source: "model", ...usage };
    return { lessons: ruleLessons(page), source: "rule", ...usage, fallback: "The model answer has no valid lesson." };
  } catch (error) {
    // A stop of the job is not a failed call.
    signal.throwIfAborted();
    return { lessons: ruleLessons(page), source: "rule", fallback: errorText(error) };
  }
}
