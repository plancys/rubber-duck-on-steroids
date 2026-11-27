// The identity check: it keeps one topic for one concept inside a course, and it keeps each topic id between runs.
// A topic id has no meaning. Each name of a topic is an alias name.
// Two names are one topic when they have the same normalized form, or when the engine names a known topic
// as the same concept (sameAs). The stored alias names hold the decisions of the earlier runs.
// In doubt, two topics stay apart: the check joins names only by these rules.

import { createHash } from "node:crypto";
import type { StoredTopic } from "../queue.ts";

// A word of the lesson text needs at least this many letters to select a known topic.
export const MIN_WORD_LENGTH = 3;
// The most known topics in one engine request.
export const MAX_KNOWN_TOPICS = 150;
// The limits of a known topic in the engine contract.
const MAX_NAME_CHARACTERS = 500;
const MAX_ALIASES = 50;

// The marks that the name rule removes at the start of a name: white space, the ASCII quote marks, the backtick,
// the Unicode opening and closing quote marks, the comma, the semicolon, the colon, the exclamation mark,
// the question mark and the ellipsis.
const LEADING_MARKS = /^[\s"'`\p{Pi}\p{Pf},;:!?…]+/u;
// At the end of a name the rule also removes the full stop. A full stop at the start stays, as in ".NET".
// Other symbols stay, so "C++" and "C#" are two names.
const TRAILING_MARKS = /[\s"'`\p{Pi}\p{Pf},;:!?….]+$/u;
const WORD = /[\p{L}\p{N}]+/gu;

// The name rule: Unicode NFKC, lower case, each run of white space as one space,
// and no punctuation or quote marks at both ends.
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .replace(LEADING_MARKS, "")
    .replace(TRAILING_MARKS, "");
}

// The words of a text with at least MIN_WORD_LENGTH letters or digits, in lower case.
export function textWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const match of text.normalize("NFKC").toLowerCase().matchAll(WORD)) {
    const word = match[0];
    if (Array.from(word).length >= MIN_WORD_LENGTH) words.add(word);
  }
  return words;
}

