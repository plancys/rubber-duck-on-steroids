import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOX_PADDING,
  firstNode,
  initialViewport,
  layoutLesson,
  layoutOverview,
  lessonNodeId,
  type LayoutNode,
  type MapLayout,
} from "./topic-map-layout.ts";

function byId(map: MapLayout): Map<string, LayoutNode> {
  return new Map(map.nodes.map((node) => [node.id, node]));
}

function find(map: MapLayout, id: string): LayoutNode {
  const node = byId(map).get(id);
  assert.ok(node, `node ${id} is missing`);
  return node;
}

function overlap(a: LayoutNode, b: LayoutNode): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// Checks that no two nodes with the same parent cover each other.
function assertNoOverlap(map: MapLayout): void {
  for (const [index, first] of map.nodes.entries()) {
    for (const second of map.nodes.slice(index + 1)) {
      if (first.parentId !== second.parentId) continue;
      assert.ok(!overlap(first, second), `${first.id} covers ${second.id}`);
    }
  }
}

// Checks that each child is inside its box, and that each box comes before its children.
function assertInsideBoxes(map: MapLayout): void {
  const seen = new Set<string>();
  for (const node of map.nodes) {
    if (node.parentId !== null) {
      assert.ok(seen.has(node.parentId), `the box of ${node.id} comes after it`);
      const box = find(map, node.parentId);
      assert.equal(box.kind, "box");
      assert.ok(node.x >= BOX_PADDING && node.y >= BOX_PADDING, `${node.id} starts outside its box`);
      assert.ok(node.x + node.width <= box.width - BOX_PADDING, `${node.id} reaches past the right side of its box`);
      assert.ok(node.y + node.height <= box.height - BOX_PADDING, `${node.id} reaches past the bottom of its box`);
    }
    seen.add(node.id);
  }
}

test("a parent topic is a box around its children, and the other topics stay at the top level", () => {
  const map = layoutLesson(
    [
      { id: "sql", name: "SQL support", parentId: null },
      { id: "join", name: "JOIN clause", parentId: "sql" },
      { id: "order", name: "ORDER BY", parentId: "sql" },
      { id: "olap", name: "OLAP", parentId: null },
      // The parent of this topic is in another lesson, so it gives no box.
      { id: "clickhouse", name: "ClickHouse", parentId: "cloud" },
    ],
    [{ id: "cloud", name: "ClickHouse Cloud" }],
    [
      { kind: "part_of", from: "join", to: "sql" },
      { kind: "part_of", from: "order", to: "sql" },
      { kind: "part_of", from: "clickhouse", to: "cloud" },
      { kind: "prerequisite", from: "join", to: "order" },
    ],
  );

  assert.deepEqual(
    map.nodes.map((node) => [node.id, node.kind, node.parentId]),
    [
      ["sql", "box", null],
      ["join", "topic", "sql"],
      ["order", "topic", "sql"],
      ["olap", "topic", null],
      ["clickhouse", "topic", null],
      ["cloud", "other", null],
    ],
  );
  assertInsideBoxes(map);
  assertNoOverlap(map);
  // The prerequisite inside the box puts the earlier topic above the later topic.
  assert.ok(find(map, "join").y + find(map, "join").height <= find(map, "order").y);
  // The part_of relation to the topic of another lesson puts that parent above its child.
  assert.ok(find(map, "cloud").y + find(map, "cloud").height <= find(map, "clickhouse").y);
});

test("a relation across two boxes orders the boxes, and each box keeps its own layout", () => {
  const map = layoutLesson(
    [
      { id: "first", name: "Storage", parentId: null },
      { id: "a", name: "Columns", parentId: "first" },
      { id: "b", name: "Compression", parentId: "first" },
      { id: "second", name: "Queries", parentId: null },
      { id: "c", name: "Vectorized execution", parentId: "second" },
    ],
    [],
    [
      { kind: "part_of", from: "a", to: "first" },
      { kind: "part_of", from: "b", to: "first" },
      { kind: "part_of", from: "c", to: "second" },
      { kind: "prerequisite", from: "b", to: "c" },
    ],
  );

  assertInsideBoxes(map);
  assertNoOverlap(map);
  const first = find(map, "first");
  const second = find(map, "second");
  assert.equal(first.kind, "box");
  assert.equal(second.kind, "box");
  assert.ok(first.y + first.height <= second.y, "the box with the earlier topic is above the other box");
  // With no edge inside the first box, its two children sit side by side in one row.
  assert.equal(find(map, "a").y, find(map, "b").y);
  assert.equal(map.bounds.height, second.y + second.height);
});

