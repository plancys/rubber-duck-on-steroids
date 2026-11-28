// The adjusted lesson list of a course, as a pure function of the lessons, the lesson map and the known topics.
// The course page reads the map with course_lesson_map and the events with learner_course_events, and joins them
// here. It uses no Astro API. Its runtime imports are sibling modules with the .ts extension, so node --test can run
// its tests.

import type { createClient } from "@/lib/supabase";
import { knownLiveTopicIds, parseLearnerEvents, type LearnerEvent } from "./learner-state.ts";
import type { MergedTopic } from "./topics.ts";

type Client = NonNullable<ReturnType<typeof createClient>>;

/**
 * The name of the rule of lessonPath: skip a lesson when the learner knows every topic that it explains, move a
 * needed lesson up, and give a gap note for a needed topic that no lesson explains.
 */
export const LESSON_PATH_POLICY = "path-1";

/**
 * The state of the analysis of a loaded lesson. changed: the analysis read another text of the lesson, or the
 * analysis is newer than the map.
 */
export type LessonAnalysisState = "current" | "changed" | "failed";

/** The document of course_lesson_map. It holds map data only, and no learner data. */
export interface CourseLessonMap {
  // The analysis state of each loaded lesson with an analysis, by lesson URL.
  analyses: Map<string, LessonAnalysisState>;
  // The live topics of the course with their home lesson.
  topics: { id: string; name: string; homeLessonUrl: string }[];
  // Each pair of a lesson and a live topic that the lesson explains. A mention does not count.
  explains: { lessonUrl: string; topicId: string }[];
  // The learner must know the from topic before the to topic.
  prerequisites: { fromTopicId: string; toTopicId: string }[];
  merged: MergedTopic[];
}

type LessonMapTopic = CourseLessonMap["topics"][number];

// The parse function accepts any value and drops the items that do not fit, as parseTopicList does.

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isAnalysisState(value: unknown): value is LessonAnalysisState {
  return value === "current" || value === "changed" || value === "failed";
}

/** Reads the document of course_lesson_map. Null when the caller cannot see the course. */
export function parseCourseLessonMap(data: unknown): CourseLessonMap | null {
  if (!isObject(data)) return null;

  const analyses = new Map<string, LessonAnalysisState>();
  for (const item of list(field(data, "analyses"))) {
    const lessonUrl = text(field(item, "lesson_url"));
    const state = field(item, "state");
    if (lessonUrl !== null && isAnalysisState(state)) analyses.set(lessonUrl, state);
  }

  const topics = list(field(data, "topics")).flatMap((item): LessonMapTopic[] => {
    const id = text(field(item, "id"));
    const name = text(field(item, "name"));
    const homeLessonUrl = text(field(item, "home_lesson_url"));
    if (id === null || name === null || homeLessonUrl === null) return [];
    return [{ id, name, homeLessonUrl }];
  });

  const explains = list(field(data, "explains")).flatMap((item): CourseLessonMap["explains"] => {
    const lessonUrl = text(field(item, "lesson_url"));
    const topicId = text(field(item, "topic_id"));
    if (lessonUrl === null || topicId === null) return [];
    return [{ lessonUrl, topicId }];
  });

  const prerequisites = list(field(data, "prerequisites")).flatMap((item): CourseLessonMap["prerequisites"] => {
    const fromTopicId = text(field(item, "from_topic_id"));
    const toTopicId = text(field(item, "to_topic_id"));
    if (fromTopicId === null || toTopicId === null) return [];
    return [{ fromTopicId, toTopicId }];
  });

  const merged = list(field(data, "merged")).flatMap((item): MergedTopic[] => {
    const id = text(field(item, "id"));
    const mergedInto = text(field(item, "merged_into"));
    if (id === null || mergedInto === null) return [];
    return [{ id, mergedInto }];
  });

  return { analyses, topics, explains, prerequisites, merged };
}

/** A lesson row of the course page. */
export interface PathLessonInput {
  url: string;
  position: number;
  title: string | null;
  // The load status: loaded or failed. Each status other than loaded gives the state not_loaded.
  status: string;
  error: string | null;
}

