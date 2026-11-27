// The quote check: it proves that a quote of the model is in its passage.
// Each run of white space counts as one space, in the passage and in the quote.
// The match is exact in all other respects: the case, the punctuation and the Markdown marks must be the same.

const WHITE_SPACE = /\s/;

// Returns the start offset of the quote in the passage text, or null when the passage does not hold the quote.
export function findQuote(passageText: string, quote: string): number | null {
  const wanted = quote.replace(/\s+/g, " ").trim();
  if (!wanted) return null;
  // Collapse each run of white space in the passage to one space.
  // offsets[i] is the passage offset of character i of the collapsed text.
  let collapsed = "";
  const offsets: number[] = [];
  let inSpace = false;
  for (let index = 0; index < passageText.length; index += 1) {
    const character = passageText.charAt(index);
    if (WHITE_SPACE.test(character)) {
      if (!inSpace) {
        collapsed += " ";
        offsets.push(index);
      }
      inSpace = true;
    } else {
      collapsed += character;
      offsets.push(index);
      inSpace = false;
    }
  }
  const found = collapsed.indexOf(wanted);
  if (found === -1) return null;
  return offsets.at(found) ?? null;
}
