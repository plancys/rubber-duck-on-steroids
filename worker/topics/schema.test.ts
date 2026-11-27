import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkAnswer,
  emptyRemovals,
  lessonResult,
  readStoredResult,
  type CheckKnownTopic,
  type CheckPassage,
  type SchemaReason,
} from "./schema.ts";

const PASSAGES: CheckPassage[] = [
  { ref: "P1", position: 1, text: "The MergeTree engine stores data in parts." },
  { ref: "P2", position: 2, text: "ReplacingMergeTree removes duplicate rows\nduring merges." },
];
const KNOWN: CheckKnownTopic[] = [{ ref: 1, name: "ClickHouse", aliases: ["ClickHouse server"] }];

function topic(name: unknown, links: unknown[], extra: Record<string, unknown> = {}) {
  return { name, description: `About ${String(name)}.`, sameAs: null, links, ...extra };
}

function link(passage: string, quote: string, role = "explains") {
  return { passage, role, quote };
}

const MERGE_TREE = topic("MergeTree", [link("P1", "The MergeTree engine")]);
const REPLACING = topic("ReplacingMergeTree", [link("P2", "removes duplicate rows during merges")]);

// The removal counts with one reason set to a number.
function removed(reason: SchemaReason, count = 1) {
  return { ...emptyRemovals(), [reason]: count };
}

test("a valid answer keeps each topic, link and relation, with the passage position and the quote start", () => {
  const checked = checkAnswer(
    {
      topics: [MERGE_TREE, REPLACING],
      relations: [{ kind: "part_of", from: "ReplacingMergeTree", to: "MergeTree", reason: "A kind.", passage: "P2" }],
    },
    PASSAGES,
    KNOWN,
  );
  assert.deepEqual(checked.topics[1], {
    name: "ReplacingMergeTree",
    description: "About ReplacingMergeTree.",
    sameAs: null,
    links: [{ position: 2, role: "explains", quote: "removes duplicate rows during merges", quoteStart: 19 }],
  });
  assert.deepEqual(checked.relations, [
    { kind: "part_of", from: "ReplacingMergeTree", to: "MergeTree", reason: "A kind.", position: 2 },
  ]);
  assert.deepEqual(checked.schemaRemoved, emptyRemovals());
  assert.deepEqual(checked.quoteRemoved, { links: 0, topics: 0, relations: 0 });
});

test("the check removes a topic with an empty name", () => {
  const checked = checkAnswer(
    { topics: [topic("  ", [link("P1", "MergeTree")]), MERGE_TREE], relations: [] },
    PASSAGES,
    [],
  );
  assert.deepEqual(
    checked.topics.map((item) => item.name),
    ["MergeTree"],
  );
  assert.deepEqual(checked.schemaRemoved, removed("emptyName"));
});

test("the check removes an item that is not an object", () => {
  const checked = checkAnswer({ topics: ["MergeTree", MERGE_TREE], relations: [null] }, PASSAGES, []);
  assert.equal(checked.topics.length, 1);
  assert.deepEqual(checked.schemaRemoved, removed("invalidItem", 2));
});

test("the check removes a link with an unknown passage reference", () => {
  const item = topic("MergeTree", [link("P9", "The MergeTree engine"), link("P1", "The MergeTree engine")]);
  const checked = checkAnswer({ topics: [item], relations: [] }, PASSAGES, []);
  assert.equal(checked.topics[0]?.links.length, 1);
  assert.deepEqual(checked.schemaRemoved, removed("unknownPassage"));
});

test("the check removes a link with an unknown role", () => {
  const item = topic("MergeTree", [link("P1", "The MergeTree engine", "defines"), link("P1", "MergeTree", "mentions")]);
  const checked = checkAnswer({ topics: [item], relations: [] }, PASSAGES, []);
  assert.deepEqual(
    checked.topics[0]?.links.map((item) => item.role),
    ["mentions"],
  );
  assert.deepEqual(checked.schemaRemoved, removed("unknownRole"));
});

test("the check removes a link with a quote of more than 300 characters", () => {
  const long = "x".repeat(301);
  const passages = [{ ref: "P1", position: 1, text: `${long} MergeTree` }];
  const item = topic("MergeTree", [link("P1", long), link("P1", "MergeTree")]);
  const checked = checkAnswer({ topics: [item], relations: [] }, passages, []);
  assert.deepEqual(
    checked.topics[0]?.links.map((item) => item.quote),
    ["MergeTree"],
  );
  assert.deepEqual(checked.schemaRemoved, removed("quoteTooLong"));
});

