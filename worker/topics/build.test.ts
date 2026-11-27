import assert from "node:assert/strict";
import { test } from "node:test";
import type { MapTopic, StoredTopic } from "../queue.ts";
import { buildTopicMap, type BuildLesson, type LessonState, type RunFacts, type TopicMap } from "./build.ts";
import { normalizeName } from "./identity.ts";
import {
  emptyRemovals,
  RESULT_FORMAT,
  type LessonResult,
  type LinkRole,
  type RelationKind,
  type ResultRelation,
  type ResultTopic,
} from "./schema.ts";

const COURSE_ID = "0b7e2f0e-8d7a-4a51-9c1e-3f1f1d2a7c10";
const RUN: RunFacts = {
  analysed: 2,
  reused: 1,
  inputTokens: 100,
  outputTokens: 50,
  engine: "cognee-extract/1",
  promptVersion: "1",
  durationMs: 1234,
};

function url(position: number): string {
  return `https://docs.example/docs/lesson-${position}`;
}

// A candidate topic with one link for each [passage position, role] pair.
function topic(name: string, links: [number, LinkRole][], sameAs: string | null = null): ResultTopic {
  return {
    name,
    description: `About ${name}.`,
    sameAs,
    links: links.map(([position, role]) => ({ position, role, quote: `Quote of ${name}`, quoteStart: 0 })),
  };
}

function relation(kind: RelationKind, from: string, to: string, position = 1): ResultRelation {
  return { kind, from, to, reason: `${from} and ${to}.`, position };
}

function result(passages: number, topics: ResultTopic[], relations: ResultRelation[] = []): LessonResult {
  return {
    format: RESULT_FORMAT,
    passages,
    topics,
    relations,
    schemaRemoved: emptyRemovals(),
    quoteRemoved: { links: 0, topics: 0, relations: 0 },
  };
}

function lesson(position: number, lessonResult: LessonResult | null, state: LessonState = "analysed"): BuildLesson {
  return {
    url: url(position),
    position,
    title: `Lesson ${position}`,
    state,
    result: lessonResult,
    model: lessonResult ? "claude-haiku-5-5" : null,
  };
}

function build(lessons: BuildLesson[], topics: StoredTopic[] = []): TopicMap {
  return buildTopicMap({ courseId: COURSE_ID, lessons, topics, run: RUN });
}

function byName(map: TopicMap, name: string): MapTopic {
  const found = map.topics.find((item) => item.name === name);
  assert.ok(found, `The map has no topic ${name}.`);
  return found;
}

// The relations of the map as [kind, from name, to name].
function relationNames(map: TopicMap): [string, string, string][] {
  const names = new Map(map.topics.map((item) => [item.id, item.name]));
  return map.relations.map((item) => [
    item.kind,
    names.get(item.from_topic_id) ?? "",
    names.get(item.to_topic_id) ?? "",
  ]);
}

// The topics of a map as the database returns them on the next run.
function asStored(map: TopicMap, createdAt = "2026-11-27T10:00:00+00:00"): StoredTopic[] {
  return map.topics.map((item) => ({
    id: item.id,
    name: item.name,
    description: item.description,
    merged_into: item.merged_into,
    retired_at: item.retired ? createdAt : null,
    created_at: createdAt,
    home_lesson_url: item.home_lesson_url,
    aliases: item.aliases,
  }));
}

function storedTopic(id: string, name: string, createdAt: string): StoredTopic {
  return {
    id,
    name,
    description: `Stored ${name}.`,
    merged_into: null,
    retired_at: null,
    created_at: createdAt,
    home_lesson_url: null,
    aliases: [{ alias: name, normalized: normalizeName(name) }],
  };
}

test("MergeTree and MergeTree table engine with a sameAs are one topic with an alias name, and ReplacingMergeTree stays apart", () => {
  const map = build([
    lesson(1, result(1, [topic("MergeTree", [[1, "explains"]])])),
    lesson(
      2,
      result(1, [
        topic("MergeTree table engine", [[1, "mentions"]], "MergeTree"),
        topic("ReplacingMergeTree", [[1, "explains"]]),
      ]),
    ),
  ]);
  assert.equal(map.topics.length, 2);
  const mergeTree = byName(map, "MergeTree");
  assert.deepEqual(mergeTree.aliases, [
    { alias: "MergeTree", normalized: "mergetree" },
    { alias: "MergeTree table engine", normalized: "mergetree table engine" },
  ]);
  assert.equal(map.links.filter((link) => link.topic_id === mergeTree.id).length, 2);
  assert.notEqual(byName(map, "ReplacingMergeTree").id, mergeTree.id);
});

test("two names that differ in case and white space are one topic, and a plural form with no sameAs stays apart", () => {
  const map = build([
    lesson(1, result(1, [topic("Primary key", [[1, "explains"]])])),
    lesson(2, result(1, [topic("primary  KEY", [[1, "mentions"]]), topic("Primary keys", [[1, "mentions"]])])),
  ]);
  assert.deepEqual(map.topics.map((item) => item.name).sort(), ["Primary key", "Primary keys"]);
});

