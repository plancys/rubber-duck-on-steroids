import assert from "node:assert/strict";
import { test } from "node:test";
import { findQuote } from "./quote.ts";

const passage = "Repeatable read is an isolation level.\nEach read in a transaction\n  gives the same   result.";

test("an exact quote gives its start offset in the passage", () => {
  assert.equal(findQuote(passage, "an isolation level"), passage.indexOf("an isolation level"));
  assert.equal(findQuote(passage, "Repeatable read"), 0);
});

test("each run of white space counts as one space", () => {
  assert.equal(findQuote(passage, "level. Each read"), passage.indexOf("level."));
  assert.equal(findQuote(passage, "transaction gives the same result."), passage.indexOf("transaction"));
  assert.equal(findQuote(passage, "the  same\n\tresult"), passage.indexOf("the same"));
});

test("white space at both ends of a quote does not count", () => {
  assert.equal(findQuote(passage, "  isolation level \n"), passage.indexOf("isolation level"));
});

test("a quote that the passage does not hold gives null", () => {
  assert.equal(findQuote(passage, "Serializable is an isolation level"), null);
  assert.equal(findQuote(passage, "repeatable read"), null);
  assert.equal(findQuote(passage, "isolationlevel"), null);
});

test("an empty quote gives null", () => {
  assert.equal(findQuote(passage, ""), null);
  assert.equal(findQuote(passage, " \n "), null);
});
