/// <reference types="chrome" />
// The state of the extension in chrome.storage.local: the settings, and the course that runs now.

import type { ErrorKey, Settings } from "./api.ts";
import type { CourseScope } from "./rules.ts";

/** The course that runs now. The extension saves the pages of one course at a time. */
export interface RunningCourse extends CourseScope {
  id: string;
  name: string;
  // The pages that this run saved, in the form of pageKey, in the order of the saves.
  savedUrls: string[];
  // The last error of a page save, or null.
  error: ErrorKey | null;
}

const SETTINGS_KEY = "settings";
export const COURSE_KEY = "course";

export async function getSettings(): Promise<Settings | null> {
  const items = await chrome.storage.local.get(SETTINGS_KEY);
  const value = items[SETTINGS_KEY] as Partial<Settings> | undefined;
  if (typeof value?.baseUrl !== "string" || typeof value.token !== "string") return null;
  if (!value.baseUrl || !value.token) return null;
  return { baseUrl: value.baseUrl, token: value.token };
}

export async function setSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getCourse(): Promise<RunningCourse | null> {
  const items = await chrome.storage.local.get(COURSE_KEY);
  const value = items[COURSE_KEY] as Partial<RunningCourse> | undefined;
  return typeof value?.id === "string" ? (value as RunningCourse) : null;
}

export async function setCourse(course: RunningCourse): Promise<void> {
  await chrome.storage.local.set({ [COURSE_KEY]: course });
}

export async function clearCourse(): Promise<void> {
  await chrome.storage.local.remove(COURSE_KEY);
}
