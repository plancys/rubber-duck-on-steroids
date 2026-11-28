import { useCallback, useMemo, useState } from "react";
import { markErrorText, saveMarks } from "@/lib/marks";

/** The marks of one course in an island, and the write of a change. */
export interface UseTopicMarks {
  // True when the topic has the mark "known".
  isKnown: (topicId: string) => boolean;
  // True while a write for the topic runs.
  isPending: (topicId: string) => boolean;
  // The text of the error of the last write that failed. The next write clears it.
  error: string | null;
  // Saves the marks in one call. It gives true after a 200 answer, and false after an error.
  save: (mark: string[], unmark: string[]) => Promise<boolean>;
}

/**
 * Keeps the marks of a course for the checklist page and for the topic panel of the map.
 * save sets the ids to pending and posts them with saveMarks. The new values show only after a 200 answer.
 * After an error the old values stay, and error holds the text of the error key.
 * A control waits while its ids are pending, so one page never sends two writes for one topic at the same time.
 */
export function useTopicMarks(courseId: string, initialKnown: readonly string[]): UseTopicMarks {
  const [known, setKnown] = useState<ReadonlySet<string>>(() => new Set(initialKnown));
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    async (mark: string[], unmark: string[]): Promise<boolean> => {
      const ids = [...mark, ...unmark];
      if (ids.length === 0) return true;
      setPending((current) => new Set([...current, ...ids]));
      setError(null);
      const result = await saveMarks(courseId, { mark, unmark });
      const done = new Set(ids);
      setPending((current) => new Set([...current].filter((id) => !done.has(id))));
      if ("error" in result) {
        setError(markErrorText(result.error));
        return false;
      }
      setKnown((current) => {
        const next = new Set(current);
        for (const id of mark) next.add(id);
        for (const id of unmark) next.delete(id);
        return next;
      });
      return true;
    },
    [courseId],
  );

  const isKnown = useCallback((topicId: string) => known.has(topicId), [known]);
  const isPending = useCallback((topicId: string) => pending.has(topicId), [pending]);

  return useMemo(() => ({ isKnown, isPending, error, save }), [isKnown, isPending, error, save]);
}