test("the check resolves a sameAs reference to the known name, and removes a reference that the request did not hold", () => {
  const checked = checkAnswer(
    {
      topics: [
        topic("ClickHouse database", [link("P1", "MergeTree")], { sameAs: 1 }),
        topic("MergeTree", [link("P1", "MergeTree")], { sameAs: 7 }),
      ],
      relations: [],
    },
    PASSAGES,
    KNOWN,
  );
  assert.deepEqual(
    checked.topics.map((item) => item.sameAs),
    ["ClickHouse", null],
  );
  assert.deepEqual(checked.schemaRemoved, removed("unknownSameAs"));
});

test("the check removes a relation with an unknown kind", () => {
  const relation = { kind: "related_to", from: "MergeTree", to: "ReplacingMergeTree", reason: "", passage: "P1" };
  const checked = checkAnswer({ topics: [MERGE_TREE, REPLACING], relations: [relation] }, PASSAGES, []);
  assert.deepEqual(checked.relations, []);
  assert.deepEqual(checked.schemaRemoved, removed("unknownKind"));
});

test("the check removes a relation with an unknown passage reference", () => {
  const relation = { kind: "prerequisite", from: "MergeTree", to: "ReplacingMergeTree", reason: "", passage: "P5" };
  const checked = checkAnswer({ topics: [MERGE_TREE, REPLACING], relations: [relation] }, PASSAGES, []);
  assert.deepEqual(checked.relations, []);
  assert.deepEqual(checked.schemaRemoved, removed("unknownRelationPassage"));
});

test("a relation end names a topic of the answer or a known topic by its name or an alias name", () => {
  const relations = [
    { kind: "prerequisite", from: "clickhouse server", to: "mergetree", reason: "Server first.", passage: "P1" },
    { kind: "prerequisite", from: "MergeTree", to: "Projections", reason: "No such topic.", passage: "P1" },
  ];
  const checked = checkAnswer({ topics: [MERGE_TREE], relations }, PASSAGES, KNOWN);
  assert.deepEqual(checked.relations, [
    { kind: "prerequisite", from: "ClickHouse", to: "MergeTree", reason: "Server first.", position: 1 },
  ]);
  assert.deepEqual(checked.schemaRemoved, removed("unknownEnd"));
});

test("the quote check removes a wrong quote, the topic with no link left, and each relation to that topic", () => {
  const sql = topic("SQL", [link("P1", "SQL is a query language")]);
  const relations = [
    { kind: "part_of", from: "MergeTree", to: "SQL", reason: "Wrong.", passage: "P1" },
    { kind: "part_of", from: "ReplacingMergeTree", to: "MergeTree", reason: "A kind.", passage: "P2" },
  ];
  const quoted = topic("ReplacingMergeTree", [
    link("P2", "removes duplicate rows during merges"),
    link("P2", "removes all rows", "mentions"),
  ]);
  const checked = checkAnswer({ topics: [MERGE_TREE, sql, quoted], relations }, PASSAGES, []);
  assert.deepEqual(
    checked.topics.map((item) => [item.name, item.links.length]),
    [
      ["MergeTree", 1],
      ["ReplacingMergeTree", 1],
    ],
  );
  assert.deepEqual(
    checked.relations.map((item) => [item.from, item.to]),
    [["ReplacingMergeTree", "MergeTree"]],
  );
  assert.deepEqual(checked.quoteRemoved, { links: 2, topics: 1, relations: 1 });
  assert.deepEqual(checked.schemaRemoved, emptyRemovals());
});

test("a stored result reads back the same, and a result in another form reads as null", () => {
  const part = checkAnswer({ topics: [MERGE_TREE, REPLACING], relations: [] }, PASSAGES, []);
  const result = lessonResult(2, [part, part]);
  assert.equal(result.topics.length, 4);
  assert.deepEqual(readStoredResult(JSON.parse(JSON.stringify(result))), result);
  assert.equal(readStoredResult({ ...result, format: 0 }), null);
  assert.equal(readStoredResult({ ...result, passages: 1 }), null);
  assert.equal(readStoredResult(null), null);
});