test("a topic with one mentions link in lesson 2 and one explains link in lesson 5 has lesson 5 as its home lesson", () => {
  const map = build([
    lesson(2, result(1, [topic("Granule", [[1, "mentions"]])])),
    lesson(5, result(1, [topic("Granule", [[1, "explains"]])])),
  ]);
  assert.equal(byName(map, "Granule").home_lesson_url, url(5));
});

test("a topic with only mentions links has the first of those lessons as its home lesson", () => {
  const map = build([
    lesson(4, result(1, [topic("SQL", [[1, "mentions"]])])),
    lesson(3, result(1, [topic("SQL", [[1, "mentions"]])])),
  ]);
  assert.equal(byName(map, "SQL").home_lesson_url, url(3));
});

test("a second parent is removed, and the first parent in lesson order stays", () => {
  const map = build([
    // The lessons come out of order on purpose. The build reads them in course order.
    lesson(
      2,
      result(
        1,
        [topic("Primary key", [[1, "explains"]]), topic("Granule", [[1, "mentions"]])],
        [relation("part_of", "Granule", "Primary key")],
      ),
    ),
    lesson(
      1,
      result(
        1,
        [topic("MergeTree", [[1, "explains"]]), topic("Granule", [[1, "explains"]])],
        [relation("part_of", "Granule", "MergeTree")],
      ),
    ),
  ]);
  assert.deepEqual(relationNames(map), [["part_of", "Granule", "MergeTree"]]);
  assert.equal(map.report.graphRemoved.secondParent, 1);
});

test("a part_of relation that closes a cycle is removed", () => {
  const map = build([
    lesson(
      1,
      result(
        2,
        [topic("Part", [[1, "explains"]]), topic("Whole", [[2, "explains"]])],
        [relation("part_of", "Part", "Whole", 1), relation("part_of", "Whole", "Part", 2)],
      ),
    ),
  ]);
  assert.deepEqual(relationNames(map), [["part_of", "Part", "Whole"]]);
  assert.equal(map.report.graphRemoved.partOfCycle, 1);
});

test("a prerequisite cycle loses the relation that points against the lesson order", () => {
  const map = build([
    lesson(1, result(1, [topic("SQL", [[1, "explains"]])], [relation("prerequisite", "Window functions", "SQL")])),
    lesson(
      2,
      result(
        1,
        [topic("Window functions", [[1, "explains"]]), topic("SQL", [[1, "mentions"]])],
        [relation("prerequisite", "SQL", "Window functions")],
      ),
    ),
  ]);
  // Window functions -> SQL comes first, but it points from lesson 2 back to lesson 1. So it goes.
  assert.deepEqual(relationNames(map), [["prerequisite", "SQL", "Window functions"]]);
  assert.equal(map.report.graphRemoved.prerequisiteCycle, 1);
  assert.deepEqual(map.report.prerequisites, { total: 1, againstLessonOrder: 0, share: 0 });
});

test("a prerequisite cycle in one lesson loses the relation from the later passage", () => {
  const map = build([
    lesson(
      1,
      result(
        2,
        [topic("Rows", [[1, "explains"]]), topic("Columns", [[2, "explains"]])],
        [relation("prerequisite", "Rows", "Columns", 1), relation("prerequisite", "Columns", "Rows", 2)],
      ),
    ),
  ]);
  assert.deepEqual(relationNames(map), [["prerequisite", "Rows", "Columns"]]);
});

test("a prerequisite relation between a child and its parent is removed", () => {
  const map = build([
    lesson(
      5,
      result(
        1,
        [topic("ClickHouse", [[1, "mentions"]]), topic("ReplacingMergeTree", [[1, "explains"]])],
        [
          relation("prerequisite", "ClickHouse", "ReplacingMergeTree"),
          relation("part_of", "ReplacingMergeTree", "ClickHouse"),
        ],
      ),
    ),
  ]);
  assert.deepEqual(relationNames(map), [["part_of", "ReplacingMergeTree", "ClickHouse"]]);
  assert.equal(map.report.graphRemoved.ancestorPrerequisite, 1);
});

test("a relation to an unknown topic, to a topic with no link, or of a topic to itself, is removed", () => {
  const retired = storedTopic("00000000-0000-4000-8000-00000000000d", "Projection", "2026-11-27T09:00:00+00:00");
  const map = build(
    [
      lesson(
        1,
        result(
          1,
          [topic("MergeTree", [[1, "explains"]]), topic("MergeTree engine", [[1, "mentions"]], "MergeTree")],
          [
            relation("prerequisite", "MergeTree", "MergeTree engine"),
            relation("prerequisite", "MergeTree", "Projections"),
            relation("prerequisite", "Projection", "MergeTree"),
          ],
        ),
      ),
    ],
    [retired],
  );
  assert.deepEqual(map.relations, []);
  assert.equal(map.report.graphRemoved.selfRelation, 1);
  assert.equal(map.report.graphRemoved.unknownTopic, 1);
  assert.equal(map.report.graphRemoved.topicWithoutLink, 1);
});

