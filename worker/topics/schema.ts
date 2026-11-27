// The schema check: it removes each item of an engine answer that is outside the contract, and counts it.
// Then the quote check of phase 1 removes each link whose quote is not in its passage,
// each topic with no link left, and each relation to such a topic.
// The result of a lesson is stored as it is, so a new start of the job reads it again with readStoredResult.
// A stored result names a passage by its position and a topic by its name. It holds no request reference,
// because the references of a request (P1, sameAs 3) belong to that request only.

import { normalizeName } from "./identity.ts";
import { findQuote } from "./quote.ts";

// The form of a stored result. A change of the form makes each lesson go to the engine again.
export const RESULT_FORMAT = 1;
// The most characters of one quote, as the prompt of the engine asks.
export const MAX_QUOTE_CHARACTERS = 300;

export type LinkRole = "explains" | "mentions";
export type RelationKind = "prerequisite" | "part_of";

const ROLES = new Set<string>(["explains", "mentions"]);
const KINDS = new Set<string>(["prerequisite", "part_of"]);

// The reasons of the schema check:
// invalidItem: a topic, link or relation that is not an object.
// emptyName: a topic with an empty name.
// unknownPassage: a link with a passage reference that the request did not hold.
// unknownRole: a link with a role other than explains or mentions.
// quoteTooLong: a link with a quote of more than 300 characters.
// unknownSameAs: a sameAs reference that the request did not hold. The topic stays without it.
// unknownKind: a relation with a kind other than prerequisite or part_of.
// unknownRelationPassage: a relation with a passage reference that the request did not hold.
// unknownEnd: a relation with an end that names no topic of the answer and no known topic.
export const SCHEMA_REASONS = [
  "invalidItem",
  "emptyName",
  "unknownPassage",
  "unknownRole",
  "quoteTooLong",
  "unknownSameAs",
  "unknownKind",
  "unknownRelationPassage",
  "unknownEnd",
] as const;
export type SchemaReason = (typeof SCHEMA_REASONS)[number];

export interface ResultLink {
  // The position of the passage in the lesson.
  position: number;
  role: LinkRole;
  quote: string;
  // The start offset of the quote in the passage text.
  quoteStart: number;
}

export interface ResultTopic {
  name: string;
  description: string;
  // The name of the known topic that the engine named as the same concept, or null.
  sameAs: string | null;
  links: ResultLink[];
}

export interface ResultRelation {
  kind: RelationKind;
  // The names of the two topics: a topic of the answer or a known topic.
  from: string;
  to: string;
  reason: string;
  // The position of the source passage in the lesson.
  position: number;
}

// The items that the quote check removed.
export interface QuoteRemovals {
  // Links with a quote that is not in the passage.
  links: number;
  // Topics with no link left.
  topics: number;
  // Relations to a removed topic.
  relations: number;
}

// The checked answer of one engine request.
export interface CheckedAnswer {
  topics: ResultTopic[];
  relations: ResultRelation[];
  schemaRemoved: Record<SchemaReason, number>;
  quoteRemoved: QuoteRemovals;
}

// The stored result of one lesson: the checked answers of all its requests together.
export interface LessonResult extends CheckedAnswer {
  format: number;
  // The number of passages of the lesson text.
  passages: number;
}

export interface CheckPassage {
  ref: string;
  position: number;
  text: string;
}

