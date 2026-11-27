// The map build: a pure function that builds the full map of a course from the stored lesson results.
// The same input gives the same output. The handler sends the output to finish_topic_map.
//
// The graph rules, in this order:
// 1. A relation needs two different topics with a link in the course.
// 2. A topic has at most one parent. The first part_of relation in lesson order wins.
//    A part_of relation that closes a cycle is removed.
// 3. A prerequisite relation between a topic and one of its ancestors is removed.
// 4. The prerequisite relations have no cycle. When a relation closes a cycle, the rule removes the relation of that
//    cycle that points against the lesson order. With no such relation, it removes the relation from the later passage.
// "Lesson order" is the order of the source passages: the lesson position, then the passage position.
// A relation points against the lesson order when the home lesson of its first topic comes after the home lesson
// of its second topic.

import type { MapLink, MapRelation, MapTopic, StoredTopic, TopicAlias, TopicMapState } from "../queue.ts";
import { groupName, groupTopics, newTopicId, normalizeName, type LessonNames, type TopicGroup } from "./identity.ts";
import {
  emptyRemovals,
  SCHEMA_REASONS,
  type LessonResult,
  type QuoteRemovals,
  type RelationKind,
  type ResultTopic,
  type SchemaReason,
} from "./schema.ts";

export type LessonState = "analysed" | "failed" | "none";

export interface BuildLesson {
  url: string;
  position: number;
  title: string | null;
  // The status of the last analysis of the lesson, or none.
  state: LessonState;
  // The last good result of the lesson, also for a failed lesson. Null when the lesson has no result.
  result: LessonResult | null;
  model: string | null;
}

// The facts of the run that the report shows.
export interface RunFacts {
  // Lessons with a new result from the engine in this run.
  analysed: number;
  // Lessons with a stored result and no engine call in this run.
  reused: number;
  inputTokens: number;
  outputTokens: number;
  engine: string;
  promptVersion: string;
  durationMs: number;
}

export interface BuildInput {
  courseId: string;
  // The loaded lessons of the course.
  lessons: readonly BuildLesson[];
  // The stored topics of the course.
  topics: readonly StoredTopic[];
  run: RunFacts;
}

export interface OverviewLesson {
  url: string;
  position: number;
  title: string | null;
  state: LessonState;
  // The topics whose home lesson is this lesson.
  topics: number;
}

// One arrow between two lessons: the number of topic pairs with a prerequisite relation from a topic of the first
// lesson to a topic of the second lesson. A lesson is the home lesson of a topic.
export interface OverviewArrow {
  from: number;
  to: number;
  count: number;
}

export interface MapOverview {
  lessons: OverviewLesson[];
  arrows: OverviewArrow[];
}

// The relations that each graph rule removed:
// unknownTopic: an end that names no topic of the course.
// topicWithoutLink: an end topic with no link in the course.
// selfRelation: a relation of a topic to itself after the identity check.
// duplicate: a second copy of the same relation from the same passage.
// secondParent, partOfCycle, ancestorPrerequisite, prerequisiteCycle: the rules 2 to 4 at the top of this file.
export const GRAPH_RULES = [
  "unknownTopic",
  "topicWithoutLink",
  "selfRelation",
  "duplicate",
  "secondParent",
  "partOfCycle",
  "ancestorPrerequisite",
  "prerequisiteCycle",
] as const;
export type GraphRule = (typeof GRAPH_RULES)[number];

export interface MapReport {
  lessons: { loaded: number; analysed: number; reused: number; failed: number; none: number };
  passages: { total: number; withoutTopic: number };
  // The least, the middle and the largest number of topics of a lesson with a result.
  topics: {
    live: number;
    retired: number;
    merged: number;
    perLesson: { least: number; middle: number; largest: number };
  };
  schemaRemoved: Record<SchemaReason, number>;
  quoteRemoved: QuoteRemovals;
  graphRemoved: Record<GraphRule, number>;
  // The share of prerequisite relations against the lesson order, from 0 to 1.
  prerequisites: { total: number; againstLessonOrder: number; share: number };
  // The tokens of the engine calls of this run.
  tokens: { input: number; output: number };
  // The models of the stored results of the map.
  models: string[];
  engine: string;
  promptVersion: string;
  durationMs: number;
}

export interface TopicMap extends TopicMapState {
  overview: MapOverview;
  report: MapReport;
}

type ResultLesson = BuildLesson & { result: LessonResult };

// One relation of the build, with the place of its source passage.
interface Relation {
  kind: RelationKind;
  from: string;
  to: string;
  reason: string;
  lessonUrl: string;
  lessonPosition: number;
  position: number;
  // The place of the relation in lesson order.
  order: number;
}