// The id of a new topic. The id comes from the course and the first name of the topic, so the same input
// gives the same id. After its first run the id has no meaning: the alias names keep it.
export function newTopicId(courseId: string, normalized: string, taken: ReadonlySet<string>): string {
  for (let round = 0; ; round += 1) {
    const seed = round === 0 ? `${courseId}\n${normalized}` : `${courseId}\n${normalized}\n${round}`;
    const hex = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32).split("");
    // The version 8 and the variant bits of RFC 9562.
    hex[12] = "8";
    hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
    const text = hex.join("");
    const id = `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
    if (!taken.has(id)) return id;
  }
}

// One candidate topic of a lesson result, as the identity check reads it.
// sameAs is the name of a known topic that the engine named as the same concept, or null.
export interface CandidateName {
  name: string;
  sameAs: string | null;
}

// The candidates of one lesson. position is the place of the lesson in the course.
export interface LessonNames {
  position: number;
  topics: readonly CandidateName[];
}

// A candidate in the order of the course. seq counts the candidates of all lessons.
export interface CandidateRef {
  lesson: number;
  topic: number;
  seq: number;
}

// One topic of the course: a set of names with the stored topics and the candidates that carry them.
export interface TopicGroup {
  // The place of the group in the order of the grouping.
  index: number;
  // The stored topics of the group that are not merged, oldest first. The first one keeps its id.
  stored: StoredTopic[];
  // The stored topics that an earlier merge sent to a topic of this group.
  merged: StoredTopic[];
  // The names of the group: the normalized form and the display text. The stored names come first.
  names: Map<string, string>;
  // The candidates of the group, in course order.
  candidates: CandidateRef[];
}

export interface Grouping {
  groups: TopicGroup[];
  // The group of each normalized name.
  byName: Map<string, TopicGroup>;
  // The group of each candidate, as candidateGroup[lesson][topic]. Null for a candidate with an empty name.
  candidateGroup: (TopicGroup | null)[][];
  // The merged topics that point at a topic outside the course. The state keeps them as they are.
  detached: StoredTopic[];
}

// The sets of names that are one topic.
class NameSets {
  private readonly parent = new Map<string, string>();

  find(key: string): string {
    if (!this.parent.has(key)) this.parent.set(key, key);
    let root = key;
    for (let next = this.parent.get(root) ?? root; next !== root; next = this.parent.get(root) ?? root) {
      root = next;
    }
    // Point each key of the path at the root, so the next look is short.
    let current = key;
    while (current !== root) {
      const next = this.parent.get(current) ?? root;
      this.parent.set(current, root);
      current = next;
    }
    return root;
  }

  join(first: string, second: string): void {
    const a = this.find(first);
    const b = this.find(second);
    if (a !== b) this.parent.set(b, a);
  }
}

// The oldest topic first. The database returns the topics in the order of created_at and id.
export function byAge(first: StoredTopic, second: StoredTopic): number {
  if (first.created_at !== second.created_at) return first.created_at < second.created_at ? -1 : 1;
  if (first.id === second.id) return 0;
  return first.id < second.id ? -1 : 1;
}

// The names of a stored topic: its name and its alias names, as normalized form and display text.
function storedNames(topic: StoredTopic): [string, string][] {
  const names: [string, string][] = [];
  for (const text of [topic.name, ...topic.aliases.map((alias) => alias.alias)]) {
    const normalized = normalizeName(text);
    if (normalized) names.push([normalized, text]);
  }
  return names;
}

// The topic that a merged topic points at in the end, or null when the chain leaves the course or has a loop.
function finalTarget(topic: StoredTopic, byId: ReadonlyMap<string, StoredTopic>): StoredTopic | null {
  const seen = new Set<string>();
  let current: StoredTopic | undefined = topic;
  while (current?.merged_into) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    current = byId.get(current.merged_into);
  }
  return current ?? null;
}

// Group the stored topics and the candidates of the lessons into topics. The lessons are in course order.
// The same input gives the same groups in the same order.
export function groupTopics(stored: readonly StoredTopic[], lessons: readonly LessonNames[]): Grouping {
  const sets = new NameSets();
  const byId = new Map(stored.map((topic) => [topic.id, topic]));
  const ordered = [...stored].sort(byAge);
  // A stored topic always has its own key, so a topic whose names are all empty still has a group.
  const topicKey = (topic: StoredTopic): string => `\u0000${topic.id}`;

  const live = ordered.filter((topic) => topic.merged_into === null);
  const merged: { topic: StoredTopic; target: StoredTopic | null }[] = ordered
    .filter((topic) => topic.merged_into !== null)
    .map((topic) => ({ topic, target: finalTarget(topic, byId) }));

  // The names of a stored topic are one topic. The names of a merged topic join the topic that replaced it.
  for (const topic of live) {
    sets.find(topicKey(topic));
    for (const [normalized] of storedNames(topic)) sets.join(topicKey(topic), normalized);
  }
  for (const { topic, target } of merged) {
    if (!target) continue;
    for (const [normalized] of storedNames(topic)) sets.join(topicKey(target), normalized);
  }
  // A candidate with a sameAs name joins the known topic of that name.
  for (const lesson of lessons) {
    for (const candidate of lesson.topics) {
      const normalized = normalizeName(candidate.name);
      if (!normalized) continue;
      sets.find(normalized);
      const same = candidate.sameAs === null ? "" : normalizeName(candidate.sameAs);
      if (same) sets.join(normalized, same);
    }
  }

  const groups: TopicGroup[] = [];
  const byRoot = new Map<string, TopicGroup>();
  const groupOf = (key: string): TopicGroup => {
    const root = sets.find(key);
    let group = byRoot.get(root);
    if (!group) {
      group = { index: groups.length, stored: [], merged: [], names: new Map(), candidates: [] };
      byRoot.set(root, group);
      groups.push(group);
    }
    return group;
  };
  const addName = (group: TopicGroup, normalized: string, text: string): void => {
    if (normalized && !group.names.has(normalized)) group.names.set(normalized, text);
  };

  for (const topic of live) {
    const group = groupOf(topicKey(topic));
    group.stored.push(topic);
    for (const [normalized, text] of storedNames(topic)) addName(group, normalized, text);
  }
  const detached: StoredTopic[] = [];
  for (const { topic, target } of merged) {
    if (!target) {
      detached.push(topic);
      continue;
    }
    const group = groupOf(topicKey(target));
    group.merged.push(topic);
    for (const [normalized, text] of storedNames(topic)) addName(group, normalized, text);
  }

  let seq = 0;
  const candidateGroup = lessons.map((lesson, lessonIndex) =>
    lesson.topics.map((candidate, topicIndex) => {
      const normalized = normalizeName(candidate.name);
      if (!normalized) return null;
      const group = groupOf(normalized);
      addName(group, normalized, candidate.name.trim());
      if (candidate.sameAs !== null) addName(group, normalizeName(candidate.sameAs), candidate.sameAs.trim());
      group.candidates.push({ lesson: lessonIndex, topic: topicIndex, seq });
      seq += 1;
      return group;
    }),
  );

  const byName = new Map<string, TopicGroup>();
  for (const group of groups) {
    for (const normalized of group.names.keys()) byName.set(normalized, group);
  }
  return { groups, byName, candidateGroup, detached };
}

// The name that the map shows for a group: the name of the stored topic that keeps its id,
// or the first candidate name in course order.
export function groupName(group: TopicGroup, lessons: readonly LessonNames[]): string {
  const kept = group.stored.at(0);
  if (kept) return kept.name;
  const first = group.candidates.at(0);
  const candidate = first ? lessons[first.lesson].topics[first.topic] : undefined;
  return candidate?.name.trim() ?? group.names.values().next().value ?? "";
}

// Compare two numbers. Infinity is equal to Infinity.
function compareNumbers(first: number, second: number): number {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

export interface KnownTopic {
  ref: number;
  name: string;
  aliases: string[];
}

// The known topics of one engine request: the topics of the course whose name or alias name shares a word of
// 3 or more letters with the text of the request. The list holds at most `limit` topics, in lesson order.
// A topic with no candidate, for example a retired topic, comes after the topics of the lessons.
export function knownTopicsFor(
  grouping: Grouping,
  lessons: readonly LessonNames[],
  text: string,
  limit = MAX_KNOWN_TOPICS,
): KnownTopic[] {
  const words = textWords(text);
  const sharesWord = (names: Iterable<string>): boolean => {
    for (const name of names) {
      for (const word of textWords(name)) if (words.has(word)) return true;
    }
    return false;
  };

  const selected = grouping.groups
    .filter((group) => group.stored.length > 0 || group.candidates.length > 0)
    .filter((group) => sharesWord(group.names.values()))
    .map((group) => {
      const positions = group.candidates.map((candidate) => lessons[candidate.lesson].position);
      return {
        group,
        firstLesson: Math.min(Infinity, ...positions),
        firstSeq: group.candidates.at(0)?.seq ?? Infinity,
      };
    })
    .sort(
      (a, b) =>
        compareNumbers(a.firstLesson, b.firstLesson) ||
        compareNumbers(a.firstSeq, b.firstSeq) ||
        a.group.index - b.group.index,
    )
    .slice(0, limit);

  return selected.map(({ group }, index) => {
    const name = groupName(group, lessons);
    const own = normalizeName(name);
    const aliases = [...group.names]
      .filter(([normalized, alias]) => normalized !== own && alias.length <= MAX_NAME_CHARACTERS)
      .map(([, alias]) => alias)
      .slice(0, MAX_ALIASES);
    return { ref: index + 1, name: name.slice(0, MAX_NAME_CHARACTERS), aliases };
  });
}
