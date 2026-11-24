// The conversion of a lesson page to Markdown: Readability finds the main text, then Turndown writes it as Markdown.

import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  hr: "---",
});

// A link with no text, such as the anchor link before a heading (<a href="#part"></a>), adds only "[](#part)".
// The rule drops the link and keeps its content. A link with text keeps its Markdown link.
turndown.addRule("linkWithoutText", {
  filter: (node) => node.nodeName === "A" && !node.textContent.trim(),
  replacement: (content) => content,
});

// The longest title that the worker stores.
const MAX_TITLE_LENGTH = 300;

export interface PageText {
  // The title that Readability finds, or null.
  title: string | null;
  markdown: string;
}

// One line of text without extra spaces, or null when nothing is left.
export function cleanText(value: string | null | undefined, maxLength = MAX_TITLE_LENGTH): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

// Convert HTML to Markdown with ATX headings and fenced code blocks.
export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html).trim();
}

// Read the main text of a page as Markdown. Returns null when the page has no readable text.
// Readability changes the document, so the caller must not use it afterwards.
export function pageToMarkdown(document: Document): PageText | null {
  // keepClasses keeps the language-* class of a code block, so the code fence names the language.
  const article = new Readability(document, { keepClasses: true }).parse();
  const markdown = article?.content ? htmlToMarkdown(article.content) : "";
  if (!markdown) return null;
  return { title: cleanText(article?.title), markdown };
}