test("a box inside a box gets its own layout first", () => {
  const map = layoutLesson(
    [
      { id: "outer", name: "Joins", parentId: null },
      { id: "inner", name: "Adaptive join algorithms", parentId: "outer" },
      { id: "hash", name: "Hash join", parentId: "inner" },
      { id: "merge", name: "Merge join", parentId: "inner" },
    ],
    [],
    [],
  );

  assert.deepEqual(
    map.nodes.map((node) => [node.id, node.kind, node.parentId]),
    [
      ["outer", "box", null],
      ["inner", "box", "outer"],
      ["hash", "topic", "inner"],
      ["merge", "topic", "inner"],
    ],
  );
  assertInsideBoxes(map);
});

test("a lesson with no relation places its topics in a grid of three columns", () => {
  const topics = Array.from({ length: 7 }, (_, index) => ({ id: `t${index}`, name: `Topic ${index}`, parentId: null }));
  const map = layoutLesson(topics, [], []);

  assert.equal(map.nodes.length, 7);
  assert.ok(map.nodes.every((node) => node.kind === "topic" && node.parentId === null));
  assertNoOverlap(map);
  const columns = new Set(map.nodes.map((node) => node.x));
  assert.equal(columns.size, 3);
  const rows = new Set(map.nodes.map((node) => node.y));
  assert.equal(rows.size, 3);
  for (const node of map.nodes) {
    assert.ok(node.width >= 44 && node.height >= 44, `${node.id} is smaller than 44 px`);
    assert.ok(node.x + node.width <= map.bounds.width && node.y + node.height <= map.bounds.height);
  }
});

test("a lesson with no topic gives an empty layout", () => {
  assert.deepEqual(layoutLesson([], [], []), { nodes: [], bounds: { x: 0, y: 0, width: 0, height: 0 } });
});

test("the same input gives the same layout", () => {
  const input = () =>
    layoutLesson(
      [
        { id: "p", name: "Parent", parentId: null },
        { id: "c", name: "Child", parentId: "p" },
        { id: "x", name: "Loose", parentId: null },
      ],
      [{ id: "o", name: "Other" }],
      [
        { kind: "part_of", from: "c", to: "p" },
        { kind: "prerequisite", from: "o", to: "c" },
      ],
    );
  assert.deepEqual(input(), input());
});

test("the overview places the lessons in one column in course order, with room for the arcs", () => {
  const map = layoutOverview(
    [
      { position: 2, title: "Why is ClickHouse so fast?", marked: false },
      { position: 1, title: "What is ClickHouse?", marked: false },
      { position: 3, title: "Install", marked: true },
    ],
    [{ from: 1, to: 3 }],
  );

  assert.deepEqual(
    map.nodes.map((node) => node.id),
    [lessonNodeId(1), lessonNodeId(2), lessonNodeId(3)],
  );
  assertNoOverlap(map);
  assert.ok(map.nodes.every((node) => node.x === 0 && node.kind === "lesson"));
  const [first, second, third] = map.nodes;
  assert.ok(first.y < second.y && second.y < third.y);
  // The marked lesson has room for its text mark.
  assert.ok(third.height > find(map, lessonNodeId(1)).height);
  // The arc of the arrow from lesson 1 to lesson 3 needs room right of the column.
  assert.ok(map.bounds.width > first.width);
  assert.equal(layoutOverview([{ position: 1, title: "One", marked: false }], []).bounds.width, first.width);
});

test("the first view is at zoom 1, at the top left corner of a map that does not fit", () => {
  const bounds = { x: 0, y: 0, width: 900, height: 1200 };
  assert.deepEqual(initialViewport(bounds, 288, 448), { x: 16, y: 16, zoom: 1 });
  assert.deepEqual(initialViewport(bounds, 1000, 600), { x: 50, y: 16, zoom: 1 });
  // A small map sits in the middle of the canvas.
  assert.deepEqual(initialViewport({ x: 0, y: 0, width: 200, height: 100 }, 300, 400), { x: 50, y: 150, zoom: 1 });
});

test("a map wider than the canvas starts at the left node of its top rank", () => {
  // The top rank sits in the middle of a wide layout, as in lesson 2 of the docs course.
  const node = (id: string, x: number, y: number, parentId: string | null = null): LayoutNode => ({
    id,
    kind: "topic",
    x,
    y,
    width: 200,
    height: 44,
    parentId,
  });
  const map: MapLayout = {
    nodes: [node("right", 640, 16), node("left", 400, 16), node("low", 0, 300), node("child", 0, 0, "left")],
    bounds: { x: 0, y: 0, width: 900, height: 1200 },
  };
  assert.deepEqual(firstNode(map), { x: 400, y: 16 });
  // On a phone the first node is at the left side of the canvas, not the empty corner of the layout.
  assert.deepEqual(initialViewport(map.bounds, 288, 448, firstNode(map)), { x: -384, y: 16, zoom: 1 });
  // A canvas that holds the whole width still centers the map.
  assert.deepEqual(initialViewport(map.bounds, 1000, 600, firstNode(map)), { x: 50, y: 16, zoom: 1 });
  assert.equal(firstNode({ nodes: [], bounds: { x: 0, y: 0, width: 0, height: 0 } }), null);
});
