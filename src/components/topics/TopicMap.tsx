import { createContext, useCallback, useContext, useMemo, useRef, useState, type FocusEvent } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { cn } from "@/lib/utils";
import {
  BOX_PADDING,
  TOPIC_WIDTH,
  arcApex,
  arcBulge,
  firstNode,
  initialViewport,
  layoutLesson,
  layoutOverview,
  lessonNodeId,
  topicSize,
  type LayoutBounds,
} from "@/lib/topic-map-layout";
import {
  lessonStateText,
  lessonTitle,
  topicCountText,
  topicMapPath,
  topicParents,
  type LessonMap,
  type MapOverview,
} from "@/lib/topics";
import MapControls from "./MapControls";
import TopicPanel from "./TopicPanel";

// The islands use client:only, so the page request does no graph work. The layout runs here, in the browser.

interface Props {
  courseId: string;
  // The overview of the course. Without `lesson`, the island shows the overview.
  overview?: MapOverview;
  // One lesson of the map.
  lesson?: LessonMap;
}

// React Flow needs node data with an index signature, so each data interface extends Record<string, unknown>.
interface LessonNodeData extends Record<string, unknown> {
  position: number;
  title: string;
  topics: number;
  mark: string | null;
  href: string;
}
interface TopicNodeData extends Record<string, unknown> {
  name: string;
}
interface BoxNodeData extends Record<string, unknown> {
  name: string;
  headerHeight: number;
}
interface OtherNodeData extends Record<string, unknown> {
  name: string;
  position: number | null;
  href: string | null;
}
interface ArcEdgeData extends Record<string, unknown> {
  count: number;
}

type LessonFlowNode = Node<LessonNodeData, "lesson">;
type TopicFlowNode = Node<TopicNodeData, "topic">;
type BoxFlowNode = Node<BoxNodeData, "box">;
type OtherFlowNode = Node<OtherNodeData, "other">;
type FlowNode = LessonFlowNode | TopicFlowNode | BoxFlowNode | OtherFlowNode;
type ArcFlowEdge = Edge<ArcEdgeData, "arc">;
type FlowEdge = ArcFlowEdge | Edge;

interface Graph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  bounds: LayoutBounds;
  // The first node in reading order. The first view starts there when the map is wider than the canvas.
  first: { x: number; y: number } | null;
}

interface MapActions {
  activeId: string | null;
  openTopic: (id: string) => void;
  // Pans the view to a node that gets the focus from the keyboard and is outside the view.
  revealNode: (id: string, event: FocusEvent<HTMLElement>) => void;
}

const MapContext = createContext<MapActions>({
  activeId: null,
  openTopic: () => undefined,
  revealNode: () => undefined,
});

const MOVE_MS = 200;
const ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18 } as const;

// The texts that React Flow gives to a screen reader. The nodes are not focusable: the links and buttons inside
// them take the focus, so the texts of React Flow about selection and deletion do not apply.
const ARIA_LABELS = {
  "node.a11yDescription.default": "Press Tab to move to the next item of the map.",
  "node.a11yDescription.keyboardDisabled": "Press Tab to move to the next item of the map.",
  "edge.a11yDescription.default": "A relation between two items of the map.",
};

function nodeClass(active: boolean): string {
  return cn(
    // React Flow turns off the pointer events of a node that is not selectable. The control inside turns them on.
    "pointer-events-auto flex size-full min-h-11 min-w-11 rounded-lg border-2 shadow-(--shadow-card) transition-colors",
    active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-card-foreground",
    !active && "hover:border-primary",
  );
}

