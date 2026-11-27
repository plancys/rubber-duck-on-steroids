// The passage splitter: it cuts the Markdown of a lesson into passages with stable keys.
// A passage is one heading section of level 1 to 3. Deeper headings stay inside their section.
// The text before the first heading is a passage with an empty heading path.
// A heading with no body text gives no passage. Its title stays in the heading path of its children.
// The parser reads code blocks, so a "#" line inside a code block is not a section border.

import { createHash } from "node:crypto";
import { fromMarkdown } from "mdast-util-from-markdown";

// The deepest heading level that starts a passage.
export const MAX_SECTION_DEPTH = 3;

export interface Passage {
  // The place of the passage in the lesson. The first passage has position 1.
  position: number;
  // The reference that the engine request uses, for example P1.
  ref: string;
  // The titles of the headings above the passage, from level 1 down. Empty for the text before the first heading.
  headingPath: string[];
  // The passage text is lessonText.slice(startOffset, endOffset).
  startOffset: number;
  endOffset: number;
  text: string;
  // The SHA-256 of the passage text, as hex.
  contentHash: string;
}

// A node of the Markdown tree, with only the fields that the title needs.
interface TitleNode {
  readonly type: string;
  readonly value?: string;
  readonly children?: readonly TitleNode[];
}

interface Border {
  start: number;
  end: number;
  depth: number;
  title: string;
}

// The plain text of a heading: the text and the code of its children, with no Markdown marks and no HTML.
function plainText(node: TitleNode): string {
  if (node.type === "html") return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(plainText).join("");
}

export function passageRef(position: number): string {
  return `P${position}`;
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// The headings of level 1 to 3 at the top level of the lesson, in text order.
function sectionBorders(markdown: string): Border[] {
  const borders: Border[] = [];
  for (const node of fromMarkdown(markdown).children) {
    if (node.type !== "heading" || node.depth > MAX_SECTION_DEPTH) continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    borders.push({ start, end, depth: node.depth, title: plainText(node).replace(/\s+/g, " ").trim() });
  }
  return borders;
}

export function splitLesson(markdown: string): Passage[] {
  const passages: Passage[] = [];

  // Add the text between two offsets as a passage, without the white space at both ends.
  const add = (from: number, to: number, headingPath: string[]): void => {
    const raw = markdown.slice(from, to);
    const text = raw.trim();
    if (!text) return;
    const startOffset = from + (raw.length - raw.trimStart().length);
    const position = passages.length + 1;
    passages.push({
      position,
      ref: passageRef(position),
      headingPath,
      startOffset,
      endOffset: startOffset + text.length,
      text,
      contentHash: hashText(text),
    });
  };

  const borders = sectionBorders(markdown);
  add(0, borders.at(0)?.start ?? markdown.length, []);
  // path[level - 1] holds the title of the last heading of that level.
  const path: (string | undefined)[] = [];
  borders.forEach((border, index) => {
    path.length = border.depth - 1;
    path[border.depth - 1] = border.title;
    const headingPath = path.filter((title): title is string => Boolean(title));
    add(border.end, borders.at(index + 1)?.start ?? markdown.length, headingPath);
  });
  return passages;
}
