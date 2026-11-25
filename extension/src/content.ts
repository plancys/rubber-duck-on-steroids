// The page script. The service worker injects it into the open lesson page, in the isolated world of the extension.
// It defines one function on the global object, and a second injection calls it. The page sees neither.
// It reads only the document that the learner has open. It fetches nothing.

import { pageToMarkdown } from "./markdown.ts";
import type { ReadPage } from "./page.ts";

const readPage: ReadPage = () => {
  // Readability changes the document, so it reads a copy and the open page stays as it is.
  const copy = document.cloneNode(true) as Document;
  const page = pageToMarkdown(copy);
  if (!page) return null;
  return { url: location.href, title: page.title ?? (document.title.trim() || null), markdown: page.markdown };
};

(globalThis as { rubberDuckReadPage?: ReadPage }).rubberDuckReadPage = readPage;
