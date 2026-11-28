import assert from "node:assert/strict";
import { test } from "node:test";
import type { LearnerEvent, LearnerEventKind } from "./learner-state.ts";
import {
  knownLiveTopics,
  lessonPath,
  parseCourseLessonMap,
  pathCounts,
  type CourseLessonMap,
  type LessonAnalysisState,
  type PathLesson,
  type PathLessonInput,
} from "./lesson-path.ts";

const COURSE = "https://example.com/course";

// The URL of the lesson at a course position.
function url(position: number): string {
  return `${COURSE}/lesson-${position}`;
}

// The loaded lessons at the positions 1 to count, in course order.
function course(count: number): PathLessonInput[] {
  return Array.from({ length: count }, (_, index) => ({
    url: url(index + 1),
    position: index + 1,
    title: `Lesson ${index + 1}`,
    status: "loaded",
    error: null,
  }));
}

// The names of the topics of the docs case. Each other topic has the name "Topic <id>".
const NAMES = new Map([
  ["parts", "Table parts"],
  ["mergetree", "MergeTree"],
]);

// Each lesson explains one topic: lesson n explains "t<n>".
function own(count: number): Record<number, string[]> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index): [number, string[]] => [index + 1, [`t${index + 1}`]]),
  );
}

/**
 * A lesson map of a course with count lessons, each with a current analysis.
 * explains: the topic ids that each lesson explains, by course position.
 * prerequisites: [from, to] pairs. The learner must know the from topic before the to topic.
 * mentions: the home lesson of a topic that no lesson explains, by topic id.
 * The home lesson of an explained topic is the first lesson that explains it.
 */
function lessonMap(
  count: number,
  explains: Partial<Record<number, string[]>>,
  prerequisites: [string, string][] = [],
  mentions: Record<string, number> = {},
): CourseLessonMap {
  const homes = new Map<string, number>();
  const pairs: CourseLessonMap["explains"] = [];
  for (let position = 1; position <= count; position++) {
    for (const topicId of explains[position] ?? []) {
      pairs.push({ lessonUrl: url(position), topicId });
      if (!homes.has(topicId)) homes.set(topicId, position);
    }
  }
  for (const [topicId, position] of Object.entries(mentions)) {
    if (!homes.has(topicId)) homes.set(topicId, position);
  }
  return {
    analyses: new Map(
      Array.from({ length: count }, (_, index): [string, LessonAnalysisState] => [url(index + 1), "current"]),
    ),
    topics: [...homes].map(([id, position]) => ({
      id,
      name: NAMES.get(id) ?? `Topic ${id}`,
      homeLessonUrl: url(position),
    })),
    explains: pairs,
    prerequisites: prerequisites.map(([fromTopicId, toTopicId]) => ({ fromTopicId, toTopicId })),
    merged: [],
  };
}

// The adjusted list. Each test also checks the guardrail: the list gives each input lesson exactly once.
function pathOf(lessons: readonly PathLessonInput[], map: CourseLessonMap, known: string[] = []): PathLesson[] {
  const path = lessonPath(lessons, map, new Set(known));
  assert.equal(path.length, lessons.length);
  assert.deepEqual(new Set(path.map((lesson) => lesson.url)), new Set(lessons.map((lesson) => lesson.url)));
  return path;
}

function positions(path: readonly PathLesson[]): number[] {
  return path.map((lesson) => lesson.position);
}

function movedPositions(path: readonly PathLesson[]): number[] {
  return path.filter((lesson) => lesson.movedUp !== null).map((lesson) => lesson.position);
}

// The lesson at a course position. The test fails when the list does not hold it.
function lessonAt(path: readonly PathLesson[], position: number): PathLesson {
  const lesson = path.find((item) => item.position === position);
  assert.ok(lesson, `lesson ${position} is in the list`);
  return lesson;
}

// An event at a second of one minute. A later second is a newer event.
function event(id: string, topicId: string, kind: LearnerEventKind, second: number): LearnerEvent {
  return { id, topicId, kind, createdAt: `2026-11-28T10:00:${String(second).padStart(2, "0")}+00:00` };
}

test("lessonPath skips a lesson when the learner knows every topic that it explains", () => {
  const lessons = course(3);
  // Lesson 2 also explains "a", whose home lesson is lesson 1. Lesson 3 only mentions "e", so it has no pair for "e".
  const map = lessonMap(3, { 1: ["a", "b"], 2: ["c", "a"], 3: ["d"] }, [], { e: 3 });

  const knowsLesson1 = pathOf(lessons, map, ["a", "b"]);
  assert.deepEqual(
    knowsLesson1.map((lesson) => [lesson.position, lesson.state, lesson.knownCount]),
    [
      [1, "skipped", 2],
      [2, "open", 1],
      [3, "open", 0],
    ],
  );
  assert.deepEqual(lessonAt(knowsLesson1, 2).topics, [
    { id: "a", name: "Topic a", known: true, homePosition: 1 },
    { id: "c", name: "Topic c", known: false, homePosition: 2 },
  ]);
  assert.deepEqual(pathCounts(knowsLesson1), { skipped: 1, moved: 0, total: 3 });

  // A known topic of another home lesson counts.
  assert.equal(lessonAt(pathOf(lessons, map, ["a", "c"]), 2).state, "skipped");
  // The mentioned topic "e" is not known, and it does not keep lesson 3 in the list.
  assert.equal(lessonAt(pathOf(lessons, map, ["d"]), 3).state, "skipped");
});