// The prerequisite relations of one pair of topics. seq is the place of the first relation of the pair.
interface PairEdge {
  from: string;
  to: string;
  rows: Relation[];
  seq: number;
}

function aliasList(names: Iterable<[string, string]>): TopicAlias[] {
  const byNormalized = new Map<string, string>();
  for (const [normalized, alias] of names) {
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, alias);
  }
  return [...byNormalized]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([normalized, alias]) => ({ alias, normalized }));
}

function storedAliases(topic: StoredTopic): TopicAlias[] {
  return aliasList(
    [topic.name, ...topic.aliases.map((alias) => alias.alias)].map((text) => [normalizeName(text), text]),
  );
}

function compareText(first: string, second: string): number {
  if (first === second) return 0;
  return first < second ? -1 : 1;
}

function middle(values: number[]): { least: number; middle: number; largest: number } {
  if (values.length === 0) return { least: 0, middle: 0, largest: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    least: sorted[0],
    middle: sorted[Math.floor((sorted.length - 1) / 2)],
    largest: sorted[sorted.length - 1],
  };
}

export function buildTopicMap(input: BuildInput): TopicMap {
  const lessons = [...input.lessons].sort((a, b) => a.position - b.position);
  const withResult = lessons.filter((lesson): lesson is ResultLesson => lesson.result !== null);
  const names: LessonNames[] = withResult.map((lesson) => ({
    position: lesson.position,
    topics: lesson.result.topics,
  }));
  const grouping = groupTopics(input.topics, names);

  // The id of each topic: the oldest stored topic of the group, or a new id.
  const taken = new Set(input.topics.map((topic) => topic.id));
  const ids = new Map<TopicGroup, string>();
  for (const group of grouping.groups) {
    const kept = group.stored.at(0);
    const id = kept ? kept.id : newTopicId(input.courseId, normalizeName(groupName(group, names)), taken);
    taken.add(id);
    ids.set(group, id);
  }
  const idOf = (group: TopicGroup): string => {
    const id = ids.get(group);
    if (id === undefined) throw new Error("The map build lost the id of a topic.");
    return id;
  };

  // The links. One passage gives one link for each topic. explains wins over mentions, then the first link wins.
  const links = new Map<string, MapLink & { lessonPosition: number }>();
  withResult.forEach((lesson, lessonIndex) => {
    lesson.result.topics.forEach((topic, topicIndex) => {
      const group = grouping.candidateGroup[lessonIndex][topicIndex];
      if (!group) return;
      const topicId = idOf(group);
      for (const link of topic.links) {
        const key = `${topicId}\n${lesson.url}\n${link.position}`;
        const existing = links.get(key);
        if (existing && !(existing.role === "mentions" && link.role === "explains")) continue;
        links.set(key, {
          topic_id: topicId,
          lesson_url: lesson.url,
          position: link.position,
          role: link.role,
          quote: link.quote,
          quote_start: link.quoteStart,
          lessonPosition: lesson.position,
        });
      }
    });
  });
  const linkList = [...links.values()].sort(
    (a, b) => a.lessonPosition - b.lessonPosition || a.position - b.position || compareText(a.topic_id, b.topic_id),
  );

  // The home lesson of each topic: the first lesson with an explains link, else the first lesson with a link.
  const home = new Map<string, { url: string; position: number }>();
  const explained = new Set<string>();
  for (const link of linkList) {
    const current = home.get(link.topic_id);
    if (link.role === "explains" && !explained.has(link.topic_id)) {
      explained.add(link.topic_id);
      home.set(link.topic_id, { url: link.lesson_url, position: link.lessonPosition });
    } else if (!current) {
      home.set(link.topic_id, { url: link.lesson_url, position: link.lessonPosition });
    }
  }
  const homePosition = (topicId: string): number => home.get(topicId)?.position ?? Infinity;

  // The relations in lesson order, with both ends as topic ids.
  const graphRemoved = Object.fromEntries(GRAPH_RULES.map((rule) => [rule, 0])) as Record<GraphRule, number>;
  const candidates: Relation[] = [];
  withResult.forEach((lesson) => {
    for (const relation of lesson.result.relations) {
      const fromGroup = grouping.byName.get(normalizeName(relation.from));
      const toGroup = grouping.byName.get(normalizeName(relation.to));
      if (!fromGroup || !toGroup) {
        graphRemoved.unknownTopic += 1;
        continue;
      }
      const from = idOf(fromGroup);
      const to = idOf(toGroup);
      if (!home.has(from) || !home.has(to)) {
        graphRemoved.topicWithoutLink += 1;
        continue;
      }
      if (from === to) {
        graphRemoved.selfRelation += 1;
        continue;
      }
      candidates.push({
        kind: relation.kind,
        from,
        to,
        reason: relation.reason,
        lessonUrl: lesson.url,
        lessonPosition: lesson.position,
        position: relation.position,
        order: candidates.length,
      });
    }
  });
  candidates.sort((a, b) => a.lessonPosition - b.lessonPosition || a.position - b.position || a.order - b.order);
  const seen = new Set<string>();
  const ordered: Relation[] = [];
  for (const relation of candidates) {
    const key = [relation.kind, relation.from, relation.to, relation.lessonUrl, relation.position].join("\n");
    if (seen.has(key)) {
      graphRemoved.duplicate += 1;
      continue;
    }
    seen.add(key);
    ordered.push({ ...relation, order: ordered.length });
  }

  // Rule 2: one parent for each topic, and no part_of cycle.
  const parent = new Map<string, string>();
  // True when `ancestor` is `topic` or a topic above it.
  const isAncestorOrSelf = (ancestor: string, topic: string): boolean => {
    const visited = new Set<string>();
    for (let current: string | undefined = topic; current !== undefined; current = parent.get(current)) {
      if (current === ancestor) return true;
      if (visited.has(current)) return false;
      visited.add(current);
    }
    return false;
  };
  const partOf: Relation[] = [];
  for (const relation of ordered.filter((item) => item.kind === "part_of")) {
    const current = parent.get(relation.from);
    if (current !== undefined) {
      if (current === relation.to) partOf.push(relation);
      else graphRemoved.secondParent += 1;
      continue;
    }
    if (isAncestorOrSelf(relation.from, relation.to)) {
      graphRemoved.partOfCycle += 1;
      continue;
    }
    parent.set(relation.from, relation.to);
    partOf.push(relation);
  }

  // Rule 3: no prerequisite between a topic and one of its ancestors.
  const prerequisites = ordered.filter((relation) => {
    if (relation.kind !== "prerequisite") return false;
    if (isAncestorOrSelf(relation.from, relation.to) || isAncestorOrSelf(relation.to, relation.from)) {
      graphRemoved.ancestorPrerequisite += 1;
      return false;
    }
    return true;
  });

  // Rule 4: no prerequisite cycle.
  const edges = new Map<string, PairEdge>();
  const outgoing = new Map<string, PairEdge[]>();
  const pairKey = (from: string, to: string): string => `${from}\n${to}`;
  const removeEdge = (edge: PairEdge): void => {
    edges.delete(pairKey(edge.from, edge.to));
    outgoing.set(
      edge.from,
      (outgoing.get(edge.from) ?? []).filter((item) => item !== edge),
    );
    graphRemoved.prerequisiteCycle += edge.rows.length;
  };
  // The edges of a path from `start` to `goal`, or null. The search follows the edges in the order of their creation.
  const findPath = (start: string, goal: string): PairEdge[] | null => {
    const previous = new Map<string, PairEdge | null>([[start, null]]);
    const queue = [start];
    // The loop also visits each topic that it adds to the queue.
    for (const topic of queue) {
      if (topic === goal) {
        const path: PairEdge[] = [];
        for (let edge = previous.get(goal) ?? null; edge; edge = previous.get(edge.from) ?? null) path.unshift(edge);
        return path;
      }
      for (const edge of outgoing.get(topic) ?? []) {
        if (previous.has(edge.to)) continue;
        previous.set(edge.to, edge);
        queue.push(edge.to);
      }
    }
    return null;
  };
  prerequisites.forEach((relation, seq) => {
    const existing = edges.get(pairKey(relation.from, relation.to));
    if (existing) {
      existing.rows.push(relation);
      return;
    }
    const edge: PairEdge = { from: relation.from, to: relation.to, rows: [relation], seq };
    edges.set(pairKey(edge.from, edge.to), edge);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    for (;;) {
      const path = findPath(edge.to, edge.from);
      if (!path) break;
      const cycle = [...path, edge];
      const against = cycle.filter((item) => homePosition(item.from) > homePosition(item.to));
      const pool = against.length > 0 ? against : cycle;
      const removed = pool.reduce((latest, item) => (item.seq > latest.seq ? item : latest));
      removeEdge(removed);
      if (removed === edge) break;
    }
  });
  const keptPrerequisites = [...edges.values()].flatMap((edge) => edge.rows);

  const relations: MapRelation[] = [...partOf, ...keptPrerequisites]
    .sort((a, b) => a.order - b.order)
    .map((relation) => ({
      kind: relation.kind,
      from_topic_id: relation.from,
      to_topic_id: relation.to,
      reason: relation.reason,
      lesson_url: relation.lessonUrl,
      position: relation.position,
    }));

  // The topics of the state: each group, the stored topics that merge into it, and the detached topics.
  const candidateOf = (group: TopicGroup): ResultTopic[] =>
    group.candidates.map((candidate) => withResult[candidate.lesson].result.topics[candidate.topic]);
  const topics: MapTopic[] = [];
  for (const group of grouping.groups) {
    const id = idOf(group);
    const kept = group.stored.at(0);
    const found = candidateOf(group);
    const describing = found.find((topic) => topic.links.some((link) => link.role === "explains")) ?? found.at(0);
    const description = describing?.description ?? "";
    topics.push({
      id,
      name: kept ? kept.name : groupName(group, names),
      description: description !== "" ? description : (kept?.description ?? null),
      aliases: aliasList(group.names),
      home_lesson_url: home.get(id)?.url ?? null,
      merged_into: null,
      retired: !home.has(id),
    });
    for (const other of [...group.stored.slice(1), ...group.merged]) {
      topics.push({
        id: other.id,
        name: other.name,
        description: other.description,
        aliases: storedAliases(other),
        home_lesson_url: null,
        merged_into: id,
        retired: false,
      });
    }
  }
  for (const topic of grouping.detached) {
    topics.push({
      id: topic.id,
      name: topic.name,
      description: topic.description,
      aliases: storedAliases(topic),
      home_lesson_url: null,
      merged_into: topic.merged_into,
      retired: topic.retired_at !== null,
    });
  }
  topics.sort((a, b) => compareText(a.id, b.id));

  // The overview: the lessons with their home topics, and the arrows between lessons.
  const homeCount = new Map<string, number>();
  for (const topic of topics) {
    if (topic.home_lesson_url !== null)
      homeCount.set(topic.home_lesson_url, (homeCount.get(topic.home_lesson_url) ?? 0) + 1);
  }
  const arrowCount = new Map<string, OverviewArrow>();
  for (const edge of edges.values()) {
    const from = homePosition(edge.from);
    const to = homePosition(edge.to);
    if (from === to) continue;
    const key = `${from}\n${to}`;
    const arrow = arrowCount.get(key) ?? { from, to, count: 0 };
    arrow.count += 1;
    arrowCount.set(key, arrow);
  }
  const overview: MapOverview = {
    lessons: lessons.map((lesson) => ({
      url: lesson.url,
      position: lesson.position,
      title: lesson.title,
      state: lesson.state,
      topics: homeCount.get(lesson.url) ?? 0,
    })),
    arrows: [...arrowCount.values()].sort((a, b) => a.from - b.from || a.to - b.to),
  };

  // The report.
  const schemaRemoved = emptyRemovals();
  const quoteRemoved: QuoteRemovals = { links: 0, topics: 0, relations: 0 };
  let passages = 0;
  let withoutTopic = 0;
  for (const lesson of withResult) {
    for (const reason of SCHEMA_REASONS) schemaRemoved[reason] += lesson.result.schemaRemoved[reason];
    quoteRemoved.links += lesson.result.quoteRemoved.links;
    quoteRemoved.topics += lesson.result.quoteRemoved.topics;
    quoteRemoved.relations += lesson.result.quoteRemoved.relations;
    passages += lesson.result.passages;
    const linked = new Set(linkList.filter((link) => link.lesson_url === lesson.url).map((link) => link.position));
    withoutTopic += lesson.result.passages - linked.size;
  }
  const against = keptPrerequisites.filter(
    (relation) => homePosition(relation.from) > homePosition(relation.to),
  ).length;
  const models = [...new Set(withResult.map((lesson) => lesson.model).filter((model) => model !== null))].sort(
    compareText,
  );
  const live = topics.filter((topic) => topic.merged_into === null && !topic.retired).length;
  const report: MapReport = {
    lessons: {
      loaded: lessons.length,
      analysed: input.run.analysed,
      reused: input.run.reused,
      failed: lessons.filter((lesson) => lesson.state === "failed").length,
      none: lessons.filter((lesson) => lesson.state === "none").length,
    },
    passages: { total: passages, withoutTopic },
    topics: {
      live,
      retired: topics.filter((topic) => topic.merged_into === null && topic.retired).length,
      merged: topics.filter((topic) => topic.merged_into !== null).length,
      perLesson: middle(withResult.map((lesson) => homeCount.get(lesson.url) ?? 0)),
    },
    schemaRemoved,
    quoteRemoved,
    graphRemoved,
    prerequisites: {
      total: keptPrerequisites.length,
      againstLessonOrder: against,
      share: keptPrerequisites.length === 0 ? 0 : Math.round((against / keptPrerequisites.length) * 1000) / 1000,
    },
    tokens: { input: input.run.inputTokens, output: input.run.outputTokens },
    models,
    engine: input.run.engine,
    promptVersion: input.run.promptVersion,
    durationMs: input.run.durationMs,
  };

  return {
    topics,
    links: linkList.map(({ lessonPosition: _lessonPosition, ...link }) => link),
    relations,
    overview,
    report,
  };
}
