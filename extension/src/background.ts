/// <reference types="chrome" />
// The service worker. While a course runs, it saves each course page that the learner opens.
// It reads only a page that the learner opens in a tab. It never fetches a page by itself.

import { savePage, type ErrorKey } from "./api.ts";
import { readPageInTab } from "./page.ts";
import { isCoursePage, isNewPage, pageKey } from "./rules.ts";
import { getCourse, getSettings, setCourse } from "./storage.ts";

// One save at a time, in the order in which the pages finish loading. So the lessons keep the order of the learner,
// and two saves cannot both pass the once-per-URL check.
let queue: Promise<void> = Promise.resolve();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Chrome gives tab.url only for a site with the host permission, so the extension sees only the course site.
  if (changeInfo.status !== "complete" || !tab.url) return;
  const url = tab.url;
  queue = queue.then(() => saveOpenPage(tabId, url)).catch(() => undefined);
});

async function saveOpenPage(tabId: number, url: string): Promise<void> {
  const course = await getCourse();
  if (!course || !isCoursePage(course, url) || !isNewPage(course.savedUrls, url)) return;

  const settings = await getSettings();
  if (!settings) {
    await setError(course.id, "no_settings");
    return;
  }

  let page;
  try {
    page = await readPageInTab(tabId);
  } catch {
    await setError(course.id, "read_failed");
    return;
  }
  if (!page) {
    await setError(course.id, "no_text");
    return;
  }

  // The tab can move on while the page converts. Use the URL of the document that the script read.
  const key = pageKey(page.url);
  if (key === null || !isCoursePage(course, key) || !isNewPage(course.savedUrls, key)) return;

  const result = await savePage(settings, {
    courseId: course.id,
    url: key,
    title: page.title,
    markdown: page.markdown,
  });

  // The learner can stop the course or start another one during the save. Then this result does not count.
  const current = await getCourse();
  if (current?.id !== course.id) return;
  if (result.ok) {
    await setCourse({ ...current, savedUrls: [...current.savedUrls, key], error: null });
  } else {
    await setCourse({ ...current, error: result.error });
  }
}

async function setError(courseId: string, error: ErrorKey): Promise<void> {
  const current = await getCourse();
  if (current?.id === courseId) await setCourse({ ...current, error });
}