test("lessonPath never skips a lesson that did not load, has no current analysis, or explains no topic", () => {
  const lessons = course(6);
  lessons[0] = { ...lessons[0], status: "failed", error: "The page answered 404." };
  const map = lessonMap(6, { 1: ["a"], 2: ["b"], 3: ["c"], 4: ["d"], 6: ["f"] });
  map.analyses.delete(url(2));
  map.analyses.set(url(3), "failed");
  map.analyses.set(url(4), "changed");

  // The learner knows all the old topics of lessons 1 to 4.
  const path = pathOf(lessons, map, ["a", "b", "c", "d"]);
  assert.deepEqual(
    path.map((lesson) => [lesson.position, lesson.state]),
    [
      [1, "not_loaded"],
      [2, "not_analysed"],
      [3, "not_analysed"],
      [4, "not_analysed"],
      [5, "no_topics"],
      [6, "open"],
    ],
  );
  assert.equal(lessonAt(path, 1).error, "The page answered 404.");
  assert.deepEqual(pathCounts(path), { skipped: 0, moved: 0, total: 6 });
});

test("lessonPath keeps the course order with no marks and no backward need", () => {
  // Lesson 4 needs the topic of lesson 1, which comes before it. The input is not in course order.
  const map = lessonMap(5, own(5), [["t1", "t4"]]);
  const path = pathOf(course(5).reverse(), map);
  assert.deepEqual(positions(path), [1, 2, 3, 4, 5]);
  assert.deepEqual(movedPositions(path), []);
  assert.ok(path.every((lesson) => lesson.gaps.length === 0));
});

test("lessonPath moves a needed lesson up to the place right before the lesson that needs it", () => {
  // Lesson 2 needs lesson 3, and lesson 9 needs lesson 14.
  const map = lessonMap(16, own(16), [
    ["t3", "t2"],
    ["t14", "t9"],
  ]);
  const path = pathOf(course(16), map);
  assert.deepEqual(positions(path), [1, 3, 2, 4, 5, 6, 7, 8, 14, 9, 10, 11, 12, 13, 15, 16]);
  assert.deepEqual(movedPositions(path), [3, 14]);
  assert.deepEqual(lessonAt(path, 3).movedUp, {
    position: 2,
    title: "Lesson 2",
    pairs: [{ topic: "Topic t2", prerequisite: "Topic t3" }],
  });
  assert.deepEqual(lessonAt(path, 14).movedUp, {
    position: 9,
    title: "Lesson 9",
    pairs: [{ topic: "Topic t9", prerequisite: "Topic t14" }],
  });
  assert.deepEqual(pathCounts(path), { skipped: 0, moved: 2, total: 16 });
});

test("a mark on the topic or on the prerequisite removes the move", () => {
  const lessons = course(3);
  // "t" of lesson 2 needs "p" of lesson 3. Each lesson has one more topic, so a mark does not skip it.
  const map = lessonMap(3, { 1: ["x1"], 2: ["t", "x2"], 3: ["p", "x3"] }, [["p", "t"]]);
  assert.deepEqual(positions(pathOf(lessons, map)), [1, 3, 2]);
  for (const mark of ["t", "p"]) {
    const path = pathOf(lessons, map, [mark]);
    assert.deepEqual(positions(path), [1, 2, 3], mark);
    assert.deepEqual(movedPositions(path), [], mark);
    assert.ok(
      path.every((lesson) => lesson.state === "open"),
      mark,
    );
  }
});

test("a prerequisite that no lesson explains gives a gap note and keeps the course order", () => {
  const lessons = course(4);
  // The docs case: "Table parts" of lesson 2 needs "MergeTree", which lesson 3 only mentions.
  const map = lessonMap(4, { 1: ["x1"], 2: ["parts"], 3: ["x3"], 4: ["x4"] }, [["mergetree", "parts"]], {
    mergetree: 3,
  });
  const path = pathOf(lessons, map);
  assert.deepEqual(positions(path), [1, 2, 3, 4]);
  assert.deepEqual(movedPositions(path), []);
  assert.deepEqual(
    path.map((lesson) => lesson.gaps),
    [[], [{ topic: "Table parts", prerequisite: "MergeTree", mentionPosition: 3 }], [], []],
  );
  for (const mark of ["parts", "mergetree"]) {
    assert.ok(
      pathOf(lessons, map, [mark]).every((lesson) => lesson.gaps.length === 0),
      mark,
    );
  }
});

