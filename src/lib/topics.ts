// Rules and texts of the topic map. The worker in worker/topics/ builds the map. This module is for the web app.
// It has only type imports, so an island can import its functions. The page reads the map and gives it to the island.

import type { Json } from "@/db/database.types";
import type { CourseErrorKey } from "@/lib/courses";
import type { createClient } from "@/lib/supabase";

type Client = NonNullable<ReturnType<typeof createClient>>;

// The Postgres code of a unique violation. The index jobs_one_in_progress_per_user_idx allows one job in progress.
const UNIQUE_VIOLATION = "23505";
// The code of the build_topic_map job trigger: the learner started 5 topic map builds in the last hour.
const TOPIC_QUOTA_EXCEEDED = "RD004";
// The Postgres code of a check violation. The job trigger raises it for a course that is not a ready course
// of the learner. Row-level security hides the course of another learner, so that course gives the same code.
const CHECK_VIOLATION = "23514";

/** The result of a topic job start. */
export type TopicJobOutcome = { kind: "started"; jobId: string } | { kind: "error"; error: CourseErrorKey };

/** The error key of a failed build_topic_map job insert. */
function topicJobErrorKey(code: string): CourseErrorKey {
  if (code === UNIQUE_VIOLATION) return "job_active";
  if (code === TOPIC_QUOTA_EXCEEDED) return "too_many_maps";
  if (code === CHECK_VIOLATION) return "course_not_ready";
  return "unknown";
}

/** Creates the build_topic_map job of a course. The database accepts it only for a ready course of the learner. */
export async function insertTopicJob(supabase: Client, courseId: string): Promise<TopicJobOutcome> {
  const { data, error } = await supabase
    .from("jobs")
    .insert({ type: "build_topic_map", payload: { courseId } })
    .select("id")
    .single();
  if (error) {
    return { kind: "error", error: topicJobErrorKey(error.code) };
  }
  return { kind: "started", jobId: data.id };
}

/** The row of topic_map_state. built_at is null when the course has no map. */
export interface TopicMapStateRow {
  built_at: string | null;
  loaded_lessons: number;
  analysed_lessons: number;
  failed_lessons: number;
  changed_lessons: number;
  gone_lessons: number;
  topic_count: number;
}

export type TopicMapStatus = "none" | "current" | "stale" | "partial";

/**
 * The status of the map of a course, from the row of topic_map_state:
 * none: the course has no map. stale: a lesson is new, has a new text, or is gone since its last analysis.
 * partial: the engine did not analyse each lesson. current: the map matches the lessons.
 */
export function topicMapStatus(state: TopicMapStateRow | null): TopicMapStatus {
  if (!state?.built_at) return "none";
  if (state.changed_lessons > 0 || state.gone_lessons > 0) return "stale";
  if (state.failed_lessons > 0) return "partial";
  return "current";
}

/** The path of the map page of a course, or of one lesson of the map. */
export function topicMapPath(courseId: string, position?: number): string {
  const path = `/dashboard/courses/${courseId}/map`;
  return position === undefined ? path : `${path}?lesson=${position}`;
}

/** The path of the checklist page, where the learner marks the topics of a course that they know. */
export function knownTopicsPath(courseId: string): string {
  return `/dashboard/courses/${courseId}/known`;
}