function LessonNode({ data }: NodeProps<LessonFlowNode>) {
  const { revealNode } = useContext(MapContext);
  return (
    <>
      <Handle id="in" type="target" position={Position.Right} isConnectable={false} />
      <a
        href={data.href}
        onFocus={(event) => {
          revealNode(lessonNodeId(data.position), event);
        }}
        className={cn(
          nodeClass(false),
          "flex-col justify-center gap-0.5 px-3 py-2",
          data.mark !== null && "border-muted-foreground border-dashed",
        )}
      >
        <span className="line-clamp-3 text-sm font-bold [overflow-wrap:anywhere]">
          <span className="text-muted-foreground">{data.position}. </span>
          {data.title}
        </span>
        <span className="text-muted-foreground text-xs">{topicCountText(data.topics)}</span>
        {data.mark !== null && <span className="text-foreground text-xs font-bold">{data.mark}</span>}
      </a>
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
    </>
  );
}

function TopicButton({ id, name }: { id: string; name: string }) {
  const { activeId, openTopic, revealNode } = useContext(MapContext);
  const active = activeId === id;
  return (
    <button
      type="button"
      data-topic-id={id}
      aria-expanded={active}
      onClick={() => {
        openTopic(id);
      }}
      onFocus={(event) => {
        revealNode(id, event);
      }}
      className={cn(nodeClass(active), "items-center px-3 py-1 text-left text-sm font-semibold")}
    >
      <span className="line-clamp-3 [overflow-wrap:anywhere]">{name}</span>
    </button>
  );
}

function TopicNode({ id, data }: NodeProps<TopicFlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <TopicButton id={id} name={data.name} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </>
  );
}

// A parent topic: a box around its children, with the button of the parent topic at the top.
function BoxNode({ id, data }: NodeProps<BoxFlowNode>) {
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="border-muted-foreground bg-muted/40 relative size-full rounded-xl border-2 border-dashed">
        {/* The layout counts from the outer corner of the box, and the 2 px border moves the inner corner. */}
        <div
          className="absolute"
          style={{ left: BOX_PADDING - 2, top: BOX_PADDING - 2, width: TOPIC_WIDTH, height: data.headerHeight }}
        >
          <TopicButton id={id} name={data.name} />
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </>
  );
}