test("a chain of needs places each needed lesson right before the lesson that needs it", () => {
  // Lesson 2 needs lesson 4, and lesson 4 needs lesson 3.
  const map = lessonMap(5, own(5), [
    ["t4", "t2"],
    ["t3", "t4"],
  ]);
  const path = pathOf(course(5), map);
  assert.deepEqual(positions(path), [1, 3, 4, 2, 5]);
  assert.deepEqual(movedPositions(path), [3, 4]);
  assert.deepEqual(lessonAt(path, 3).movedUp, {
    position: 4,
    title: "Lesson 4",
    pairs: [{ topic: "Topic t4", prerequisite: "Topic t3" }],
  });
  assert.deepEqual(lessonAt(path, 4).movedUp, {
    position: 2,
    title: "Lesson 2",
    pairs: [{ topic: "Topic t2", prerequisite: "Topic t4" }],
  });
});

test("lessons that need each other keep the course order, and the walk ends", () => {
  const lessons = course(4);
  // Lesson 2 needs lesson 3 ("a2" needs "a3"), and lesson 3 needs lesson 2 ("b3" needs "b2").
  const twoLessons = lessonMap(4, { 1: ["x1"], 2: ["a2", "b2"], 3: ["a3", "b3"], 4: ["x4"] }, [
    ["a3", "a2"],
    ["b2", "b3"],
  ]);
  const twoPath = pathOf(lessons, twoLessons);
  assert.deepEqual(positions(twoPath), [1, 2, 3, 4]);
  assert.deepEqual(movedPositions(twoPath), []);
  // Lesson 2 needs lesson 4, lesson 4 needs lesson 3, and lesson 3 needs lesson 2.
  const threeLessons = lessonMap(4, { 1: ["x1"], 2: ["a2", "b2"], 3: ["b3", "c3"], 4: ["a4", "c4"] }, [
    ["a4", "a2"],
    ["c3", "c4"],
    ["b2", "b3"],
  ]);
  const threePath = pathOf(lessons, threeLessons);
  assert.deepEqual(positions(threePath), [1, 2, 3, 4]);
  assert.deepEqual(movedPositions(threePath), []);
});

test("a loop that a lesson before it needs moves up in course order", () => {
  // Lessons 3 and 5 need each other ("b3" needs "q5", and "q5" needs "c3"). Lesson 2 needs lesson 5 ("a2" needs "p5").
  const map = lessonMap(5, { 1: ["x1"], 2: ["a2"], 3: ["b3", "c3"], 4: ["x4"], 5: ["p5", "q5"] }, [
    ["p5", "a2"],
    ["q5", "b3"],
    ["c3", "q5"],
  ]);
  const path = pathOf(course(5), map);
  assert.deepEqual(positions(path), [1, 3, 5, 2, 4]);
  assert.deepEqual(movedPositions(path), [3, 5]);
  assert.deepEqual(lessonAt(path, 5).movedUp, {
    position: 2,
    title: "Lesson 2",
    pairs: [{ topic: "Topic a2", prerequisite: "Topic p5" }],
  });
  assert.deepEqual(lessonAt(path, 3).movedUp, {
    position: 5,
    title: "Lesson 5",
    pairs: [{ topic: "Topic q5", prerequisite: "Topic c3" }],
  });
});

test("a prerequisite that an earlier lesson or the same lesson explains first gives no move and no gap note", () => {
  // "p1" of lesson 1 comes before "t3" of lesson 3. Lesson 4 also explains "p1", but lesson 1 explains it first.
  // Lesson 2 explains both "p2" and "t2".
  const map = lessonMap(4, { 1: ["p1"], 2: ["p2", "t2"], 3: ["t3"], 4: ["x4", "p1"] }, [
    ["p1", "t3"],
    ["p2", "t2"],
  ]);
  const path = pathOf(course(4), map);
  assert.deepEqual(positions(path), [1, 2, 3, 4]);
  assert.deepEqual(movedPositions(path), []);
  assert.ok(path.every((lesson) => lesson.gaps.length === 0));
});

test("lessonPath sorts the topics of a lesson by name, then by id", () => {
  const map = lessonMap(1, { 1: ["zeta", "same-2", "alpha", "same-1"] });
  const names = new Map([
    ["zeta", "Zeta"],
    ["same-2", "Same"],
    ["alpha", "alpha"],
    ["same-1", "Same"],
  ]);
  map.topics = map.topics.map((topic) => ({ ...topic, name: names.get(topic.id) ?? topic.name }));
  const topics = lessonAt(pathOf(course(1), map), 1).topics;
  assert.deepEqual(
    topics.map((topic) => topic.id),
    ["alpha", "same-1", "same-2", "zeta"],
  );
});

