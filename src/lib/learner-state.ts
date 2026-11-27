// The state of each topic for one learner, as a pure function of the learner events of a course.
// The pages read the events with learner_course_events and the merges with course_topic_list, and join them here.
// It has no imports, so the pages, the islands and node --test can use it.

/** The kinds of event. The check learner_events_kind_check allows these values. S-06 adds its answer events. */
export type LearnerEventKind = "mark_known" | "unmark_known";

export interface LearnerEvent {
  id: string;
  topicId: string;
  kind: LearnerEventKind;
  // The time of the insert as Postgres gives it, for example 2026-11-28T10:15:30.123456+00:00.
  createdAt: string;
}

/**
 * The state of a topic for the learner. These are the first two of the four states of M-01.
 * unknown: no mark. claimed: the learner marks the topic as known. S-06 adds confirmed and refuted.
 */
export type TopicState = "unknown" | "claimed";

/** The name of the rule of topicStates: the newest event of a topic decides, and a merge moves the events. */
export const LEARNER_STATE_POLICY = "marks-1";

// A time from Postgres, for example 2026-11-28T10:15:30.123456+00:00. Postgres drops the zeros at the end of
// the fraction, and it gives no fraction for a whole second. A time from toISOString() ends with Z.
const TIME_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** The time of an event in microseconds since 1970, or null when the text is not a time. */
function eventTime(createdAt: string): number | null {
  const match = TIME_PATTERN.exec(createdAt);
  if (!match) return null;
  const [, seconds, fraction, zone] = match;
  const milliseconds = Date.parse(`${seconds}${zone}`);
  if (Number.isNaN(milliseconds)) return null;
  // A Date keeps only milliseconds, and Postgres keeps microseconds. Two events in one millisecond keep their order.
  const microseconds = fraction ? Number(fraction.slice(1, 7).padEnd(6, "0")) : 0;
  return milliseconds * 1000 + microseconds;
}

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** Reads the JSON of learner_course_events. It drops an item that does not fit. */
export function parseLearnerEvents(data: unknown): LearnerEvent[] {
  const items: unknown[] = Array.isArray(data) ? data : [];
  return items.flatMap((item): LearnerEvent[] => {
    const id = fieldOf(item, "id");
    const topicId = fieldOf(item, "topic_id");
    const kind = fieldOf(item, "kind");
    const createdAt = fieldOf(item, "created_at");
    if (typeof id !== "string" || typeof topicId !== "string" || typeof createdAt !== "string") return [];
    if (kind !== "mark_known" && kind !== "unmark_known") return [];
    if (eventTime(createdAt) === null) return [];
    return [{ id, topicId, kind, createdAt }];
  });
}

/**
 * The live end of the merge chain of a topic, or null when the chain has a loop. A topic that is not merged is its
 * own end. The worker follows a chain in the same way (finalTarget in worker/topics/identity.ts), but the web app
 * must not import from worker/.
 */
function liveEnd(topicId: string, merges: ReadonlyMap<string, string>): string | null {
  const seen = new Set<string>();
  let current = topicId;
  let next = merges.get(current);
  while (next !== undefined) {
    if (seen.has(current)) return null;
    seen.add(current);
    current = next;
    next = merges.get(current);
  }
  return current;
}

/**
 * The state of each topic that has an event. `merges` maps each merged topic to the topic that replaces it.
 * Each event counts for the live end of the merge chain of its topic. An event whose chain has a loop does not count.
 * The newest event of a topic by (createdAt, id) decides, as learner_course_events orders them:
 * mark_known gives claimed, and unmark_known gives unknown. A topic with no event is not in the result.
 * It reads as unknown. A retired topic is not merged, so its events stay on its id.
 */
export function topicStates(
  events: readonly LearnerEvent[],
  merges: ReadonlyMap<string, string>,
): Map<string, TopicState> {
  const newest = new Map<string, { time: number; id: string; kind: LearnerEventKind }>();
  for (const event of events) {
    const topicId = liveEnd(event.topicId, merges);
    const time = eventTime(event.createdAt);
    if (topicId === null || time === null) continue;
    const current = newest.get(topicId);
    if (current === undefined || time > current.time || (time === current.time && event.id > current.id)) {
      newest.set(topicId, { time, id: event.id, kind: event.kind });
    }
  }
  const states = new Map<string, TopicState>();
  for (const [topicId, event] of newest) {
    states.set(topicId, event.kind === "mark_known" ? "claimed" : "unknown");
  }
  return states;
}

/** The ids of the topics in the state claimed. */
export function knownTopicIds(states: ReadonlyMap<string, TopicState>): Set<string> {
  const known = new Set<string>();
  for (const [topicId, state] of states) {
    if (state === "claimed") known.add(topicId);
  }
  return known;
}