/**
 * The state of a lesson in the path. open: the lesson explains a topic that the learner does not know.
 * skipped: the learner knows every topic that the lesson explains. not_loaded: the lesson did not load.
 * not_analysed: the lesson has no current analysis. no_topics: the lesson explains no live topic.
 * The list never skips a lesson in the last three states.
 */
export type PathState = "open" | "skipped" | "not_loaded" | "not_analysed" | "no_topics";

/** A live topic that a lesson explains. */
export interface PathTopic {
  id: string;
  name: string;
  known: boolean;
  // The course position of the home lesson of the topic, or null when that lesson is not in the input.
  homePosition: number | null;
}

/** The reason of a lesson that moved up. */
export interface PathMove {
  // The lesson whose walk placed the moved lesson.
  position: number;
  title: string | null;
  // The topic names. The topic of that lesson needs the prerequisite, which the moved lesson explains first.
  pairs: { topic: string; prerequisite: string }[];
}

/** A gap note: a topic that the lesson explains first needs a prerequisite that no lesson explains. */
export interface PathGap {
  // The topic names.
  topic: string;
  prerequisite: string;
  // The course position of the home lesson of the prerequisite, or null when that lesson is not in the input.
  mentionPosition: number | null;
}

/** A lesson of the adjusted list. */
export interface PathLesson extends PathLessonInput {
  state: PathState;
  // The live topics that the lesson explains, sorted by name, then by id.
  topics: PathTopic[];
  // The number of these topics that the learner knows.
  knownCount: number;
  movedUp: PathMove | null;
  gaps: PathGap[];
}

// A prerequisite relation between two live topics. The learner must know the prerequisite before the topic.
interface TopicPair {
  topic: LessonMapTopic;
  prerequisite: LessonMapTopic;
}

// Sorts by name, then by id, so the same map always gives the same order.
function byName(a: { id: string; name: string }, b: { id: string; name: string }): number {
  return a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en");
}

function byPair(a: TopicPair, b: TopicPair): number {
  return byName(a.topic, b.topic) || byName(a.prerequisite, b.prerequisite);
}

// The topic names of each pair, sorted by the topic, then by the prerequisite.
function pairNames(pairs: readonly TopicPair[]): PathMove["pairs"] {
  return [...pairs].sort(byPair).map((pair) => ({ topic: pair.topic.name, prerequisite: pair.prerequisite.name }));
}

/**
 * The loop number of each lesson. Lessons that need each other, directly or through a chain, have the same number.
 * A lesson in no loop has a number of its own. This is the algorithm of Tarjan for strongly connected components.
 */
function loopNumbers(needs: readonly ReadonlyMap<number, unknown>[]): number[] {
  const loop = needs.map(() => -1);
  const found = needs.map(() => -1);
  const low = needs.map(() => -1);
  const stack: number[] = [];
  const onStack = new Set<number>();
  let next = 0;
  let loops = 0;
  function visit(index: number): void {
    found[index] = next;
    low[index] = next;
    next += 1;
    stack.push(index);
    onStack.add(index);
    for (const target of needs[index].keys()) {
      if (found[target] === -1) {
        visit(target);
        low[index] = Math.min(low[index], low[target]);
      } else if (onStack.has(target)) {
        low[index] = Math.min(low[index], found[target]);
      }
    }
    if (low[index] !== found[index]) return;
    // The lesson is the first lesson of its loop that the search found, so the stack above it holds its loop.
    let member: number | undefined;
    do {
      member = stack.pop();
      if (member !== undefined) {
        onStack.delete(member);
        loop[member] = loops;
      }
    } while (member !== undefined && member !== index);
    loops += 1;
  }
  for (const index of needs.keys()) {
    if (found[index] === -1) visit(index);
  }
  return loop;
}