/** The date and the time of a build, in UTC, for example "2026-11-27 16:22 UTC". */
export function buildTimeText(builtAt: string): string {
  const time = new Date(builtAt);
  if (Number.isNaN(time.getTime())) return builtAt;
  return `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// The forms below follow worker/topics/build.ts (overview, report) and the function topic_map_lesson.
// The page reads them as JSON, so each parse function accepts any value and drops the items that do not fit.

export type LessonState = "analysed" | "failed" | "none";

export interface OverviewLesson {
  url: string;
  position: number;
  title: string | null;
  state: LessonState;
  // The topics whose home lesson is this lesson.
  topics: number;
}

// One arrow: the number of topic pairs with a prerequisite relation from a topic of the first lesson
// to a topic of the second lesson.
export interface OverviewArrow {
  from: number;
  to: number;
  count: number;
}

export interface MapOverview {
  lessons: OverviewLesson[];
  arrows: OverviewArrow[];
}

export type LinkRole = "explains" | "mentions";

export interface TopicLink {
  lessonUrl: string;
  lessonPosition: number | null;
  lessonTitle: string | null;
  headingPath: string[];
  role: LinkRole;
  quote: string;
}

export interface MapTopic {
  id: string;
  name: string;
  description: string | null;
  parent: { id: string; name: string; homeLessonUrl: string | null } | null;
  // Each lesson of the course that explains or mentions the topic, in course order.
  links: TopicLink[];
}

export type RelationKind = "prerequisite" | "part_of";

// prerequisite: the from topic comes before the to topic. part_of: the from topic is a part of the to topic.
export interface MapRelation {
  kind: RelationKind;
  from: string;
  to: string;
  reason: string | null;
}

// A topic of another lesson at the other end of a relation of this lesson.
export interface OtherTopic {
  id: string;
  name: string;
  homeLessonPosition: number | null;
}

export interface LessonMap {
  lesson: { url: string; position: number; title: string | null };
  // The topics whose home lesson is this lesson, in text order.
  topics: MapTopic[];
  relations: MapRelation[];
  others: OtherTopic[];
}

type JsonObject = Record<string, Json | undefined>;

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: Json | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function wholeNumber(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function count(value: Json | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function list(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function field(value: Json | undefined, key: string): Json | undefined {
  return isObject(value) ? value[key] : undefined;
}

/** Reads course_maps.overview. The lessons come in course order. */
export function parseOverview(value: Json): MapOverview {
  const lessons = list(field(value, "lessons")).flatMap((item): OverviewLesson[] => {
    const url = text(field(item, "url"));
    const position = wholeNumber(field(item, "position"));
    if (url === null || position === null) return [];
    const state = field(item, "state");
    return [
      {
        url,
        position,
        title: text(field(item, "title")),
        state: state === "analysed" || state === "failed" ? state : "none",
        topics: count(field(item, "topics")),
      },
    ];
  });
  lessons.sort((a, b) => a.position - b.position);
  const arrows = list(field(value, "arrows")).flatMap((item): OverviewArrow[] => {
    const from = wholeNumber(field(item, "from"));
    const to = wholeNumber(field(item, "to"));
    if (from === null || to === null || from === to) return [];
    return [{ from, to, count: count(field(item, "count")) }];
  });
  return { lessons, arrows };
}

/** Reads the document of topic_map_lesson. Null when the lesson is not in the course. */
export function parseLessonMap(value: Json): LessonMap | null {
  const lesson = field(value, "lesson");
  const url = text(field(lesson, "url"));
  const position = wholeNumber(field(lesson, "position"));
  if (url === null || position === null) return null;

  const topics = list(field(value, "topics")).flatMap((item): MapTopic[] => {
    const id = text(field(item, "id"));
    const name = text(field(item, "name"));
    if (id === null || name === null) return [];
    const parentValue = field(item, "parent");
    const parentId = text(field(parentValue, "id"));
    const parentName = text(field(parentValue, "name"));
    const links = list(field(item, "links")).flatMap((link): TopicLink[] => {
      const lessonUrl = text(field(link, "lesson_url"));
      const quote = text(field(link, "quote"));
      if (lessonUrl === null || quote === null) return [];
      return [
        {
          lessonUrl,
          lessonPosition: wholeNumber(field(link, "lesson_position")),
          lessonTitle: text(field(link, "lesson_title")),
          headingPath: list(field(link, "heading_path")).flatMap((part) => (typeof part === "string" ? [part] : [])),
          role: field(link, "role") === "explains" ? "explains" : "mentions",
          quote,
        },
      ];
    });
    return [
      {
        id,
        name,
        description: text(field(item, "description")),
        parent:
          parentId !== null && parentName !== null
            ? { id: parentId, name: parentName, homeLessonUrl: text(field(parentValue, "home_lesson_url")) }
            : null,
        links,
      },
    ];
  });

  const relations = list(field(value, "relations")).flatMap((item): MapRelation[] => {
    const kind = field(item, "kind");
    const from = text(field(item, "from_topic_id"));
    const to = text(field(item, "to_topic_id"));
    if ((kind !== "prerequisite" && kind !== "part_of") || from === null || to === null) return [];
    return [{ kind, from, to, reason: text(field(item, "reason")) }];
  });

  const others = list(field(value, "others")).flatMap((item): OtherTopic[] => {
    const id = text(field(item, "id"));
    const name = text(field(item, "name"));
    if (id === null || name === null) return [];
    return [{ id, name, homeLessonPosition: wholeNumber(field(item, "home_lesson_position")) }];
  });

  return { lesson: { url, position, title: text(field(lesson, "title")) }, topics, relations, others };
}

/** The title of a lesson, or "Lesson <position>" when the lesson has no title. */
export function lessonTitle(title: string | null, position: number): string {
  return title?.trim() ? title : `Lesson ${position}`;
}

/** The text mark of a lesson that the engine did not analyse. Null for an analysed lesson. */
export function lessonStateText(state: LessonState): string | null {
  if (state === "failed") return "Analysis failed";
  if (state === "none") return "Not analysed";
  return null;
}

/** The text of the role of a link. */
export function linkRoleText(role: LinkRole): string {
  return role === "explains" ? "Explains" : "Mentions";
}

/** The lesson of a link, for example "Explains in lesson 2: Why is ClickHouse so fast? > Compression". */
export function linkPlaceText(link: TopicLink): string {
  const lesson =
    link.lessonPosition === null
      ? "a lesson that is no longer in the course"
      : `lesson ${link.lessonPosition}: ${lessonTitle(link.lessonTitle, link.lessonPosition)}`;
  const heading = link.headingPath.length > 0 ? ` > ${link.headingPath.join(" > ")}` : "";
  return `${linkRoleText(link.role)} in ${lesson}${heading}`;
}

/** The text of the arrows that leave a lesson, for example "Prerequisite for lesson 2 (3 topic pairs)." */
export function arrowsText(arrows: readonly OverviewArrow[]): string | null {
  if (arrows.length === 0) return null;
  const parts = arrows.map(
    (arrow) => `lesson ${arrow.to} (${arrow.count === 1 ? "1 topic pair" : `${arrow.count} topic pairs`})`,
  );
  return `Prerequisite for ${parts.join(", ")}.`;
}

/** "1 topic" or "<n> topics". */
export function topicCountText(topics: number): string {
  return topics === 1 ? "1 topic" : `${topics} topics`;
}

/** The parent of a topic when the parent is a topic of the same lesson. The map shows it as a box. */
export function homeParentId(map: LessonMap, topic: MapTopic): string | null {
  const parent = topic.parent;
  if (parent === null || parent.id === topic.id) return null;
  return map.topics.some((other) => other.id === parent.id) ? parent.id : null;
}

// Removes the parent of each topic whose chain of parents comes back to a topic, so the chain stops before that
// topic. The topics go in the order of the map, so the same input breaks a loop at the same place.
function stopParentLoops(parents: Map<string, string | null>): void {
  for (const id of parents.keys()) {
    const seen = new Set<string>([id]);
    let current = parents.get(id) ?? null;
    while (current !== null) {
      if (seen.has(current)) {
        parents.set(id, null);
        break;
      }
      seen.add(current);
      current = parents.get(current) ?? null;
    }
  }
}

/**
 * The parent of each topic of the lesson, when the parent is a topic of the same lesson.
 * The build allows no cycle of parents. A chain that comes back to a topic still stops before that topic.
 */
export function topicParents(map: LessonMap): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  for (const topic of map.topics) parents.set(topic.id, homeParentId(map, topic));
  stopParentLoops(parents);
  return parents;
}

/** The anchor of a topic in the outline. */
export function topicAnchor(topicId: string): string {
  return `topic-${topicId}`;
}

/** A topic that a relation of the lesson names: a topic of the lesson, or a topic of another lesson. */
export interface TopicRef {
  id: string;
  name: string;
  // The lesson position of a topic of another lesson. Null for a topic of this lesson.
  lessonPosition: number | null;
  // True for a topic of this lesson.
  home: boolean;
}

/** Finds a topic of the lesson or a topic of another lesson by its id. */
export function topicRef(map: LessonMap, id: string): TopicRef | null {
  const home = map.topics.find((topic) => topic.id === id);
  if (home) return { id, name: home.name, lessonPosition: null, home: true };
  const other = map.others.find((topic) => topic.id === id);
  if (other) return { id, name: other.name, lessonPosition: other.homeLessonPosition, home: false };
  return null;
}

/** The topics that come before a topic: the from topics of its prerequisite relations. */
export function prerequisitesOf(map: LessonMap, topicId: string): TopicRef[] {
  return map.relations.flatMap((relation) => {
    if (relation.kind !== "prerequisite" || relation.to !== topicId) return [];
    const ref = topicRef(map, relation.from);
    return ref ? [ref] : [];
  });
}

/** The lesson position of the parent of a topic when the parent is a topic of another lesson. */
export function parentLessonPosition(map: LessonMap, topic: MapTopic): number | null {
  if (topic.parent === null) return null;
  return map.others.find((other) => other.id === topic.parent?.id)?.homeLessonPosition ?? null;
}

export interface ReportLine {
  label: string;
  value: string;
}

function sumOf(value: Json | undefined): number {
  if (!isObject(value)) return 0;
  return Object.values(value).reduce<number>((sum, item) => sum + count(item), 0);
}

function number(value: Json | undefined): string {
  return count(value).toLocaleString("en-US");
}

/** The lines of the build report from course_maps.report, with the build time. */
export function reportLines(report: Json, builtAt: string): ReportLine[] {
  const lessons = field(report, "lessons");
  const topics = field(report, "topics");
  const perLesson = field(topics, "perLesson");
  const passages = field(report, "passages");
  const prerequisites = field(report, "prerequisites");
  const quoteRemoved = field(report, "quoteRemoved");
  const tokens = field(report, "tokens");
  const models = list(field(report, "models")).flatMap((model) => (typeof model === "string" ? [model] : []));
  const engine = text(field(report, "engine"));
  const promptVersion = text(field(report, "promptVersion"));
  const seconds = Math.round(count(field(report, "durationMs")) / 1000);
  return [
    { label: "Built", value: buildTimeText(builtAt) },
    {
      label: "Lessons",
      value:
        `${number(field(lessons, "loaded"))} loaded, ${number(field(lessons, "analysed"))} analysed in this build, ` +
        `${number(field(lessons, "reused"))} reused, ${number(field(lessons, "failed"))} failed, ` +
        `${number(field(lessons, "none"))} not analysed`,
    },
    {
      label: "Topics",
      value:
        `${number(field(topics, "live"))} in the map, ${number(field(topics, "retired"))} retired, ` +
        `${number(field(topics, "merged"))} merged`,
    },
    {
      label: "Topics in one lesson",
      value:
        `least ${number(field(perLesson, "least"))}, middle ${number(field(perLesson, "middle"))}, ` +
        `largest ${number(field(perLesson, "largest"))}`,
    },
    {
      label: "Passages",
      value: `${number(field(passages, "total"))}, ${number(field(passages, "withoutTopic"))} with no topic`,
    },
    {
      label: "Prerequisites",
      value:
        `${number(field(prerequisites, "total"))}, ` +
        `${number(field(prerequisites, "againstLessonOrder"))} against the lesson order`,
    },
    {
      label: "Removed by the checks",
      value:
        `schema check ${sumOf(field(report, "schemaRemoved")).toLocaleString("en-US")} items, ` +
        `quote check ${number(field(quoteRemoved, "links"))} links, ${number(field(quoteRemoved, "topics"))} topics ` +
        `and ${number(field(quoteRemoved, "relations"))} relations, ` +
        `graph rules ${sumOf(field(report, "graphRemoved")).toLocaleString("en-US")} relations`,
    },
    {
      label: "Tokens of this build",
      value: `${number(field(tokens, "input"))} input, ${number(field(tokens, "output"))} output`,
    },
    { label: "Model", value: models.length > 0 ? models.join(", ") : "none" },
    {
      label: "Engine",
      value: `${engine ?? "unknown"}, prompt version ${promptVersion ?? "unknown"}`,
    },
    { label: "Duration", value: `${seconds.toLocaleString("en-US")} s` },
  ];
}

// The form below follows the function course_topic_list. It holds the live topics of a course and no learner data.
// The checklist page and the map page join it with the events of the learner in src/lib/marks.ts.

/** A lesson of the topic list: the home lesson of at least one live topic. */
export interface TopicListLesson {
  url: string;
  position: number;
  title: string | null;
}

/** A live topic of the course: not merged and not retired. */
export interface TopicListTopic {
  id: string;
  name: string;
  description: string | null;
  homeLessonUrl: string;
  // The part_of parent. It can be a topic of another lesson, or a merged or retired topic that is not in the list.
  parentId: string | null;
}

/** A merged topic of the course and the topic that replaces it. */
export interface MergedTopic {
  id: string;
  mergedInto: string;
}

export interface TopicList {
  // The lessons in course order.
  lessons: TopicListLesson[];
  // The order of the home lessons, then the text order of each lesson.
  topics: TopicListTopic[];
  merged: MergedTopic[];
}

/** Reads the document of course_topic_list. Null when the caller cannot see the course. */
export function parseTopicList(data: unknown): TopicList | null {
  // The helpers check the type of each value, so any value is safe to read here.
  const value = data as Json | undefined;
  if (!isObject(value)) return null;

  const lessons = list(field(value, "lessons")).flatMap((item): TopicListLesson[] => {
    const url = text(field(item, "url"));
    const position = wholeNumber(field(item, "position"));
    if (url === null || position === null) return [];
    return [{ url, position, title: text(field(item, "title")) }];
  });
  lessons.sort((a, b) => a.position - b.position);

  const topics = list(field(value, "topics")).flatMap((item): TopicListTopic[] => {
    const id = text(field(item, "id"));
    const name = text(field(item, "name"));
    const homeLessonUrl = text(field(item, "home_lesson_url"));
    if (id === null || name === null || homeLessonUrl === null) return [];
    return [
      {
        id,
        name,
        description: text(field(item, "description")),
        homeLessonUrl,
        parentId: text(field(item, "parent_id")),
      },
    ];
  });

  const merged = list(field(value, "merged")).flatMap((item): MergedTopic[] => {
    const id = text(field(item, "id"));
    const mergedInto = text(field(item, "merged_into"));
    if (id === null || mergedInto === null) return [];
    return [{ id, mergedInto }];
  });

  return { lessons, topics, merged };
}

/** A topic of the checklist, with the topics whose parent it is. */
export interface ChecklistTopic {
  id: string;
  name: string;
  description: string | null;
  children: ChecklistTopic[];
}

/** A lesson of the checklist with its live topics. */
export interface ChecklistLesson {
  url: string;
  position: number;
  title: string | null;
  // The topics at the top level of the lesson, in the order of the topic list.
  topics: ChecklistTopic[];
}

/**
 * Groups the topic list by home lesson, one group for each lesson in course order. A child sits under its parent
 * when both have the same home lesson. Else the child sits at the top level of its home lesson.
 * A chain of parents that comes back to a topic stops before that topic, as in topicParents.
 */
export function checklistLessons(topicList: TopicList): ChecklistLesson[] {
  return topicList.lessons.map((lesson) => {
    const topics = topicList.topics.filter((topic) => topic.homeLessonUrl === lesson.url);
    const nodes = new Map(
      topics.map((topic): [string, ChecklistTopic] => [
        topic.id,
        { id: topic.id, name: topic.name, description: topic.description, children: [] },
      ]),
    );
    const parents = new Map<string, string | null>();
    for (const topic of topics) {
      const parentId = topic.parentId;
      parents.set(topic.id, parentId !== null && parentId !== topic.id && nodes.has(parentId) ? parentId : null);
    }
    stopParentLoops(parents);

    const roots: ChecklistTopic[] = [];
    for (const [id, node] of nodes) {
      const parentId = parents.get(id) ?? null;
      const parent = parentId === null ? undefined : nodes.get(parentId);
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return { url: lesson.url, position: lesson.position, title: lesson.title, topics: roots };
  });
}