test("the same input gives the same output, and a second run keeps each topic id", () => {
  const lessons = [
    lesson(1, result(2, [topic("MergeTree", [[1, "explains"]]), topic("Partition", [[2, "explains"]])])),
    lesson(
      2,
      result(
        1,
        [topic("Granule", [[1, "explains"]]), topic("Partitions", [[1, "mentions"]], "Partition")],
        [relation("part_of", "Granule", "MergeTree"), relation("prerequisite", "Partition", "Granule")],
      ),
    ),
  ];
  const first = build(lessons);
  assert.deepEqual(build(lessons), first);
  const second = build(lessons, asStored(first));
  assert.deepEqual(second.topics, first.topics);
  assert.deepEqual(second.links, first.links);
  assert.deepEqual(second.relations, first.relations);
  assert.deepEqual(second.overview, first.overview);
});

test("when two stored topics become one, the older topic stays and the other gets merged_into", () => {
  const older = storedTopic("00000000-0000-4000-8000-00000000000a", "ORDER BY key", "2026-11-27T09:00:00+00:00");
  const newer = storedTopic("00000000-0000-4000-8000-00000000000b", "Sorting key", "2026-11-27T10:00:00+00:00");
  const map = build([lesson(1, result(1, [topic("Sorting key", [[1, "explains"]], "ORDER BY key")]))], [newer, older]);
  const kept = map.topics.find((item) => item.id === older.id);
  const merged = map.topics.find((item) => item.id === newer.id);
  assert.ok(kept && merged);
  assert.equal(kept.merged_into, null);
  assert.equal(kept.retired, false);
  assert.equal(kept.name, "ORDER BY key");
  assert.deepEqual(
    kept.aliases.map((alias) => alias.alias),
    ["ORDER BY key", "Sorting key"],
  );
  assert.equal(merged.merged_into, older.id);
  assert.deepEqual(
    map.links.map((link) => link.topic_id),
    [older.id],
  );
  assert.equal(map.report.topics.merged, 1);
});

test("a topic with no link left is retired and keeps its row, and it comes back with its old id", () => {
  const projection = storedTopic("00000000-0000-4000-8000-00000000000c", "Projection", "2026-11-27T09:00:00+00:00");
  const gone = build([lesson(1, result(1, [topic("MergeTree", [[1, "explains"]])]))], [projection]);
  assert.deepEqual(
    gone.topics.find((item) => item.id === projection.id),
    {
      id: projection.id,
      name: "Projection",
      description: "Stored Projection.",
      aliases: [{ alias: "Projection", normalized: "projection" }],
      home_lesson_url: null,
      merged_into: null,
      retired: true,
    },
  );
  const back = build([lesson(1, result(1, [topic("projection", [[1, "explains"]])]))], asStored(gone));
  const returned = back.topics.find((item) => item.id === projection.id);
  assert.ok(returned);
  assert.equal(returned.retired, false);
  assert.equal(returned.home_lesson_url, url(1));
});

test("the overview holds each lesson with its state and topic count, and one arrow for each pair of lessons", () => {
  const map = build([
    lesson(1, result(2, [topic("MergeTree", [[1, "explains"]]), topic("Partition", [[1, "explains"]])])),
    lesson(
      2,
      result(
        3,
        [topic("Granule", [[1, "explains"]]), topic("Index", [[2, "explains"]])],
        [
          relation("prerequisite", "MergeTree", "Granule"),
          relation("prerequisite", "Partition", "Granule", 2),
          relation("prerequisite", "Partition", "Granule", 3),
          relation("prerequisite", "Index", "MergeTree", 2),
        ],
      ),
      "failed",
    ),
    lesson(3, null, "none"),
  ]);
  assert.deepEqual(map.overview, {
    lessons: [
      { url: url(1), position: 1, title: "Lesson 1", state: "analysed", topics: 2 },
      { url: url(2), position: 2, title: "Lesson 2", state: "failed", topics: 2 },
      { url: url(3), position: 3, title: "Lesson 3", state: "none", topics: 0 },
    ],
    arrows: [
      { from: 1, to: 2, count: 2 },
      { from: 2, to: 1, count: 1 },
    ],
  });
  assert.deepEqual(map.report.lessons, { loaded: 3, analysed: 2, reused: 1, failed: 1, none: 1 });
  assert.deepEqual(map.report.passages, { total: 5, withoutTopic: 2 });
  assert.deepEqual(map.report.topics, {
    live: 4,
    retired: 0,
    merged: 0,
    perLesson: { least: 2, middle: 2, largest: 2 },
  });
  assert.deepEqual(map.report.prerequisites, { total: 4, againstLessonOrder: 1, share: 0.25 });
  assert.deepEqual(map.report.tokens, { input: 100, output: 50 });
  assert.deepEqual(map.report.models, ["claude-haiku-5-5"]);
});