test("lessonPath ignores data outside the input and gives null for a home lesson outside the input", () => {
  const removed = `${COURSE}/removed`;
  const map: CourseLessonMap = {
    analyses: new Map<string, LessonAnalysisState>([
      [url(1), "current"],
      [url(2), "current"],
    ]),
    topics: [
      { id: "t1", name: "Topic t1", homeLessonUrl: url(1) },
      { id: "gone", name: "Gone", homeLessonUrl: removed },
      { id: "native", name: "Native TCP endpoint", homeLessonUrl: removed },
    ],
    explains: [
      { lessonUrl: url(1), topicId: "t1" },
      { lessonUrl: url(2), topicId: "gone" },
      // A topic that is not live, and a lesson that is not in the input.
      { lessonUrl: url(1), topicId: "not-live" },
      { lessonUrl: removed, topicId: "native" },
    ],
    prerequisites: [
      { fromTopicId: "native", toTopicId: "t1" },
      { fromTopicId: "not-live", toTopicId: "gone" },
    ],
    merged: [],
  };
  const path = pathOf(course(2), map);
  assert.deepEqual(positions(path), [1, 2]);
  assert.deepEqual(lessonAt(path, 1).topics, [{ id: "t1", name: "Topic t1", known: false, homePosition: 1 }]);
  assert.deepEqual(lessonAt(path, 2).topics, [{ id: "gone", name: "Gone", known: false, homePosition: null }]);
  // No lesson of the input explains "native", and its home lesson is not in the input.
  assert.deepEqual(lessonAt(path, 1).gaps, [
    { topic: "Topic t1", prerequisite: "Native TCP endpoint", mentionPosition: null },
  ]);
  assert.deepEqual(lessonAt(path, 2).gaps, []);
});

test("knownLiveTopics counts a mark on a merged topic for its target, and an unmark after a mark gives no mark", () => {
  const map: CourseLessonMap = {
    analyses: new Map<string, LessonAnalysisState>(),
    topics: [
      { id: "new", name: "New", homeLessonUrl: url(1) },
      { id: "sql", name: "SQL", homeLessonUrl: url(1) },
    ],
    explains: [],
    prerequisites: [],
    merged: [{ id: "old", mergedInto: "new" }],
  };
  const events = [
    event("e1", "old", "mark_known", 1),
    event("e2", "sql", "mark_known", 2),
    event("e3", "sql", "unmark_known", 3),
    // A topic that is not a live topic of the map.
    event("e4", "retired", "mark_known", 4),
  ];
  assert.deepEqual(knownLiveTopics(events, map), new Set(["new"]));
  assert.deepEqual(knownLiveTopics(events.slice(1, 3), map), new Set<string>());
});

test("parseCourseLessonMap reads the document and drops an item that does not fit", () => {
  const map = parseCourseLessonMap({
    analyses: [
      { lesson_url: url(1), state: "current" },
      { lesson_url: url(2), state: "changed" },
      { lesson_url: url(3), state: "failed" },
      { lesson_url: url(4), state: "analysed" },
      { state: "current" },
      null,
    ],
    topics: [
      { id: "sql", name: "SQL", home_lesson_url: url(1) },
      { id: "no-home", name: "No home" },
      { id: 7, name: "Number id", home_lesson_url: url(1) },
    ],
    explains: [{ lesson_url: url(1), topic_id: "sql" }, { lesson_url: url(1) }, "sql"],
    prerequisites: [{ from_topic_id: "sql", to_topic_id: "join" }, { to_topic_id: "join" }],
    merged: [{ id: "old", merged_into: "sql" }, { id: "no-target" }],
  });
  assert.deepEqual(map, {
    analyses: new Map([
      [url(1), "current"],
      [url(2), "changed"],
      [url(3), "failed"],
    ]),
    topics: [{ id: "sql", name: "SQL", homeLessonUrl: url(1) }],
    explains: [{ lessonUrl: url(1), topicId: "sql" }],
    prerequisites: [{ fromTopicId: "sql", toTopicId: "join" }],
    merged: [{ id: "old", mergedInto: "sql" }],
  });
});

test("parseCourseLessonMap gives null for a value that is not an object", () => {
  assert.equal(parseCourseLessonMap(null), null);
  assert.equal(parseCourseLessonMap("map"), null);
  assert.equal(parseCourseLessonMap([]), null);
  assert.deepEqual(parseCourseLessonMap({}), {
    analyses: new Map<string, LessonAnalysisState>(),
    topics: [],
    explains: [],
    prerequisites: [],
    merged: [],
  });
});
