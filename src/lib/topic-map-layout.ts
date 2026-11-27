// The positions and sizes of the topic map. Each function is pure: the same input gives the same output.
// The module imports only dagre, so the unit test runs it on Node with no build step.
//
// Dagre cannot lay out a group whose nodes connect to nodes outside the group. So the lesson layout never uses
// the compound mode of dagre. Each parent box gets its own flat layout of its children first.
// Then one layout places the boxes, the topics with no parent and the topics of other lessons.
// A relation that crosses a box counts as an edge of the box at the level of the layout.

import { Graph, layout, type EdgeLabel, type GraphLabel, type NodeLabel } from "@dagrejs/dagre";

export type LayoutKind = "lesson" | "topic" | "box" | "other";

export interface LayoutNode {
  id: string;
  kind: LayoutKind;
  // The top left corner. A node with a parent box has a position relative to the top left corner of that box.
  x: number;
  y: number;
  width: number;
  height: number;
  parentId: string | null;
}

export interface LayoutBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapLayout {
  // A parent box comes before its children, as React Flow needs it.
  nodes: LayoutNode[];
  // The area of all nodes and arcs, from the point (0, 0).
  bounds: LayoutBounds;
}

export interface Size {
  width: number;
  height: number;
}

// The sizes of the nodes. Each node is at least 44 px high and wide at zoom 1, so it obeys the phone rule.
// The line counts are estimates from the text length. The node clips a longer text.
export const LESSON_WIDTH = 224;
export const TOPIC_WIDTH = 200;
export const OTHER_WIDTH = 176;
const MIN_NODE_SIZE = 48;
// The space between two lessons of the overview.
const LESSON_GAP = 24;
// The inner space of a parent box, and the space between the parent topic and the children.
export const BOX_PADDING = 16;
const BOX_HEADER_GAP = 16;
// The space between two nodes in one rank, and between two ranks.
const NODE_GAP = 24;
const RANK_GAP = 48;
// The topics with no edge at one level go into a grid with this number of columns.
const GRID_COLUMNS = 3;

function lineCount(text: string, charsPerLine: number, maxLines: number): number {
  return Math.min(maxLines, Math.max(1, Math.ceil(text.trim().length / charsPerLine)));
}

/** The size of a topic button: up to 3 lines of text-sm. */
export function topicSize(name: string): Size {
  return { width: TOPIC_WIDTH, height: Math.max(MIN_NODE_SIZE, 20 + 20 * lineCount(name, 20, 3)) };
}

/** The size of the mark of a topic of another lesson: up to 2 lines of the name and 1 line for the lesson. */
export function otherSize(name: string): Size {
  return { width: OTHER_WIDTH, height: Math.max(MIN_NODE_SIZE, 16 + 16 * (lineCount(name, 22, 2) + 1)) };
}

/** The size of a lesson link of the overview: up to 3 lines of the title, the topic count, and the text mark. */
export function lessonSize(title: string, marked: boolean): Size {
  const height = 24 + 20 * lineCount(title, 20, 3) + 16 + (marked ? 16 : 0);
  return { width: LESSON_WIDTH, height: Math.max(MIN_NODE_SIZE, height) };
}

// The arcs of the overview: an arc leaves the right side of one lesson and enters the right side of another.
// A longer arc reaches further to the right, so two arcs of a different length do not cover each other.
const ARC_MIN = 32;
const ARC_MAX = 160;
const ARC_STEP = 0.12;
// The room for the count label right of the arc.
const ARC_LABEL_ROOM = 32;

/** The distance of the control points of an arc from the side of the lessons, for a vertical distance dy. */
export function arcBulge(dy: number): number {
  return Math.min(ARC_MAX, ARC_MIN + Math.abs(dy) * ARC_STEP);
}

/** The point of an arc that is furthest to the right. A cubic curve with two equal control points reaches 3/4. */
export function arcApex(sourceX: number, sourceY: number, targetY: number): { x: number; y: number } {
  return { x: sourceX + arcBulge(targetY - sourceY) * 0.75, y: (sourceY + targetY) / 2 };
}

export interface OverviewLessonInput {
  position: number;
  title: string;
  // True when the lesson shows the mark of a lesson that the engine did not analyse.
  marked: boolean;
}

export interface OverviewArrowInput {
  from: number;
  to: number;
}

/** The id of the node of a lesson in the overview. */
export function lessonNodeId(position: number): string {
  return `lesson-${position}`;
}

/**
 * Places the lessons in one column in course order, and adds the room for the arcs on the right side.
 * The column keeps the course order and fits the width of a phone at zoom 1.
 */
