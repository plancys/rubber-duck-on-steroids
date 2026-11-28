import assert from "node:assert/strict";
import { test } from "node:test";
import {
  knownLiveTopicIds,
  knownTopicIds,
  parseLearnerEvents,
  topicStates,
  type LearnerEvent,
  type LearnerEventKind,
  type TopicState,
} from "./learner-state.ts";

// An event at a second of one minute. A later second is a newer event.
function event(id: string, topicId: string, kind: LearnerEventKind, second: number): LearnerEvent {
  return { id, topicId, kind, createdAt: `2026-11-28T10:00:${String(second).padStart(2, "0")}+00:00` };
}

// An event of the topic "sql" at an exact time.
function sqlEvent(id: string, kind: LearnerEventKind, createdAt: string): LearnerEvent {
  return { id, topicId: "sql", kind, createdAt };
}

const NO_MERGES: ReadonlyMap<string, string> = new Map();

// The states as sorted pairs, so that a test can compare them.
function states(events: readonly LearnerEvent[], merges = NO_MERGES): [string, TopicState][] {
  return [...topicStates(events, merges)].sort(([a], [b]) => a.localeCompare(b));
}

test("a mark and then an unmark give unknown", () => {
  const events = [event("e1", "sql", "mark_known", 1), event("e2", "sql", "unmark_known", 2)];
  assert.deepEqual(states(events), [["sql", "unknown"]]);
  assert.deepEqual([...knownTopicIds(topicStates(events, NO_MERGES))], []);
});

test("a mark gives claimed, and a topic with no event is not in the result", () => {
  const result = topicStates([event("e1", "sql", "mark_known", 1)], NO_MERGES);
  assert.equal(result.get("sql"), "claimed");
  assert.equal(result.has("join"), false);
  assert.deepEqual([...knownTopicIds(result)], ["sql"]);
});

test("a mark on a merged topic counts for its target", () => {
  const merges = new Map([["old", "new"]]);
  assert.deepEqual(states([event("e1", "old", "mark_known", 1)], merges), [["new", "claimed"]]);
});

test("the newest event wins between a merged topic and its target, in both orders", () => {
  const merges = new Map([["old", "new"]]);
  const targetLast = [event("e1", "old", "mark_known", 1), event("e2", "new", "unmark_known", 2)];
  assert.deepEqual(states(targetLast, merges), [["new", "unknown"]]);
  const mergedLast = [event("e1", "new", "mark_known", 1), event("e2", "old", "unmark_known", 2)];
  assert.deepEqual(states(mergedLast, merges), [["new", "unknown"]]);
  const markLast = [event("e1", "new", "unmark_known", 1), event("e2", "old", "mark_known", 2)];
  assert.deepEqual(states(markLast, merges), [["new", "claimed"]]);
});

test("a chain A to B to C counts for C", () => {
  const merges = new Map([
    ["a", "b"],
    ["b", "c"],
  ]);
  assert.deepEqual(states([event("e1", "a", "mark_known", 1)], merges), [["c", "claimed"]]);
  const events = [event("e1", "a", "mark_known", 1), event("e2", "b", "unmark_known", 2)];
  assert.deepEqual(states(events, merges), [["c", "unknown"]]);
});

test("an event whose merge chain has a loop does not count", () => {
  const merges = new Map([
    ["a", "b"],
    ["b", "a"],
    ["self", "self"],
  ]);
  const events = [
    event("e1", "a", "mark_known", 1),
    event("e2", "b", "mark_known", 2),
    event("e3", "self", "mark_known", 3),
    event("e4", "sql", "mark_known", 4),
  ];
  assert.deepEqual(states(events, merges), [["sql", "claimed"]]);
});

test("an equal createdAt sorts by id", () => {
  const time = "2026-11-28T10:00:00.5+00:00";
  const first = "00000000-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  const unmarkLast = [sqlEvent(first, "mark_known", time), sqlEvent(second, "unmark_known", time)];
  assert.deepEqual(states(unmarkLast), [["sql", "unknown"]]);
  assert.deepEqual(states([...unmarkLast].reverse()), [["sql", "unknown"]]);
  const markLast = [sqlEvent(first, "unmark_known", time), sqlEvent(second, "mark_known", time)];
  assert.deepEqual(states(markLast), [["sql", "claimed"]]);
});

