import { useEffect, useRef, type KeyboardEvent } from "react";
import { ExternalLink, X } from "lucide-react";
import { linkPlaceText, prerequisitesOf, topicMapPath, topicRef, type LessonMap, type TopicRef } from "@/lib/topics";

interface Props {
  courseId: string;
  map: LessonMap;
  topicId: string;
  onClose: () => void;
  // Opens another topic of the same lesson in the panel.
  onOpen: (topicId: string) => void;
}

export const TOPIC_PANEL_ID = "topic-panel";

const linkClass =
  "inline-flex min-h-11 min-w-11 items-center gap-1 text-left font-semibold text-primary underline underline-offset-2 [overflow-wrap:anywhere]";

/** One topic that the panel names: a button for a topic of this lesson, a link for a topic of another lesson. */
function TopicName({ courseId, topic, onOpen }: { courseId: string; topic: TopicRef; onOpen: (id: string) => void }) {
  if (topic.home) {
    return (
      <button
        type="button"
        className={linkClass}
        onClick={() => {
          onOpen(topic.id);
        }}
      >
        {topic.name}
      </button>
    );
  }
  if (topic.lessonPosition === null) return <span>{topic.name}</span>;
  return (
    <a href={topicMapPath(courseId, topic.lessonPosition)} className={linkClass}>
      {topic.name} (lesson {topic.lessonPosition})
    </a>
  );
}

/**
 * The panel of one topic: the name, the description, the parent, the prerequisites,
 * and each lesson that explains or mentions the topic, with the quote and a link to the original page.
 * The panel takes the focus when it opens. The Escape key and the close button close it.
 */
export default function TopicPanel({ courseId, map, topicId, onClose, onOpen }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [topicId]);

  const topic = map.topics.find((item) => item.id === topicId);
  if (!topic) return null;

  // The parent is a topic of this lesson or a topic of another lesson at the other end of the part_of relation.
  const parentRef: TopicRef | null = topic.parent
    ? (topicRef(map, topic.parent.id) ?? {
        id: topic.parent.id,
        name: topic.parent.name,
        lessonPosition: null,
        home: false,
      })
    : null;
  const prerequisites = prerequisitesOf(map, topic.id);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <aside
      id={TOPIC_PANEL_ID}
      data-testid="topic-panel"
      aria-labelledby={`${TOPIC_PANEL_ID}-title`}
      onKeyDown={handleKeyDown}
      className="border-border bg-popover text-popover-foreground absolute inset-x-2 bottom-2 z-10 max-h-[75%] space-y-4 overflow-y-auto rounded-(--radius) border p-4 text-sm shadow-(--shadow-card) sm:inset-x-auto sm:top-2 sm:right-2 sm:max-h-none sm:w-80"
    >
      <div className="flex items-start justify-between gap-2">
        <h2
          id={`${TOPIC_PANEL_ID}-title`}
          ref={headingRef}
          tabIndex={-1}
          className="font-heading pt-2.5 text-lg font-extrabold [overflow-wrap:anywhere] outline-none"
        >
          {topic.name}
        </h2>
        <button
          type="button"
          aria-label="Close the topic"
          title="Close"
          data-testid="topic-panel-close"
          onClick={onClose}
          className="text-muted-foreground hover:bg-secondary hover:text-foreground flex min-h-11 min-w-11 flex-none items-center justify-center rounded-full transition-colors"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      {topic.description && <p>{topic.description}</p>}

      {parentRef && (
        <div>
          <h3 className="font-bold">Part of</h3>
          <TopicName courseId={courseId} topic={parentRef} onOpen={onOpen} />
        </div>
      )}

      {prerequisites.length > 0 && (
        <div>
          <h3 className="font-bold">Comes after</h3>
          <ul>
            {prerequisites.map((prerequisite) => (
              <li key={prerequisite.id}>
                <TopicName courseId={courseId} topic={prerequisite} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="font-bold">In the lessons</h3>
        {topic.links.length === 0 ? (
          <p className="text-muted-foreground">No quote.</p>
        ) : (
          <ul className="space-y-3">
            {topic.links.map((link, index) => (
              <li key={`${link.lessonUrl}-${index}`} data-testid="topic-panel-quote" className="space-y-1">
                <p className="text-muted-foreground">{linkPlaceText(link)}</p>
                <blockquote className="border-primary border-l-2 pl-3 [overflow-wrap:anywhere]">
                  {link.quote}
                </blockquote>
                <a href={link.lessonUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
                  Open the original page
                  <ExternalLink className="size-4 flex-none" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