export interface CheckKnownTopic {
  ref: number;
  name: string;
  aliases: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function emptyRemovals(): Record<SchemaReason, number> {
  return Object.fromEntries(SCHEMA_REASONS.map((reason) => [reason, 0])) as Record<SchemaReason, number>;
}

// Check the topics and the relations of one engine answer against the request.
export function checkAnswer(
  answer: { topics: readonly unknown[]; relations: readonly unknown[] },
  passages: readonly CheckPassage[],
  known: readonly CheckKnownTopic[],
): CheckedAnswer {
  const schemaRemoved = emptyRemovals();
  const quoteRemoved: QuoteRemovals = { links: 0, topics: 0, relations: 0 };
  const passageByRef = new Map(passages.map((passage) => [passage.ref, passage]));
  const knownByRef = new Map(known.map((topic) => [topic.ref, topic]));

  const topics: ResultTopic[] = [];
  // The normalized names of the topics that the quote check removed.
  const removedNames = new Set<string>();
  for (const item of answer.topics) {
    if (!isRecord(item)) {
      schemaRemoved.invalidItem += 1;
      continue;
    }
    const name = text(item.name);
    if (!normalizeName(name)) {
      schemaRemoved.emptyName += 1;
      continue;
    }
    let sameAs: string | null = null;
    if (item.sameAs !== null && item.sameAs !== undefined) {
      const target = typeof item.sameAs === "number" ? knownByRef.get(item.sameAs) : undefined;
      if (target) sameAs = target.name;
      else schemaRemoved.unknownSameAs += 1;
    }
    const links: ResultLink[] = [];
    for (const link of Array.isArray(item.links) ? item.links : []) {
      if (!isRecord(link)) {
        schemaRemoved.invalidItem += 1;
        continue;
      }
      const passage = typeof link.passage === "string" ? passageByRef.get(link.passage) : undefined;
      if (!passage) {
        schemaRemoved.unknownPassage += 1;
        continue;
      }
      const role = typeof link.role === "string" && ROLES.has(link.role) ? (link.role as LinkRole) : null;
      if (!role) {
        schemaRemoved.unknownRole += 1;
        continue;
      }
      const quote = text(link.quote);
      if (Array.from(quote).length > MAX_QUOTE_CHARACTERS) {
        schemaRemoved.quoteTooLong += 1;
        continue;
      }
      const quoteStart = findQuote(passage.text, quote);
      if (quoteStart === null) {
        quoteRemoved.links += 1;
        continue;
      }
      links.push({ position: passage.position, role, quote, quoteStart });
    }
    if (links.length === 0) {
      quoteRemoved.topics += 1;
      removedNames.add(normalizeName(name));
      continue;
    }
    topics.push({ name, description: text(item.description), sameAs, links });
  }

  // A relation end names a topic of the answer first, then a known topic by its name or an alias name.
  const endNames = new Map<string, string>();
  for (const topic of topics) {
    const normalized = normalizeName(topic.name);
    if (!endNames.has(normalized)) endNames.set(normalized, topic.name);
  }
  for (const topic of known) {
    for (const name of [topic.name, ...topic.aliases]) {
      const normalized = normalizeName(name);
      if (normalized && !endNames.has(normalized)) endNames.set(normalized, topic.name);
    }
  }

  const relations: ResultRelation[] = [];
  for (const item of answer.relations) {
    if (!isRecord(item)) {
      schemaRemoved.invalidItem += 1;
      continue;
    }
    const kind = typeof item.kind === "string" && KINDS.has(item.kind) ? (item.kind as RelationKind) : null;
    if (!kind) {
      schemaRemoved.unknownKind += 1;
      continue;
    }
    const passage = typeof item.passage === "string" ? passageByRef.get(item.passage) : undefined;
    if (!passage) {
      schemaRemoved.unknownRelationPassage += 1;
      continue;
    }
    const ends = [normalizeName(text(item.from)), normalizeName(text(item.to))];
    const [from, to] = ends.map((end) => endNames.get(end));
    if (from === undefined || to === undefined) {
      // The relation goes with a topic that the quote check removed. Each other unknown end is a schema removal.
      if (ends.some((end) => removedNames.has(end) && !endNames.has(end))) quoteRemoved.relations += 1;
      else schemaRemoved.unknownEnd += 1;
      continue;
    }
    relations.push({ kind, from, to, reason: text(item.reason), position: passage.position });
  }

  return { topics, relations, schemaRemoved, quoteRemoved };
}

// The stored result of a lesson from the checked answers of its requests.
export function lessonResult(passageCount: number, parts: readonly CheckedAnswer[]): LessonResult {
  const schemaRemoved = emptyRemovals();
  const quoteRemoved: QuoteRemovals = { links: 0, topics: 0, relations: 0 };
  for (const part of parts) {
    for (const reason of SCHEMA_REASONS) schemaRemoved[reason] += part.schemaRemoved[reason];
    quoteRemoved.links += part.quoteRemoved.links;
    quoteRemoved.topics += part.quoteRemoved.topics;
    quoteRemoved.relations += part.quoteRemoved.relations;
  }
  return {
    format: RESULT_FORMAT,
    passages: passageCount,
    topics: parts.flatMap((part) => part.topics),
    relations: parts.flatMap((part) => part.relations),
    schemaRemoved,
    quoteRemoved,
  };
}

function readLink(value: unknown, passages: number): ResultLink | null {
  if (!isRecord(value) || !isCount(value.position) || value.position < 1 || value.position > passages) return null;
  if (typeof value.role !== "string" || !ROLES.has(value.role)) return null;
  if (typeof value.quote !== "string" || !isCount(value.quoteStart)) return null;
  return { position: value.position, role: value.role as LinkRole, quote: value.quote, quoteStart: value.quoteStart };
}

function readTopic(value: unknown, passages: number): ResultTopic | null {
  if (!isRecord(value) || typeof value.name !== "string" || !normalizeName(value.name)) return null;
  if (typeof value.description !== "string" || !Array.isArray(value.links) || value.links.length === 0) return null;
  if (value.sameAs !== null && typeof value.sameAs !== "string") return null;
  const links = value.links.map((link) => readLink(link, passages));
  if (links.some((link) => link === null)) return null;
  return {
    name: value.name,
    description: value.description,
    sameAs: value.sameAs,
    links: links.filter((link) => link !== null),
  };
}

function readRelation(value: unknown, passages: number): ResultRelation | null {
  if (!isRecord(value) || typeof value.kind !== "string" || !KINDS.has(value.kind)) return null;
  if (typeof value.from !== "string" || typeof value.to !== "string" || typeof value.reason !== "string") return null;
  if (!isCount(value.position) || value.position < 1 || value.position > passages) return null;
  return {
    kind: value.kind as RelationKind,
    from: value.from,
    to: value.to,
    reason: value.reason,
    position: value.position,
  };
}

function readCount(value: unknown, key: string): number {
  const count = isRecord(value) ? value[key] : undefined;
  return isCount(count) ? count : 0;
}

// Read a stored result of a lesson. A result in another form, or with a broken item, gives null,
// and the lesson goes to the engine again.
export function readStoredResult(value: unknown): LessonResult | null {
  if (!isRecord(value) || value.format !== RESULT_FORMAT || !isCount(value.passages)) return null;
  if (!Array.isArray(value.topics) || !Array.isArray(value.relations)) return null;
  const passages = value.passages;
  const topics = value.topics.map((topic) => readTopic(topic, passages));
  const relations = value.relations.map((relation) => readRelation(relation, passages));
  if (topics.some((topic) => topic === null) || relations.some((relation) => relation === null)) return null;
  const schemaRemoved = emptyRemovals();
  for (const reason of SCHEMA_REASONS) schemaRemoved[reason] = readCount(value.schemaRemoved, reason);
  return {
    format: RESULT_FORMAT,
    passages,
    topics: topics.filter((topic) => topic !== null),
    relations: relations.filter((relation) => relation !== null),
    schemaRemoved,
    quoteRemoved: {
      links: readCount(value.quoteRemoved, "links"),
      topics: readCount(value.quoteRemoved, "topics"),
      relations: readCount(value.quoteRemoved, "relations"),
    },
  };
}
