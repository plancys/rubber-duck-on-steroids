import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checklistLessons,
  knownTopicsPath,
  parseTopicList,
  type ChecklistLesson,
  type ChecklistTopic,
  type TopicListTopic,
} from "./topics.ts";

const LESSON_1 = "https://example.com/course/first-steps";
const LESSON_2 = "https://example.com/course/queries";

function topic(id: string, homeLessonUrl: string, parentId: string | null = null): TopicListTopic {
  return { id, name: `Topic ${id}`, description: null, homeLessonUrl, parentId };
}

// The checklist of a course with two lessons.
function checklist(topics: TopicListTopic[]): ChecklistLesson[] {
  const lessons = [
    { url: LESSON_1, position: 1, title: "First steps" },
    { url: LESSON_2, position: 2, title: null },
  ];
  return checklistLessons({ lessons, topics, merged: [] });
}

// The topics of a lesson as text. The children of a topic follow it in brackets, for example "sql(join order) olap".
function outline(topics: readonly ChecklistTopic[]): string {
  const parts = topics.map((node) => (node.children.length > 0 ? `${node.id}(${outline(node.children)})` : node.id));
  return parts.join(" ");
}

function outlines(lessons: readonly ChecklistLesson[]): string[] {
  return lessons.map((lesson) => `${lesson.position}: ${outline(lesson.topics)}`);
}

test("parseTopicList reads the lessons, the topics and the merged topics", () => {
  const list = parseTopicList({
    lessons: [
      { url: LESSON_2, position: 2, title: null },
      { url: LESSON_1, position: 1, title: "First steps" },
      { url: "https://example.com/course/no-position" },
    ],
    topics: [
      { id: "sql", name: "SQL", description: "A query language.", home_lesson_url: LESSON_1, parent_id: null },
      { id: "join", name: "JOIN", description: null, home_lesson_url: LESSON_1, parent_id: "sql" },
      { id: "no-name", description: null, home_lesson_url: LESSON_1, parent_id: null },
      { id: "no-lesson", name: "No lesson", description: null, parent_id: null },
    ],
    merged: [{ id: "old", merged_into: "sql" }, { id: "no-target" }],
  });
  assert.deepEqual(list, {
    lessons: [
      { url: LESSON_1, position: 1, title: "First steps" },
      { url: LESSON_2, position: 2, title: null },
    ],
    topics: [
      { id: "sql", name: "SQL", description: "A query language.", homeLessonUrl: LESSON_1, parentId: null },
      { id: "join", name: "JOIN", description: null, homeLessonUrl: LESSON_1, parentId: "sql" },
    ],
    merged: [{ id: "old", mergedInto: "sql" }],
  });
});

test("parseTopicList gives null when the caller cannot see the course", () => {
  assert.equal(parseTopicList(null), null);
  assert.equal(parseTopicList("course"), null);
  assert.equal(parseTopicList([]), null);
  assert.deepEqual(parseTopicList({}), { lessons: [], topics: [], merged: [] });
});

test("checklistLessons gives one group for each lesson in course order", () => {
  const lessons = checklist([topic("sql", LESSON_1), topic("select", LESSON_2), topic("olap", LESSON_1)]);
  const heads = lessons.map((lesson) => [lesson.position, lesson.url, lesson.title]);
  assert.deepEqual(heads, [
    [1, LESSON_1, "First steps"],
    [2, LESSON_2, null],
  ]);
  assert.deepEqual(outlines(lessons), ["1: sql olap", "2: select"]);
  assert.deepEqual(outlines(checklist([topic("sql", LESSON_1)])), ["1: sql", "2: "]);
});

test("checklistLessons puts a child under its parent of the same lesson", () => {
  const lessons = checklist([
    topic("early", LESSON_1, "olap"),
    topic("sql", LESSON_1),
    topic("join", LESSON_1, "sql"),
    topic("inner", LESSON_1, "join"),
    topic("order", LESSON_1, "sql"),
    topic("olap", LESSON_1),
  ]);
  assert.deepEqual(outlines(lessons), ["1: sql(join(inner) order) olap(early)", "2: "]);
  assert.deepEqual(lessons[0].topics[0].children[0], {
    id: "join",
    name: "Topic join",
    description: null,
    children: [{ id: "inner", name: "Topic inner", description: null, children: [] }],
  });
});

test("checklistLessons puts a child at the top level when its parent is not in its lesson", () => {
  // The parent of "window" is a topic of lesson 1. The parent of "select" is a merged topic, so it is not in the list.
  const lessons = checklist([
    topic("sql", LESSON_1),
    topic("window", LESSON_2, "sql"),
    topic("select", LESSON_2, "merged-topic"),
  ]);
  assert.deepEqual(outlines(lessons), ["1: sql", "2: window select"]);
});

test("checklistLessons stops a parent loop before the topic where it starts", () => {
  const twoTopics = checklist([topic("a", LESSON_1, "b"), topic("b", LESSON_1, "a")]);
  assert.deepEqual(outlines(twoTopics), ["1: a(b)", "2: "]);
  const threeTopics = checklist([topic("a", LESSON_1, "b"), topic("b", LESSON_1, "c"), topic("c", LESSON_1, "a")]);
  assert.deepEqual(outlines(threeTopics), ["1: a(c(b))", "2: "]);
  const ownParent = checklist([topic("self", LESSON_1, "self"), topic("sql", LESSON_1)]);
  assert.deepEqual(outlines(ownParent), ["1: self sql", "2: "]);
});

test("knownTopicsPath gives the path of the checklist page", () => {
  const id = "6f1c2a3b-0000-4000-8000-000000000001";
  assert.equal(knownTopicsPath(id), `/dashboard/courses/${id}/known`);
});
