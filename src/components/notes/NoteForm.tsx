import React, { useState } from "react";
import { CircleAlert, Save, Type } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { NOTE_BODY_MAX_LENGTH, NOTE_TITLE_MAX_LENGTH } from "@/lib/notes";
import { cn } from "@/lib/utils";

const textareaBase =
  "w-full rounded-lg bg-background border px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 transition-colors";

interface Props {
  action: string;
  initialTitle?: string;
  initialBody?: string;
  submitLabel: string;
  pendingText: string;
  serverError?: string | null;
}

/** Counts characters as the server does, so that an emoji counts as one character. */
function charLength(value: string): number {
  return Array.from(value).length;
}

export default function NoteForm({
  action,
  initialTitle = "",
  initialBody = "",
  submitLabel,
  pendingText,
  serverError,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [errors, setErrors] = useState<{ title?: string; body?: string }>({});

  function validate() {
    const next: typeof errors = {};
    const trimmed = title.trim();
    if (!trimmed) {
      next.title = "Title is required";
    } else if (charLength(trimmed) > NOTE_TITLE_MAX_LENGTH) {
      next.title = `Title must be at most ${NOTE_TITLE_MAX_LENGTH} characters`;
    }
    if (charLength(body) > NOTE_BODY_MAX_LENGTH) {
      next.body = `Body must be at most ${NOTE_BODY_MAX_LENGTH} characters`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action={action} className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="title"
        label="Title"
        value={title}
        onChange={(v) => {
          setTitle(v);
          if (errors.title) setErrors({ ...errors, title: undefined });
        }}
        placeholder={`Up to ${NOTE_TITLE_MAX_LENGTH} characters`}
        error={errors.title}
        icon={<Type className="size-4" />}
      />

      <div>
        <label htmlFor="body" className="mb-1 block text-sm font-semibold">
          Body
        </label>
        <textarea
          id="body"
          name="body"
          rows={6}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (errors.body) setErrors({ ...errors, body: undefined });
          }}
          placeholder="Write your note"
          className={cn(
            textareaBase,
            errors.body ? "border-destructive focus:ring-destructive" : "border-input focus:ring-ring",
          )}
        />
        {errors.body ? (
          <p className="text-destructive mt-1 flex items-center gap-1 text-xs">
            <CircleAlert className="size-3" />
            {errors.body}
          </p>
        ) : (
          <p className="text-muted-foreground mt-1 text-xs">
            {charLength(body)} of {NOTE_BODY_MAX_LENGTH} characters
          </p>
        )}
      </div>

      <ServerError message={serverError} />

      <SubmitButton pendingText={pendingText} icon={<Save className="size-4" />}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