export function layoutOverview(
  lessons: readonly OverviewLessonInput[],
  arrows: readonly OverviewArrowInput[],
): MapLayout {
  const sorted = [...lessons].sort((a, b) => a.position - b.position);
  const nodes: LayoutNode[] = [];
  const middle = new Map<number, number>();
  let y = 0;
  for (const lesson of sorted) {
    const size = lessonSize(lesson.title, lesson.marked);
    nodes.push({ id: lessonNodeId(lesson.position), kind: "lesson", x: 0, y, parentId: null, ...size });
    middle.set(lesson.position, y + size.height / 2);
    y += size.height + LESSON_GAP;
  }
  let reach = 0;
  for (const arrow of arrows) {
    const from = middle.get(arrow.from);
    const to = middle.get(arrow.to);
    if (from === undefined || to === undefined || arrow.from === arrow.to) continue;
    reach = Math.max(reach, arcApex(0, from, to).x + ARC_LABEL_ROOM);
  }
  const height = Math.max(0, y - LESSON_GAP);
  return { nodes, bounds: { x: 0, y: 0, width: LESSON_WIDTH + reach, height } };
}

export interface LessonTopicInput {
  id: string;
  name: string;
  // The parent topic. Only a parent among the topics of the lesson makes a box. Another parent gives no box.
  parentId: string | null;
}

export interface LessonOtherInput {
  id: string;
  name: string;
}

export interface LessonRelationInput {
  kind: "prerequisite" | "part_of";
  from: string;
  to: string;
}

interface Placed {
  id: string;
  x: number;
  y: number;
}

interface GroupLayout {
  placed: Placed[];
  width: number;
  height: number;
}

/**
 * Places the topics of one lesson. A topic with children in the lesson is a box around its children.
 * The topics of other lessons stay at the top level, next to the topics that they relate to.
 */
