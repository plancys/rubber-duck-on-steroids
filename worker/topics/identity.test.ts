import assert from "node:assert/strict";
import { test } from "node:test";
import type { StoredTopic } from "../queue.ts";
import { groupTopics, knownTopicsFor, newTopicId, normalizeName, textWords, type LessonNames } from "./identity.ts";

function stored(id: string, name: string, aliases: string[] = [], extra: Partial<StoredTopic> = {}): StoredTopic {
  return {
    id,
    name,
    description: null,
    merged_into: null,
    retired_at: null,
    created_at: "2026-11-27T10:00:00+00:00",
    home_lesson_url: null,
    aliases: [name, ...aliases].map((alias) => ({ alias, normalized: normalizeName(alias) })),
    ...extra,
  };
}

function lesson(position: number, ...topics: [string, string | null][]): LessonNames {
  return { position, topics: topics.map(([name, sameAs]) => ({ name, sameAs })) };
}

test("the name rule uses NFKC, lower case, one space, and no marks at both ends", () => {
  assert.equal(normalizeName("  MergeTree\t table\n engine "), "mergetree table engine");
  assert.equal(normalizeName("ＭｅｒｇｅTree"), "mergetree");
  assert.equal(normalizeName("“MergeTree”."), "mergetree");
  assert.equal(normalizeName("'Primary key':"), "primary key");
  assert.equal(normalizeName("..."), "");
});

test("the name rule keeps the symbols that make a name, so C++ and C# stay two names", () => {
  assert.equal(normalizeName("C++"), "c++");
  assert.equal(normalizeName("C#"), "c#");
  assert.equal(normalizeName(".NET"), ".net");
});

test("two names that differ in case and white space are one topic, and a plural form stays a second topic", () => {
  const lessons = [lesson(1, ["Primary key", null]), lesson(2, ["primary   KEY", null], ["Primary keys", null])];
  const { groups, candidateGroup } = groupTopics([], lessons);
  assert.equal(groups.length, 2);
  assert.equal(candidateGroup[0]?.[0], candidateGroup[1]?.[0]);
  assert.notEqual(candidateGroup[1]?.[0], candidateGroup[1]?.[1]);
});

test("a sameAs name joins the candidate to the known topic, and a similar name with no sameAs stays apart", () => {
  const lessons = [
    lesson(1, ["MergeTree", null]),
    lesson(2, ["MergeTree table engine", "MergeTree"], ["ReplacingMergeTree", null]),
  ];
  const { groups } = groupTopics([], lessons);
  assert.deepEqual(
    groups.map((group) => [...group.names.values()]),
    [["MergeTree", "MergeTree table engine"], ["ReplacingMergeTree"]],
  );
});

test("the alias names of a stored topic hold the candidates of all its names together", () => {
  const topic = stored("00000000-0000-4000-8000-000000000001", "MergeTree", ["MergeTree table engine"]);
  const lessons = [lesson(3, ["MergeTree table engine", null]), lesson(4, ["mergetree", null])];
  const { groups } = groupTopics([topic], lessons);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.stored, [topic]);
  assert.equal(groups[0]?.candidates.length, 2);
});

test("two stored topics that a sameAs joins are one group, and the older topic comes first", () => {
  const newer = stored("00000000-0000-4000-8000-00000000000b", "Sorting key", [], {
    created_at: "2026-11-27T11:00:00+00:00",
  });
  const older = stored("00000000-0000-4000-8000-00000000000a", "ORDER BY key");
  const { groups } = groupTopics([newer, older], [lesson(1, ["Sorting key", "ORDER BY key"])]);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]?.stored.map((topic) => topic.id),
    [older.id, newer.id],
  );
});

test("the names of a merged topic lead to the topic that replaced it", () => {
  const kept = stored("00000000-0000-4000-8000-00000000000a", "Granule");
  const merged = stored("00000000-0000-4000-8000-00000000000b", "Granules", [], { merged_into: kept.id });
  const { groups } = groupTopics([kept, merged], [lesson(2, ["granules", null])]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.stored, [kept]);
  assert.deepEqual(groups[0]?.merged, [merged]);
});

test("a new topic id comes from the course and the name, and it skips an id that is taken", () => {
  const first = newTopicId("course-1", "mergetree", new Set());
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(newTopicId("course-1", "mergetree", new Set()), first);
  assert.notEqual(newTopicId("course-2", "mergetree", new Set()), first);
  assert.notEqual(newTopicId("course-1", "mergetree", new Set([first])), first);
});

test("the words of a text have at least 3 letters", () => {
  assert.deepEqual([...textWords("A MergeTree is an engine of ClickHouse 25.")], ["mergetree", "engine", "clickhouse"]);
});

test("the known topics share a word with the text, come in lesson order, and stop at the limit", () => {
  const retired = stored("00000000-0000-4000-8000-000000000009", "Skipping index", ["Data skipping index"]);
  const lessons = [
    lesson(2, ["Granule", null], ["Primary key", null]),
    lesson(1, ["MergeTree", null], ["Partition", null]),
  ];
  const grouping = groupTopics([retired], lessons);
  const text = "The primary key of a MergeTree table selects the granules to skip. Skipping index.";
  assert.deepEqual(knownTopicsFor(grouping, lessons, text), [
    { ref: 1, name: "MergeTree", aliases: [] },
    { ref: 2, name: "Primary key", aliases: [] },
    { ref: 3, name: "Skipping index", aliases: ["Data skipping index"] },
  ]);
  assert.deepEqual(
    knownTopicsFor(grouping, lessons, text, 2).map((topic) => topic.name),
    ["MergeTree", "Primary key"],
  );
});
