import { useEffect, useRef, useState, type SubmitEvent } from "react";
import { Undo2 } from "lucide-react";
import { ServerError } from "@/components/auth/ServerError";
import { useTopicMarks } from "@/components/hooks/useTopicMarks";
import { lessonTitle, topicCountText, topicMapPath, type ChecklistLesson, type ChecklistTopic } from "@/lib/topics";
import { cn } from "@/lib/utils";
import KnownBox from "./KnownBox";

interface Props {
  courseId: string;
  // The lessons of the checklist in course order, from checklistLessons.
  lessons: ChecklistLesson[];
  // The live topics with the mark "known" when the page loaded.
  knownTopicIds: string[];
}

// An action on all topics of a lesson. A click on one topic is not a lesson action.
type LessonAction = "mark_all" | "clear_all" | "undo";

// The write that brings back the marks of a lesson as they were before "Mark all" or "Clear all".
interface LessonUndo {
  mark: string[];
  unmark: string[];
}

// Saves the marks of one click in a lesson. lessonAction is null for a click on one topic.
// After a 200 answer, the undo of the lesson becomes `undo`. Null removes it. It gives true after a 200 answer.
type WriteMarks = (
  lessonAction: LessonAction | null,
  mark: string[],
  unmark: string[],
  undo: LessonUndo | null,
) => Promise<boolean>;

// The control of a lesson that gets the focus after a lesson action.
type FocusTarget = "heading" | "mark_all" | "clear_all" | "undo";

const lessonButtonClass =
  "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-semibold text-card-foreground transition-colors enabled:hover:bg-secondary disabled:opacity-50 aria-busy:cursor-wait";

/** The ids of the topics and of all their children, in list order. */
function topicIds(topics: readonly ChecklistTopic[]): string[] {
  return topics.flatMap((topic) => [topic.id, ...topicIds(topic.children)]);
}

/** The map without the key. */
function withoutKey<T>(map: ReadonlyMap<number, T>, key: number): ReadonlyMap<number, T> {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
}

interface TopicItemsProps {
  topics: readonly ChecklistTopic[];
  // The marks route of the course.
  action: string;
  // The position of the lesson. The route redirects back to it after a form post with no script.
  position: number;
  // True for the children of a topic.
  nested?: boolean;
  isKnown: (topicId: string) => boolean;
  isPending: (topicId: string) => boolean;
  onToggle: (topicId: string) => void;
}