// A topic of another lesson: a small mark with its name and its lesson number. It links to that lesson.
function OtherNode({ id, data }: NodeProps<OtherFlowNode>) {
  const { revealNode } = useContext(MapContext);
  const content = (
    <>
      <span className="line-clamp-2 font-semibold [overflow-wrap:anywhere]">{data.name}</span>
      <span className="text-muted-foreground">
        {data.position !== null ? `Lesson ${data.position}` : "Another lesson"}
      </span>
    </>
  );
  const className =
    "flex size-full min-h-11 min-w-11 flex-col justify-center rounded-full border border-dashed border-muted-foreground bg-background px-4 text-xs text-foreground";
  return (
    <>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      {data.href !== null ? (
        <a
          href={data.href}
          onFocus={(event) => {
            revealNode(id, event);
          }}
          className={cn(className, "hover:border-primary pointer-events-auto")}
        >
          {content}
        </a>
      ) : (
        <div className={className}>{content}</div>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </>
  );
}

// An arrow of the overview: an arc on the right side of the column of lessons, with the count at its far point.
function ArcEdge({ id, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps<ArcFlowEdge>) {
  const bulge = arcBulge(targetY - sourceY);
  const path = `M ${sourceX} ${sourceY} C ${sourceX + bulge} ${sourceY} ${targetX + bulge} ${targetY} ${targetX} ${targetY}`;
  const apex = arcApex(sourceX, sourceY, targetY);
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          aria-hidden="true"
          className="border-border bg-card text-card-foreground pointer-events-none absolute rounded-full border px-2 text-xs font-bold"
          style={{ transform: `translate(-50%, -50%) translate(${apex.x}px, ${apex.y}px)` }}
        >
          {data?.count ?? 0}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { lesson: LessonNode, topic: TopicNode, box: BoxNode, other: OtherNode } satisfies NodeTypes;
const edgeTypes = { arc: ArcEdge } satisfies EdgeTypes;

function overviewGraph(courseId: string, overview: MapOverview): Graph {
  const lessons = new Map(overview.lessons.map((lesson) => [lessonNodeId(lesson.position), lesson]));
  const layout = layoutOverview(
    overview.lessons.map((lesson) => ({
      position: lesson.position,
      title: lessonTitle(lesson.title, lesson.position),
      marked: lesson.state !== "analysed",
    })),
    overview.arrows,
  );
  const nodes = layout.nodes.flatMap((item): FlowNode[] => {
    const lesson = lessons.get(item.id);
    if (!lesson) return [];
    return [
      {
        id: item.id,
        type: "lesson",
        position: { x: item.x, y: item.y },
        width: item.width,
        height: item.height,
        data: {
          position: lesson.position,
          title: lessonTitle(lesson.title, lesson.position),
          topics: lesson.topics,
          mark: lessonStateText(lesson.state),
          href: topicMapPath(courseId, lesson.position),
        },
      },
    ];
  });
  const edges = overview.arrows.flatMap((arrow): FlowEdge[] => {
    const source = lessonNodeId(arrow.from);
    const target = lessonNodeId(arrow.to);
    if (!lessons.has(source) || !lessons.has(target)) return [];
    return [
      {
        id: `arrow-${arrow.from}-${arrow.to}`,
        type: "arc",
        source,
        target,
        sourceHandle: "out",
        targetHandle: "in",
        markerEnd: ARROW,
        data: { count: arrow.count },
        ariaLabel: `Lesson ${arrow.from} comes before lesson ${arrow.to}: ${arrow.count} ${arrow.count === 1 ? "topic pair" : "topic pairs"}`,
      },
    ];
  });
  return { nodes, edges, bounds: layout.bounds, first: firstNode(layout) };
}

function lessonGraph(courseId: string, map: LessonMap): Graph {
  const parents = topicParents(map);
  const topics = new Map(map.topics.map((topic) => [topic.id, topic]));
  const others = new Map(map.others.map((topic) => [topic.id, topic]));
  const layout = layoutLesson(
    map.topics.map((topic) => ({ id: topic.id, name: topic.name, parentId: parents.get(topic.id) ?? null })),
    map.others.map((topic) => ({ id: topic.id, name: topic.name })),
    map.relations,
  );
  const placed = new Set(layout.nodes.map((item) => item.id));
  const nodes = layout.nodes.flatMap((item): FlowNode[] => {
    const base = {
      id: item.id,
      position: { x: item.x, y: item.y },
      width: item.width,
      height: item.height,
      ...(item.parentId !== null ? { parentId: item.parentId, extent: "parent" as const } : {}),
    };
    const other = others.get(item.id);
    if (item.kind === "other" && other) {
      const position = other.homeLessonPosition;
      return [
        {
          ...base,
          type: "other",
          data: {
            name: other.name,
            position,
            href: position !== null ? topicMapPath(courseId, position) : null,
          },
        },
      ];
    }
    const topic = topics.get(item.id);
    if (!topic) return [];
    if (item.kind === "box") {
      return [{ ...base, type: "box", data: { name: topic.name, headerHeight: topicSize(topic.name).height } }];
    }
    return [{ ...base, type: "topic", data: { name: topic.name } }];
  });
  const name = (id: string): string => topics.get(id)?.name ?? others.get(id)?.name ?? "";
  const edges = map.relations.flatMap((relation): FlowEdge[] => {
    if (!placed.has(relation.from) || !placed.has(relation.to) || relation.from === relation.to) return [];
    if (relation.kind === "prerequisite") {
      return [
        {
          id: `prerequisite-${relation.from}-${relation.to}`,
          source: relation.from,
          target: relation.to,
          markerEnd: ARROW,
          ariaLabel: `${name(relation.from)} comes before ${name(relation.to)}`,
        },
      ];
    }
    // A part_of relation inside the lesson is the box. A part_of relation to or from a topic of another lesson
    // is a dashed line from the parent above to the child below.
    if (!others.has(relation.from) && !others.has(relation.to)) return [];
    return [
      {
        id: `part-of-${relation.from}-${relation.to}`,
        source: relation.to,
        target: relation.from,
        className: "topic-map-part",
        ariaLabel: `${name(relation.from)} is a part of ${name(relation.to)}`,
      },
    ];
  });
  return { nodes, edges, bounds: layout.bounds, first: firstNode(layout) };
}

function TopicMapCanvas({ courseId, overview, lesson }: Props) {
  const graph = useMemo(
    () => (lesson ? lessonGraph(courseId, lesson) : overviewGraph(courseId, overview ?? { lessons: [], arrows: [] })),
    [courseId, overview, lesson],
  );
  const flow = useReactFlow<FlowNode, FlowEdge>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);

  const onInit = useCallback(() => {
    const box = containerRef.current?.getBoundingClientRect();
    if (box) void flow.setViewport(initialViewport(graph.bounds, box.width, box.height, graph.first));
    setReady(true);
  }, [flow, graph.bounds, graph.first]);

  const revealNode = useCallback(
    (id: string, event: FocusEvent<HTMLElement>) => {
      // A click also gives the focus. Only a focus from the keyboard moves the view.
      if (!event.currentTarget.matches(":focus-visible")) return;
      const node = flow.getInternalNode(id);
      const box = containerRef.current?.getBoundingClientRect();
      if (!node || !box) return;
      const { x, y, zoom } = flow.getViewport();
      const width = (node.measured.width ?? node.width ?? 0) * zoom;
      const height = (node.measured.height ?? node.height ?? 0) * zoom;
      const left = node.internals.positionAbsolute.x * zoom + x;
      const top = node.internals.positionAbsolute.y * zoom + y;
      if (left >= 0 && top >= 0 && left + width <= box.width && top + height <= box.height) return;
      void flow.setCenter(
        node.internals.positionAbsolute.x + width / zoom / 2,
        node.internals.positionAbsolute.y + height / zoom / 2,
        { zoom, duration: MOVE_MS },
      );
    },
    [flow],
  );

  const closePanel = useCallback(() => {
    const id = activeId;
    setActiveId(null);
    if (id === null) return;
    // The focus goes back to the button of the topic.
    const button = containerRef.current?.querySelector<HTMLElement>(`[data-topic-id="${CSS.escape(id)}"]`);
    button?.focus({ preventScroll: true });
  }, [activeId]);

  const actions = useMemo<MapActions>(() => ({ activeId, openTopic: setActiveId, revealNode }), [activeId, revealNode]);
  const label = lesson
    ? `Topic map of lesson ${lesson.lesson.position}: ${lessonTitle(lesson.lesson.title, lesson.lesson.position)}`
    : "Topic map of the lessons";

  return (
    <MapContext.Provider value={actions}>
      <div className="space-y-3">
        <MapControls bounds={graph.bounds} />
        <div className="relative">
          <div
            ref={containerRef}
            data-testid="topic-map-canvas"
            data-view={lesson ? "lesson" : "overview"}
            data-ready={ready ? "true" : undefined}
            className="topic-map border-border bg-background h-[28rem] w-full overflow-hidden rounded-(--radius) border sm:h-[36rem]"
          >
            <ReactFlow<FlowNode, FlowEdge>
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onInit={onInit}
              aria-label={label}
              minZoom={0.25}
              maxZoom={2}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              deleteKeyCode={null}
              selectionKeyCode={null}
              multiSelectionKeyCode={null}
              panActivationKeyCode={null}
              zoomActivationKeyCode={null}
              zoomOnScroll={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              disableKeyboardA11y
              defaultMarkerColor={null}
              ariaLabelConfig={ARIA_LABELS}
            />
          </div>
          {lesson && activeId !== null && (
            <TopicPanel courseId={courseId} map={lesson} topicId={activeId} onClose={closePanel} onOpen={setActiveId} />
          )}
        </div>
      </div>
    </MapContext.Provider>
  );
}

/** The topic map of a course: the overview of the lessons, or the topics of one lesson. */
export default function TopicMap(props: Props) {
  return (
    <ReactFlowProvider>
      <TopicMapCanvas {...props} />
    </ReactFlowProvider>
  );
}
