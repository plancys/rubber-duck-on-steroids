// Rules and texts of the notes sample resource. S-08 removes this file with the resource.

/** The limits match the checks on public.notes. */
export const NOTE_TITLE_MAX_LENGTH = 100;
export const NOTE_BODY_MAX_LENGTH = 2000;

export type NoteErrorKey =
  "title_required" | "title_too_long" | "body_too_long" | "not_found" | "not_configured" | "unknown";

const NOTE_ERROR_TEXTS: Record<NoteErrorKey, string> = {
  title_required: "Title is required",
  title_too_long: `Title must be at most ${NOTE_TITLE_MAX_LENGTH} characters`,
  body_too_long: `Body must be at most ${NOTE_BODY_MAX_LENGTH} characters`,
  not_found: "Note not found",
  not_configured: "Notes are not available right now",
  unknown: "Something went wrong. Try again.",
};

export type NoteNoticeKey = "created" | "updated" | "deleted";

const NOTE_NOTICE_TEXTS: Record<NoteNoticeKey, string> = {
  created: "Note created.",
  updated: "Note saved.",
  deleted: "Note deleted.",
};

export interface NoteInput {
  title: string;
  body: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns true when the value is a UUID. A route uses it to skip the query for a bad id. */
export function isNoteId(value: string | undefined): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Counts characters as Postgres does, so that an emoji counts as one character. */
function charLength(value: string): number {
  return Array.from(value).length;
}

/** Reads the note form. It trims the title and keeps the body as written, with LF line breaks. */
export function parseNoteForm(form: FormData): NoteInput | NoteErrorKey {
  const rawTitle = form.get("title");
  const rawBody = form.get("body");
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  // Browsers send textarea line breaks as CRLF. The form counts LF, so the server must count the same way.
  const body = typeof rawBody === "string" ? rawBody.replace(/\r\n/g, "\n") : "";

  if (title.length === 0) return "title_required";
  if (charLength(title) > NOTE_TITLE_MAX_LENGTH) return "title_too_long";
  if (charLength(body) > NOTE_BODY_MAX_LENGTH) return "body_too_long";
  return { title, body };
}

/** Maps an error key from the URL to a fixed text. Unknown keys give the generic text. */
export function noteErrorText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(NOTE_ERROR_TEXTS, key)) {
    return NOTE_ERROR_TEXTS[key as NoteErrorKey];
  }
  return NOTE_ERROR_TEXTS.unknown;
}

/** Maps a notice key from the URL to a fixed text. Unknown keys give no text. */
export function noteNoticeText(key: string | null): string | null {
  if (key === null) return null;
  if (Object.hasOwn(NOTE_NOTICE_TEXTS, key)) {
    return NOTE_NOTICE_TEXTS[key as NoteNoticeKey];
  }
  return null;
}