// A lesson that did not load, has no current analysis or explains no live topic is never skipped.
function pathState(
  lesson: PathLessonInput,
  analysis: LessonAnalysisState | undefined,
  topicCount: number,
  knownCount: number,
): PathState {
  if (lesson.status !== "loaded") return "not_loaded";
  if (analysis !== "current") return "not_analysed";
  if (topicCount === 0) return "no_topics";
  return knownCount === topicCount ? "skipped" : "open";
}

/**
 * The adjusted lesson list of LESSON_PATH_POLICY. It gives each input lesson exactly once.
 * Skip: a lesson is skipped when it explains at least one live topic, and the learner knows each of these topics.
 * Need: when a prerequisite relation goes from a topic p to a topic t, and the learner knows neither topic, the first
 * lesson in course order that explains t needs the first lesson that explains p. When no lesson explains p, the first
 * lesson that explains t gets a gap note.
 * Order: the walk takes the lessons in course order. Before it places a lesson, it places the lessons that this lesson
 * needs, in course order, with their own needs first. A lesson that the walk of another lesson places moves up.
 * Loop: lessons that need each other keep the course order. Inside a loop, a need of an earlier lesson on a later
 * lesson does not move the later lesson.
 * It ignores an explains pair or a relation that names a lesson URL or a topic id outside the input. A home lesson
 * outside the input gives a null position.
 */
export function lessonPath(
  lessons: readonly PathLessonInput[],
  map: CourseLessonMap,
  known: ReadonlySet<string>,
): PathLesson[] {
  // The lessons in course order. The walk keys each lesson by its index, so it cannot lose or double a lesson.
  const course = [...lessons].sort((a, b) => a.position - b.position);
  const indexOfUrl = new Map<string, number>();
  for (const [index, lesson] of course.entries()) {
    if (!indexOfUrl.has(lesson.url)) indexOfUrl.set(lesson.url, index);
  }
  const positionOf = (url: string): number | null => {
    const index = indexOfUrl.get(url);
    return index === undefined ? null : course[index].position;
  };

  // The live topics that each lesson explains.
  const topicsById = new Map(map.topics.map((topic) => [topic.id, topic]));
  const explained = course.map(() => new Map<string, LessonMapTopic>());
  for (const pair of map.explains) {
    const index = indexOfUrl.get(pair.lessonUrl);
    const topic = topicsById.get(pair.topicId);
    if (index !== undefined && topic !== undefined) explained[index].set(topic.id, topic);
  }

  // The first explainer of each topic: the first lesson in course order that explains it.
  const firstExplainer = new Map<string, number>();
  for (const [index, topics] of explained.entries()) {
    for (const topicId of topics.keys()) {
      if (!firstExplainer.has(topicId)) firstExplainer.set(topicId, index);
    }
  }

  // For each lesson: the lessons that it needs with their topic pairs, and its gap notes.
  const needs = course.map(() => new Map<number, TopicPair[]>());
  const gaps = course.map((): TopicPair[] => []);
  for (const relation of map.prerequisites) {
    const topic = topicsById.get(relation.toTopicId);
    const prerequisite = topicsById.get(relation.fromTopicId);
    if (topic === undefined || prerequisite === undefined) continue;
    if (known.has(topic.id) || known.has(prerequisite.id)) continue;
    const needer = firstExplainer.get(topic.id);
    if (needer === undefined) continue;
    const needed = firstExplainer.get(prerequisite.id);
    if (needed === undefined) {
      gaps[needer].push({ topic, prerequisite });
    } else if (needed !== needer) {
      const pairs = needs[needer].get(needed) ?? [];
      pairs.push({ topic, prerequisite });
      needs[needer].set(needed, pairs);
    }
  }

  // Lessons that need each other keep the course order. So inside a loop, the walk drops each need of an earlier
  // lesson on a later lesson. A need of a later lesson on an earlier lesson stays: the course order meets it, and it
  // brings the earlier lesson along when a lesson outside the loop moves the later lesson up. Each loop then holds
  // needs that point back in the course only, so the needs have no loop left.
  const loop = loopNumbers(needs);
  for (const [index, targets] of needs.entries()) {
    for (const target of [...targets.keys()]) {
      if (target > index && loop[target] === loop[index]) targets.delete(target);
    }
  }

  // The walk of the order. A queue sort gives another result, so the order of the calls matters.
  const order: number[] = [];
  const placed = new Set<number>();
  const walking = new Set<number>();
  // The lesson whose walk placed each moved lesson. When the course order reaches a lesson, each lesson before it in
  // the course is in the list. So each lesson that its walk places comes after it in the course and before it in the
  // list, and moved up. A lesson that the course order places did not move.
  const placedBy = new Map<number, number>();
  function place(index: number, by: number | null): void {
    // A lesson that is still on the walk is not placed again. The needs have no loop, so this check is a guard only.
    if (placed.has(index) || walking.has(index)) return;
    walking.add(index);
    for (const need of [...needs[index].keys()].sort((a, b) => a - b)) place(need, index);
    walking.delete(index);
    placed.add(index);
    order.push(index);
    if (by !== null) placedBy.set(index, by);
  }
  for (const index of course.keys()) place(index, null);

  return order.map((index): PathLesson => {
    const lesson = course[index];
    const topics = [...explained[index].values()]
      .map((topic): PathTopic => ({
        id: topic.id,
        name: topic.name,
        known: known.has(topic.id),
        homePosition: positionOf(topic.homeLessonUrl),
      }))
      .sort(byName);
    const knownCount = topics.filter((topic) => topic.known).length;
    const by = placedBy.get(index);
    const movedUp: PathMove | null =
      by === undefined
        ? null
        : { position: course[by].position, title: course[by].title, pairs: pairNames(needs[by].get(index) ?? []) };
    return {
      url: lesson.url,
      position: lesson.position,
      title: lesson.title,
      status: lesson.status,
      error: lesson.error,
      state: pathState(lesson, map.analyses.get(lesson.url), topics.length, knownCount),
      topics,
      knownCount,
      movedUp,
      gaps: [...gaps[index]].sort(byPair).map((pair): PathGap => ({
        topic: pair.topic.name,
        prerequisite: pair.prerequisite.name,
        mentionPosition: positionOf(pair.prerequisite.homeLessonUrl),
      })),
    };
  });
}

