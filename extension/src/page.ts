/// <reference types="chrome" />
// The read of an open page: the service worker injects content.js into the tab, then calls the function it defines.

/** The page that content.js reads in the tab. */
export interface PageResult {
  url: string;
  title: string | null;
  markdown: string;
}

export type ReadPage = () => PageResult | null;

/**
 * Converts the page in the tab to Markdown, in the tab. It needs the host permission for the site of the tab.
 * Returns null when the page has no readable text. Throws when Chrome cannot inject the script.
 */
export async function readPageInTab(tabId: number): Promise<PageResult | null> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    // Chrome sends this function to the tab as text. It can use only what content.js defines there.
    func: () => (globalThis as { rubberDuckReadPage?: ReadPage }).rubberDuckReadPage?.() ?? null,
  });
  const result: unknown = results.at(0)?.result;
  return isPageResult(result) ? result : null;
}

function isPageResult(value: unknown): value is PageResult {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  return (
    typeof page.url === "string" &&
    typeof page.markdown === "string" &&
    (page.title === null || typeof page.title === "string")
  );
}