export function layoutLesson(
  topics: readonly LessonTopicInput[],
  others: readonly LessonOtherInput[],
  relations: readonly LessonRelationInput[],
): MapLayout {
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const otherById = new Map<string, LessonOtherInput>();
  for (const other of others) {
    if (!topicById.has(other.id)) otherById.set(other.id, other);
  }

  // The parent of each topic in this lesson. A chain that comes back to a topic stops before the topic.
  const parentOf = new Map<string, string | null>();
  for (const topic of topics) {
    const parent = topic.parentId;
    parentOf.set(topic.id, parent !== null && parent !== topic.id && topicById.has(parent) ? parent : null);
  }
  for (const topic of topics) {
    const seen = new Set<string>([topic.id]);
    let current = parentOf.get(topic.id) ?? null;
    while (current !== null) {
      if (seen.has(current)) {
        parentOf.set(topic.id, null);
        break;
      }
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }
  }

  const children = new Map<string | null, string[]>();
  for (const topic of topics) {
    const parent = parentOf.get(topic.id) ?? null;
    const list = children.get(parent) ?? [];
    list.push(topic.id);
    children.set(parent, list);
  }
  const isBox = (id: string): boolean => (children.get(id)?.length ?? 0) > 0;

  // The edges for the layout. A prerequisite points from the earlier topic to the later topic.
  // A part_of relation to or from a topic of another lesson puts the parent above the child.
  // A part_of relation between two topics of this lesson is the box, so it is no edge.
  const known = (id: string): boolean => topicById.has(id) || otherById.has(id);
  const edges: [string, string][] = [];
  for (const relation of relations) {
    if (!known(relation.from) || !known(relation.to) || relation.from === relation.to) continue;
    if (relation.kind === "prerequisite") {
      edges.push([relation.from, relation.to]);
    } else if (otherById.has(relation.from) || otherById.has(relation.to)) {
      edges.push([relation.to, relation.from]);
    }
  }

  // The member of a group that holds the node: the node, or its ancestor whose parent is the group.
  // Null when the node is not inside the group.
  const memberOf = (id: string, group: string | null): string | null => {
    let current: string | null = id;
    while (current !== null) {
      const parent: string | null = otherById.has(current) ? null : (parentOf.get(current) ?? null);
      if (parent === group) return current;
      current = parent;
    }
    return null;
  };

  const sizes = new Map<string, Size>();
  const relative = new Map<string, Placed>();

  const layoutGroup = (group: string | null, members: string[]): GroupLayout => {
    for (const member of members) {
      if (otherById.has(member)) {
        sizes.set(member, otherSize(otherById.get(member)?.name ?? ""));
      } else if (isBox(member)) {
        sizes.set(member, layoutBox(member));
      } else {
        sizes.set(member, topicSize(topicById.get(member)?.name ?? ""));
      }
    }
    const groupEdges: [string, string][] = [];
    const seen = new Set<string>();
    for (const [from, to] of edges) {
      const a = memberOf(from, group);
      const b = memberOf(to, group);
      if (a === null || b === null || a === b) continue;
      const key = `${a}\n${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      groupEdges.push([a, b]);
    }
    return placeMembers(members, sizes, groupEdges);
  };

  const layoutBox = (box: string): Size => {
    const inner = layoutGroup(box, children.get(box) ?? []);
    const header = topicSize(topicById.get(box)?.name ?? "");
    const width = Math.max(inner.width, header.width) + 2 * BOX_PADDING;
    const top = BOX_PADDING + header.height + BOX_HEADER_GAP;
    // The children sit in the middle of the box when the header is wider than the children.
    const left = BOX_PADDING + (Math.max(inner.width, header.width) - inner.width) / 2;
    for (const item of inner.placed) relative.set(item.id, { id: item.id, x: item.x + left, y: item.y + top });
    return { width, height: top + inner.height + BOX_PADDING };
  };

  const topLevel = [...(children.get(null) ?? []), ...otherById.keys()];
  const top = layoutGroup(null, topLevel);
  for (const item of top.placed) relative.set(item.id, item);

  const nodes: LayoutNode[] = [];
  const add = (id: string, parentId: string | null): void => {
    const place = relative.get(id);
    const size = sizes.get(id);
    if (!place || !size) return;
    const kind: LayoutKind = otherById.has(id) ? "other" : isBox(id) ? "box" : "topic";
    nodes.push({ id, kind, x: place.x, y: place.y, width: size.width, height: size.height, parentId });
    if (kind === "box") {
      for (const child of children.get(id) ?? []) add(child, id);
    }
  };
  for (const id of topLevel) add(id, null);

  return { nodes, bounds: { x: 0, y: 0, width: top.width, height: top.height } };
}

/**
 * One flat layered layout of the members of one level, from top to bottom.
 * The members with no edge go into a grid of GRID_COLUMNS columns, so a lesson with few relations
 * does not become one long row. The grid uses invisible edges from each member to the member below it.
 */
function placeMembers(
  members: readonly string[],
  sizes: ReadonlyMap<string, Size>,
  edges: [string, string][],
): GroupLayout {
  if (members.length === 0) return { placed: [], width: 0, height: 0 };

  const linked = new Set<string>();
  for (const [from, to] of edges) {
    linked.add(from);
    linked.add(to);
  }
  const loose = members.filter((member) => !linked.has(member));

  // The members with an edge go in first, so dagre puts them on the left, where the first view of the map starts.
  const graph = new Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: false });
  graph.setGraph({ rankdir: "TB", nodesep: NODE_GAP, ranksep: RANK_GAP, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const member of [...members.filter((member) => linked.has(member)), ...loose]) {
    const size = sizes.get(member) ?? { width: MIN_NODE_SIZE, height: MIN_NODE_SIZE };
    graph.setNode(member, { width: size.width, height: size.height });
  }
  for (const [from, to] of edges) graph.setEdge(from, to);
  for (let index = 0; index + GRID_COLUMNS < loose.length; index++) {
    graph.setEdge(loose[index], loose[index + GRID_COLUMNS]);
  }
  layout(graph);

  // Dagre puts the middle of each node of a rank on one line. A tall box then pushes the small nodes of its rank
  // down. So each node moves up to the top of its rank.
  const rankTop = new Map<number, number>();
  for (const member of members) {
    const node = graph.node(member);
    const top = (node.y ?? 0) - node.height / 2;
    const rank = node.rank ?? 0;
    rankTop.set(rank, Math.min(rankTop.get(rank) ?? top, top));
  }

  const placed: Placed[] = [];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const member of members) {
    const node = graph.node(member);
    const x = (node.x ?? 0) - node.width / 2;
    const y = rankTop.get(node.rank ?? 0) ?? (node.y ?? 0) - node.height / 2;
    placed.push({ id: member, x, y });
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + node.width);
    maxY = Math.max(maxY, y + node.height);
  }
  for (const item of placed) {
    item.x = Math.round(item.x - minX);
    item.y = Math.round(item.y - minY);
  }
  return { placed, width: Math.round(maxX - minX), height: Math.round(maxY - minY) };
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

// The space between the edge of the canvas and the map.
const VIEW_PADDING = 16;
// The zoom of the first view. Each node and each control keeps the 44 px rule at this zoom.
const START_ZOOM = 1;

/**
 * The top left corner of the first node in reading order: the top-level node with the least y,
 * and of those the node with the least x. A map with no node gives null.
 */
export function firstNode(map: MapLayout): { x: number; y: number } | null {
  let first: LayoutNode | null = null;
  for (const node of map.nodes) {
    if (node.parentId !== null) continue;
    if (!first || node.y < first.y || (node.y === first.y && node.x < first.x)) first = node;
  }
  return first ? { x: first.x, y: first.y } : null;
}

/**
 * The first view of the map in a canvas of the given size, at zoom 1 on each screen.
 * A map that fits the canvas sits in its middle. A map that is wider than the canvas starts at its first node,
 * because the top rank of a wide layout can sit far from its left side. The fit button of the map shows the whole map.
 */
export function initialViewport(
  bounds: LayoutBounds,
  width: number,
  height: number,
  first: { x: number } | null = null,
): Viewport {
  const zoom = START_ZOOM;
  const mapWidth = bounds.width * zoom;
  const mapHeight = bounds.height * zoom;
  const fitsWidth = mapWidth + 2 * VIEW_PADDING <= width;
  const x = fitsWidth ? (width - mapWidth) / 2 : VIEW_PADDING;
  const y = mapHeight + 2 * VIEW_PADDING <= height ? (height - mapHeight) / 2 : VIEW_PADDING;
  const left = !fitsWidth && first ? first.x : bounds.x;
  return { x: x - left * zoom, y: y - bounds.y * zoom, zoom };
}
