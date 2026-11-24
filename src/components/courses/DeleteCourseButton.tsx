import React from "react";
import { Trash2 } from "lucide-react";

interface Props {
  courseId: string;
}

export default function DeleteCourseButton({ courseId }: Props) {
  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!window.confirm("Delete this course and its lessons? You cannot undo this.")) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action={`/api/courses/${courseId}/delete`} onSubmit={handleSubmit}>
      <button
        type="submit"
        data-testid="course-delete-button"
        className="border-destructive/40 bg-card text-destructive hover:bg-destructive/10 flex min-h-11 w-full min-w-11 items-center justify-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors"
      >
        <Trash2 className="size-4" />
        Delete course
      </button>
    </form>
  );
}
