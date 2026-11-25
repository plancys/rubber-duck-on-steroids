/// <reference types="chrome" />
// The popup: the settings, the start of a course on the open page, the count of saved pages, and Stop.

import { errorText, normalizeBaseUrl, startCourse, type ErrorKey, type Settings } from "./api.ts";
import { courseScope } from "./rules.ts";
import {
  COURSE_KEY,
  clearCourse,
  getCourse,
  getSettings,
  setCourse,
  setSettings,
  type RunningCourse,
} from "./storage.ts";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The popup has no element #${id}.`);
  return found;
}

const courseIdle = element("course-idle");
const courseRunning = element("course-running");
const courseName = element("course-name");
const courseCount = element("course-count");
const courseMessage = element("course-message");
const startButton = element("start-button") as HTMLButtonElement;
const stopButton = element("stop-button") as HTMLButtonElement;
const settingsForm = element("settings-form") as HTMLFormElement;
const baseUrlInput = element("base-url") as HTMLInputElement;
const tokenInput = element("token") as HTMLInputElement;
const settingsMessage = element("settings-message");

// The popup reads the tab and the settings when it opens. The click handler of Start must ask for the site
// permission before any other wait, because Chrome accepts the request only during the click.
let activeTab: chrome.tabs.Tab | undefined;
let settings: Settings | null = null;

function showMessage(target: HTMLElement, text: string, isError: boolean): void {
  target.textContent = text;
  target.classList.toggle("error", isError);
}

function showCourse(course: RunningCourse | null): void {
  courseIdle.hidden = course !== null;
  courseRunning.hidden = course === null;
  if (!course) return;
  courseName.textContent = course.name;
  const count = course.savedUrls.length;
  courseCount.textContent = `${count} ${count === 1 ? "page" : "pages"} saved in this run.`;
  if (course.error) {
    showMessage(courseMessage, errorText(course.error), true);
  } else {
    showMessage(courseMessage, "", false);
  }
}

function showError(key: ErrorKey): void {
  showMessage(courseMessage, errorText(key), true);
}

async function begin(tab: chrome.tabs.Tab, current: Settings, origin: string): Promise<void> {
  const scope = courseScope(tab.url ?? "");
  if (!scope) {
    showError("bad_page");
    return;
  }
  const title = tab.title?.trim() ? tab.title.trim() : null;
  const result = await startCourse(current, scope.startUrl, title);
  if (!result.ok) {
    // The learner did not start a course, so the site permission is not needed.
    await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => false);
    showError(result.error);
    return;
  }
  await setCourse({ ...scope, id: result.data.courseId, name: title ?? scope.startUrl, savedUrls: [], error: null });
}

startButton.addEventListener("click", () => {
  showMessage(courseMessage, "", false);
  const current = settings;
  if (!current) {
    showError("no_settings");
    return;
  }
  const tab = activeTab;
  const scope = courseScope(tab?.url ?? "");
  if (!tab || !scope) {
    showError("bad_page");
    return;
  }
  startButton.disabled = true;
  // The permission covers only the site of the course. The learner grants it here, once for each course.
  chrome.permissions
    .request({ origins: [`${scope.origin}/*`] })
    .then(async (granted) => {
      if (!granted) {
        showError("denied");
        return;
      }
      await begin(tab, current, scope.origin);
    })
    .catch(() => {
      showError("unknown");
    })
    .finally(() => {
      startButton.disabled = false;
    });
});

stopButton.addEventListener("click", () => {
  void (async () => {
    const course = await getCourse();
    await clearCourse();
    // The extension no longer needs the site after the course stops.
    if (course) await chrome.permissions.remove({ origins: [`${course.origin}/*`] }).catch(() => false);
    showMessage(courseMessage, "The course stopped. The saved pages stay in the product.", false);
  })();
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const baseUrl = normalizeBaseUrl(baseUrlInput.value);
  if (!baseUrl) {
    showMessage(settingsMessage, errorText("bad_address"), true);
    return;
  }
  // An empty token field keeps the saved token. The popup never shows a saved token.
  const token = tokenInput.value.trim() || (settings?.token ?? "");
  if (!token) {
    showMessage(settingsMessage, errorText("no_settings"), true);
    return;
  }
  const next = { baseUrl, token };
  void setSettings(next).then(() => {
    settings = next;
    baseUrlInput.value = baseUrl;
    tokenInput.value = "";
    tokenInput.placeholder = "A token is saved";
    tokenInput.required = false;
    showMessage(settingsMessage, "Settings saved.", false);
  });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !(COURSE_KEY in changes)) return;
  void getCourse().then(showCourse);
});

void (async () => {
  [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  settings = await getSettings();
  if (settings) {
    baseUrlInput.value = settings.baseUrl;
    tokenInput.placeholder = "A token is saved";
    tokenInput.required = false;
  }
  showCourse(await getCourse());
})();