/** The numbers of the summary line of the course page. */
export function pathCounts(path: readonly PathLesson[]): { skipped: number; moved: number; total: number } {
  return {
    skipped: path.filter((lesson) => lesson.state === "skipped").length,
    moved: path.filter((lesson) => lesson.movedUp !== null).length,
    total: path.length,
  };
}

/**
 * The live topics of the map that the learner knows. knownLiveTopicIds holds the rule, which the checklist also uses:
 * it follows the merges of the map, and a topic counts when its state is claimed.
 */
export function knownLiveTopics(events: readonly LearnerEvent[], map: CourseLessonMap): Set<string> {
  const merges = new Map(map.merged.map((topic) => [topic.id, topic.mergedInto]));
  return knownLiveTopicIds(events, merges, new Set(map.topics.map((topic) => topic.id)));
}

/** The lesson map of a course and the known topics of the learner, or an error of a read. */
export type LessonMapMarks = { error: true } | { map: CourseLessonMap | null; known: Set<string> };

/**
 * Reads the lesson map of a course and the events of the learner in parallel, and joins them in code. No database
 * function joins the map with learner data (rule 6). map is null when the learner cannot see the course. known holds
 * the live topics in the state claimed. error is true when a read fails, so a page can tell a failed read from a
 * course that it cannot show.
 */
export async function readLessonPath(supabase: Client, courseId: string): Promise<LessonMapMarks> {
  const [mapResult, eventsResult] = await Promise.all([
    supabase.rpc("course_lesson_map", { course_id: courseId }),
    supabase.rpc("learner_course_events", { course_id: courseId }),
  ]);
  if (mapResult.error || eventsResult.error) return { error: true };

  const map = parseCourseLessonMap(mapResult.data);
  if (!map) return { map: null, known: new Set<string>() };
  return { map, known: knownLiveTopics(parseLearnerEvents(eventsResult.data), map) };
}