/** The topics of one list level. Each topic has a form with one toggle. Its children form a nested list below it. */
function TopicItems({ topics, action, position, nested = false, isKnown, isPending, onToggle }: TopicItemsProps) {
  return (
    <ul className={cn("space-y-1", nested ? "border-border mt-1 ml-3 border-l-2 pl-2 sm:ml-5 sm:pl-3" : "mt-4")}>
      {topics.map((topic) => {
        const known = isKnown(topic.id);
        const pending = isPending(topic.id);
        return (
          <li key={topic.id} data-testid="known-topic" data-topic-id={topic.id} data-known={known ? "true" : "false"}>
            {/* With no script, the form posts, and the route redirects back to this lesson. */}
            <form
              method="POST"
              action={action}
              onSubmit={(event) => {
                event.preventDefault();
                onToggle(topic.id);
              }}
            >
              <input type="hidden" name={known ? "unmark" : "mark"} value={topic.id} />
              <input type="hidden" name="lesson" value={position} />
              {/* The name of the toggle is the topic name, and aria-pressed gives the state. A pending toggle uses
                  aria-disabled, not disabled, so it keeps the focus, and a screen reader reads the new state. */}
              <button
                type="submit"
                aria-pressed={known}
                aria-disabled={pending || undefined}
                aria-busy={pending || undefined}
                className="hover:bg-secondary flex min-h-11 w-full min-w-11 items-start gap-3 rounded-lg px-3 py-2.5 text-left font-semibold transition-colors aria-busy:cursor-wait aria-disabled:opacity-60"
              >
                <KnownBox known={known} className="mt-0.5" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{topic.name}</span>
              </button>
            </form>
            {topic.description && (
              <p className="text-muted-foreground pr-3 pb-2 pl-11 text-sm [overflow-wrap:anywhere]">
                {topic.description}
              </p>
            )}
            {topic.children.length > 0 && (
              <TopicItems
                topics={topic.children}
                action={action}
                position={position}
                nested
                isKnown={isKnown}
                isPending={isPending}
                onToggle={onToggle}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface LessonSectionProps {
  courseId: string;
  lesson: ChecklistLesson;
  // The marks route of the course.
  action: string;
  isKnown: (topicId: string) => boolean;
  isPending: (topicId: string) => boolean;
  // The lesson action that runs now.
  running: LessonAction | undefined;
  // The undo after "Mark all" or "Clear all".
  undo: LessonUndo | undefined;
  // The text of the last failed write, when that write was in this lesson.
  error: string | null;
  onWrite: WriteMarks;
}

/**
 * One lesson of the checklist: the title, the link to the lesson on the map, the count, the lesson buttons,
 * and one toggle for each topic. "Undo" needs the script, so it shows only after "Mark all" or "Clear all".
 */
function LessonSection({
  courseId,
  lesson,
  action,
  isKnown,
  isPending,
  running,
  undo,
  error,
  onWrite,
}: LessonSectionProps) {
  const ids = topicIds(lesson.topics);
  const marked = ids.filter((id) => isKnown(id));
  const unmarked = ids.filter((id) => !isKnown(id));
  // The lesson buttons wait while a write of the lesson runs, so one page never sends two writes for one topic.
  const busy = running !== undefined || ids.some((id) => isPending(id));
  const headingId = `lesson-${lesson.position}-title`;

  // A lesson button is disabled while its write runs, and the browser then moves the focus to the page body.
  // After the write, the focus goes to "Undo" after "Mark all" or "Clear all", to the heading after "Undo",
  // and back to the button after a failure. So a keyboard user keeps the place in the lesson.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const markAllRef = useRef<HTMLButtonElement>(null);
  const clearAllRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  // Each lesson action sets a new request object, so the effect runs once for each request.
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget } | null>(null);

  useEffect(() => {
    if (focusRequest === null) return;
    const refs = { heading: headingRef, mark_all: markAllRef, clear_all: clearAllRef, undo: undoRef };
    const target = refs[focusRequest.target].current;
    // A disabled button cannot take the focus, so the heading takes it.
    if (target && !(target instanceof HTMLButtonElement && target.disabled)) target.focus();
    else headingRef.current?.focus();
  }, [focusRequest]);

  async function markAll(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || unmarked.length === 0) return;
    const saved = await onWrite("mark_all", unmarked, [], { mark: [], unmark: unmarked });
    setFocusRequest({ target: saved ? "undo" : "mark_all" });
  }

  async function clearAll(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || marked.length === 0) return;
    const saved = await onWrite("clear_all", [], marked, { mark: marked, unmark: [] });
    setFocusRequest({ target: saved ? "undo" : "clear_all" });
  }

  async function undoLesson() {
    if (busy || !undo) return;
    const saved = await onWrite("undo", undo.mark, undo.unmark, null);
    setFocusRequest({ target: saved ? "heading" : "undo" });
  }

  // A toggle keeps the focus during its write, because it uses aria-disabled, not disabled.
  function toggle(topicId: string) {
    if (isPending(topicId)) return;
    const known = isKnown(topicId);
    void onWrite(null, known ? [] : [topicId], known ? [topicId] : [], null);
  }

  return (
    <section
      id={`lesson-${lesson.position}`}
      data-testid="known-lesson"
      data-position={lesson.position}
      aria-labelledby={headingId}
      className="bg-card text-card-foreground scroll-mt-4 rounded-(--radius) p-4 shadow-(--shadow-card) sm:p-6"
    >
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="font-heading text-xl font-extrabold [overflow-wrap:anywhere] outline-none"
      >
        {`Lesson ${lesson.position}: ${lessonTitle(lesson.title, lesson.position)}`}
      </h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-4">
        {/* A polite live region, so a screen reader hears the new count after a lesson action. */}
        <p aria-live="polite" className="text-muted-foreground text-sm">{`${marked.length} of ${ids.length} known`}</p>
        <a
          href={topicMapPath(courseId, lesson.position)}
          className="text-primary inline-flex min-h-11 min-w-11 items-center text-sm font-semibold underline underline-offset-2"
        >
          Open on the map
        </a>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {/* With no script, these forms post the ids of the lesson, and the route redirects back to this lesson. */}
        <form method="POST" action={action} onSubmit={(event) => void markAll(event)}>
          {unmarked.map((id) => (
            <input key={id} type="hidden" name="mark" value={id} />
          ))}
          <input type="hidden" name="lesson" value={lesson.position} />
          <button
            ref={markAllRef}
            type="submit"
            disabled={busy || unmarked.length === 0}
            aria-busy={running === "mark_all" || undefined}
            className={lessonButtonClass}
          >
            Mark all
          </button>
        </form>
        <form method="POST" action={action} onSubmit={(event) => void clearAll(event)}>
          {marked.map((id) => (
            <input key={id} type="hidden" name="unmark" value={id} />
          ))}
          <input type="hidden" name="lesson" value={lesson.position} />
          <button
            ref={clearAllRef}
            type="submit"
            disabled={busy || marked.length === 0}
            aria-busy={running === "clear_all" || undefined}
            className={lessonButtonClass}
          >
            Clear all
          </button>
        </form>
        {undo && (
          <button
            ref={undoRef}
            type="button"
            disabled={busy}
            aria-busy={running === "undo" || undefined}
            onClick={() => void undoLesson()}
            className={lessonButtonClass}
          >
            <Undo2 className="size-4" aria-hidden="true" />
            Undo
          </button>
        )}
      </div>
      {/* The live region stays in the page, so a screen reader reads each new error text. */}
      <div aria-live="polite" className="mt-3 empty:mt-0">
        <ServerError message={error} />
      </div>
      <TopicItems
        topics={lesson.topics}
        action={action}
        position={lesson.position}
        isKnown={isKnown}
        isPending={isPending}
        onToggle={toggle}
      />
    </section>
  );
}

/**
 * The checklist of a course: one section for each lesson, with one toggle for each topic and the lesson buttons.
 * Each click saves at once. With no script, each control posts its form to the marks route, and the route
 * redirects back to the lesson.
 */
export default function KnownTopicList({ courseId, lessons, knownTopicIds }: Props) {
  const { isKnown, isPending, error, save } = useTopicMarks(courseId, knownTopicIds);
  // The undo of each lesson after "Mark all" or "Clear all". The next action on the lesson removes it.
  const [undos, setUndos] = useState<ReadonlyMap<number, LessonUndo>>(() => new Map());
  // The lesson action that runs in each lesson. Its button shows aria-busy.
  const [running, setRunning] = useState<ReadonlyMap<number, LessonAction>>(() => new Map());
  // The lesson of the last failed write. The error text of the hook shows in that lesson.
  const [errorLesson, setErrorLesson] = useState<number | null>(null);

  const action = `/api/courses/${courseId}/marks`;
  const ids = lessons.flatMap((lesson) => topicIds(lesson.topics));
  const markedCount = ids.filter((id) => isKnown(id)).length;

  async function write(
    position: number,
    lessonAction: LessonAction | null,
    mark: string[],
    unmark: string[],
    undo: LessonUndo | null,
  ): Promise<boolean> {
    if (lessonAction !== null) setRunning((current) => new Map(current).set(position, lessonAction));
    const saved = await save(mark, unmark);
    if (lessonAction !== null) setRunning((current) => withoutKey(current, position));
    if (!saved) {
      // The undo stays, because a failed write changes no mark.
      setErrorLesson(position);
      return false;
    }
    setUndos((current) => (undo ? new Map(current).set(position, undo) : withoutKey(current, position)));
    return true;
  }

  return (
    <div className="space-y-6">
      <p data-testid="known-count" className="font-semibold">
        {`${markedCount} of ${topicCountText(ids.length)} marked as known`}
      </p>
      {lessons.map((lesson) => (
        <LessonSection
          key={lesson.url}
          courseId={courseId}
          lesson={lesson}
          action={action}
          isKnown={isKnown}
          isPending={isPending}
          running={running.get(lesson.position)}
          undo={undos.get(lesson.position)}
          error={errorLesson === lesson.position ? error : null}
          onWrite={(lessonAction, mark, unmark, undo) => write(lesson.position, lessonAction, mark, unmark, undo)}
        />
      ))}
    </div>
  );
}