test("the microseconds of Postgres order two events in one millisecond", () => {
  // The id of the older event is larger, so only the microseconds give the right order.
  const micro = [
    sqlEvent("e9", "mark_known", "2026-11-28T10:00:00.123456+00:00"),
    sqlEvent("e1", "unmark_known", "2026-11-28T10:00:00.123457+00:00"),
  ];
  assert.deepEqual(states(micro), [["sql", "unknown"]]);
  // Postgres drops the zeros at the end of the fraction, so .1 comes before .12.
  const short = [
    sqlEvent("e9", "mark_known", "2026-11-28T10:00:00.1+00:00"),
    sqlEvent("e1", "unmark_known", "2026-11-28T10:00:00.12+00:00"),
  ];
  assert.deepEqual(states(short), [["sql", "unknown"]]);
  // A whole second has no fraction, and it comes before .5 of the same second.
  const whole = [
    sqlEvent("e9", "unmark_known", "2026-11-28T10:00:00+00:00"),
    sqlEvent("e1", "mark_known", "2026-11-28T10:00:00.5Z"),
  ];
  assert.deepEqual(states(whole), [["sql", "claimed"]]);
  // The zone counts: 11:00 at +01:00 is 10:00 in UTC, so it comes before 10:00:01 in UTC.
  const zones = [
    sqlEvent("e1", "unmark_known", "2026-11-28T11:00:00+01:00"),
    sqlEvent("e2", "mark_known", "2026-11-28T10:00:01Z"),
  ];
  assert.deepEqual(states(zones), [["sql", "claimed"]]);
});

test("the order of the input does not change the result", () => {
  const merges = new Map([
    ["old", "new"],
    ["a", "b"],
    ["b", "c"],
  ]);
  const events = [
    event("e1", "sql", "mark_known", 1),
    event("e2", "old", "mark_known", 2),
    event("e3", "new", "unmark_known", 3),
    event("e4", "a", "mark_known", 4),
    event("e5", "sql", "unmark_known", 5),
    event("e6", "sql", "mark_known", 6),
    event("e7", "retired", "mark_known", 7),
  ];
  const expected: [string, TopicState][] = [
    ["c", "claimed"],
    ["new", "unknown"],
    ["retired", "claimed"],
    ["sql", "claimed"],
  ];
  assert.deepEqual(states(events, merges), expected);
  assert.deepEqual(states([...events].reverse(), merges), expected);
  assert.deepEqual(states([...events.slice(3), ...events.slice(0, 3)], merges), expected);
});

test("a mark on a retired topic stays on its id", () => {
  // A retired topic is not merged, so the merges do not name it.
  const merges = new Map([["old", "new"]]);
  assert.deepEqual(states([event("e1", "retired", "mark_known", 1)], merges), [["retired", "claimed"]]);
});

test("parseLearnerEvents reads the events and drops an item that does not fit", () => {
  const events = parseLearnerEvents([
    { id: "e1", topic_id: "sql", kind: "mark_known", created_at: "2026-11-28T10:00:00.123456+00:00" },
    { id: "e2", topic_id: "sql", kind: "unmark_known", created_at: "2026-11-28T10:00:01+00:00" },
    { id: "e3", topic_id: "sql", kind: "answer", created_at: "2026-11-28T10:00:02+00:00" },
    { id: "e4", topic_id: "sql", kind: "mark_known", created_at: "yesterday" },
    { id: "e5", kind: "mark_known", created_at: "2026-11-28T10:00:03+00:00" },
    { id: 6, topic_id: "sql", kind: "mark_known", created_at: "2026-11-28T10:00:04+00:00" },
    null,
    "e7",
  ]);
  assert.deepEqual(events, [
    sqlEvent("e1", "mark_known", "2026-11-28T10:00:00.123456+00:00"),
    sqlEvent("e2", "unmark_known", "2026-11-28T10:00:01+00:00"),
  ]);
});

test("knownLiveTopicIds keeps the live topics in the state claimed, after the merges", () => {
  const merges = new Map([["old", "new"]]);
  const events = [
    // A mark on a merged topic counts for the topic that replaces it.
    event("e1", "old", "mark_known", 1),
    // A topic that is not live does not count.
    event("e2", "gone", "mark_known", 2),
    // An unmark after a mark gives no known topic.
    event("e3", "sql", "mark_known", 3),
    event("e4", "sql", "unmark_known", 4),
  ];
  assert.deepEqual([...knownLiveTopicIds(events, merges, new Set(["new", "sql"]))], ["new"]);
});

test("parseLearnerEvents gives no event for a value that is not a list", () => {
  assert.deepEqual(parseLearnerEvents(null), []);
  assert.deepEqual(parseLearnerEvents({ id: "e1" }), []);
});
