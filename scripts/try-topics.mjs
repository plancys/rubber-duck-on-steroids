// Try the topic engine on one lesson, with no database write.
// Zero dependencies on purpose. It needs a running engine: npm run engine in a second terminal.
//
//   npm run topics:try -- <lesson.md> [--known <topics.json>]
//   npm run topics:try -- --course <course id> --lesson <position> [--known <topics.json>]
//
// The script splits the lesson into passages, calls POST /extract of the engine, runs the quote check, and prints
// the topics, the links with their quotes, the relations, the rejected links and the token counts.
// The second form reads one lesson of the local Supabase database. It reads the local service key into memory
// only, as scripts/worker.mjs does. It never prints the key and never writes it to a file.
// --known names a JSON file with the known topics: a list of names, or of { "name", "aliases" } objects.
// TOPIC_ENGINE_URL (default http://127.0.0.1:8790) and TOPIC_ENGINE_SECRET (default local-engine-secret) select
// another engine.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { findQuote } from "../worker/topics/quote.ts";
import { splitLesson } from "../worker/topics/split.ts";

const root = resolve(import.meta.dirname, "..");
const useShell = process.platform === "win32";
const engineUrl = (process.env.TOPIC_ENGINE_URL || "http://127.0.0.1:8790").replace(/\/+$/, "");
const engineSecret = process.env.TOPIC_ENGINE_SECRET || "local-engine-secret";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE = [
  "Usage:",
  "  npm run topics:try -- <lesson.md> [--known <topics.json>]",
  "  npm run topics:try -- --course <course id> --lesson <position> [--known <topics.json>]",
].join("\n");

function exitWith(message) {
  console.error(message);
  process.exit(1);
}

function readArguments(argv) {
  const options = { file: null, course: null, lesson: null, known: null };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--course" || value === "--lesson" || value === "--known") {
      const next = argv[index + 1];
      if (!next) exitWith(`${value} needs a value.\n${USAGE}`);
      options[value.slice(2)] = next;
      index += 1;
    } else if (value === "--help" || value === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (!options.file) {
      options.file = value;
    } else {
      exitWith(`Unknown argument ${value}.\n${USAGE}`);
    }
  }
  if (options.file && (options.course || options.lesson))
    exitWith(`Give a file or a course lesson, not both.\n${USAGE}`);
  if (!options.file && !(options.course && options.lesson)) exitWith(USAGE);
  return options;
}

function stripQuotes(value) {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    return value.slice(1, -1);
  }
  return value;
}

// The URL and the service key of the local Supabase stack, in memory only.
function localDatabase() {
  const status = spawnSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
    shell: useShell,
    encoding: "utf8",
  });
  if (status.error || status.status !== 0) {
    exitWith("Cannot read the local Supabase values. Start the local stack with npm start first.");
  }
  const local = {};
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) local[match[1]] = stripQuotes(match[2]);
  }
  if (!local.API_URL || !local.SERVICE_ROLE_KEY) {
    exitWith("Cannot read the local Supabase values. The output has no API_URL or SERVICE_ROLE_KEY.");
  }
  return { url: local.API_URL.replace(/\/+$/, ""), key: local.SERVICE_ROLE_KEY };
}

// One lesson of the local database: { url, title, markdown }.
async function readDatabaseLesson(courseId, positionText) {
  if (!UUID.test(courseId)) exitWith("--course must be a course id (a UUID).");
  const position = Number(positionText);
  if (!Number.isInteger(position) || position < 1) exitWith("--lesson must be a lesson position of 1 or more.");
  const database = localDatabase();
  const query = new URLSearchParams({
    select: "url,title,markdown,status",
    course_id: `eq.${courseId}`,
    position: `eq.${position}`,
  });
  const response = await fetch(`${database.url}/rest/v1/lessons?${query.toString()}`, {
    headers: { apikey: database.key, Authorization: `Bearer ${database.key}` },
  });
  if (!response.ok) exitWith(`The database answered ${response.status} for the lesson.`);
  const [lesson] = await response.json();
  if (!lesson) exitWith(`The course has no lesson at position ${position}.`);
  if (!lesson.markdown) exitWith(`The lesson at position ${position} has no text (status ${lesson.status}).`);
  return { url: lesson.url, title: lesson.title || lesson.url, markdown: lesson.markdown };
}

function readFileLesson(file) {
  const path = resolve(file);
  let markdown;
  try {
    markdown = readFileSync(path, "utf8");
  } catch (error) {
    exitWith(`Cannot read ${file}: ${error.message}`);
  }
  const heading = /^#\s+(.+)$/m.exec(markdown);
  return { url: pathToFileURL(path).href, title: heading ? heading[1].trim() : basename(path), markdown };
}

function readKnownTopics(file) {
  if (!file) return [];
  let list;
  try {
    list = JSON.parse(readFileSync(resolve(file), "utf8"));
  } catch (error) {
    exitWith(`Cannot read the known topics in ${file}: ${error.message}`);
  }
  if (!Array.isArray(list)) exitWith("The known topics file must hold a JSON list.");
  return list.map((item, index) => {
    const name = typeof item === "string" ? item : item?.name;
    if (typeof name !== "string" || !name.trim()) exitWith(`Known topic ${index + 1} has no name.`);
    const aliases = Array.isArray(item?.aliases) ? item.aliases.filter((alias) => typeof alias === "string") : [];
    return { ref: index + 1, name: name.trim(), aliases };
  });
}

const options = readArguments(process.argv.slice(2));
const lesson = options.file ? readFileLesson(options.file) : await readDatabaseLesson(options.course, options.lesson);
const knownTopics = readKnownTopics(options.known);
const passages = splitLesson(lesson.markdown);
if (passages.length === 0) exitWith("The lesson has no text.");

console.log(`Lesson: ${lesson.title}`);
console.log(`Passages: ${passages.length}, ${lesson.markdown.length} characters`);
for (const passage of passages) {
  const path = passage.headingPath.join(" > ") || "(text before the first heading)";
  console.log(`  ${passage.ref}  ${path}  (${passage.text.length} characters)`);
}
if (knownTopics.length > 0) console.log(`Known topics: ${knownTopics.length}`);

const started = Date.now();
let response;
try {
  response = await fetch(`${engineUrl}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${engineSecret}` },
    body: JSON.stringify({
      lesson: { url: lesson.url, title: lesson.title },
      passages: passages.map((passage) => ({ ref: passage.ref, headingPath: passage.headingPath, text: passage.text })),
      knownTopics,
    }),
  });
} catch (error) {
  exitWith(`Cannot reach the engine at ${engineUrl}: ${error.message}. Start it with npm run engine.`);
}
const seconds = ((Date.now() - started) / 1000).toFixed(1);
const answer = await response.json().catch(() => null);
if (!response.ok) {
  exitWith(`The engine answered ${response.status} (${answer?.error ?? "no code"}) after ${seconds} s.`);
}

const textOf = new Map(passages.map((passage) => [passage.ref, passage.text]));
const knownName = new Map(knownTopics.map((topic) => [topic.ref, topic.name]));
const rejected = [];
let accepted = 0;

console.log(`\nEngine: ${answer.engine}, prompt ${answer.promptVersion}, model ${answer.model}, ${seconds} s`);
console.log(
  answer.usage
    ? `Tokens: ${answer.usage.inputTokens} input, ${answer.usage.outputTokens} output`
    : "Tokens: the model gateway gave no numbers",
);

console.log(`\nTopics (${answer.topics.length}):`);
answer.topics.forEach((topic, index) => {
  const same =
    topic.sameAs === null ? "" : `  [same as known ${topic.sameAs}: ${knownName.get(topic.sameAs) ?? "unknown"}]`;
  console.log(`${index + 1}. ${topic.name}${same}`);
  console.log(`   ${topic.description}`);
  for (const link of topic.links) {
    const text = textOf.get(link.passage);
    const start = text === undefined ? null : findQuote(text, link.quote);
    if (start === null) {
      rejected.push({
        topic: topic.name,
        link,
        reason: text === undefined ? "unknown passage" : "quote not in passage",
      });
      continue;
    }
    accepted += 1;
    console.log(`   - ${link.passage} ${link.role} at ${start}: "${link.quote}"`);
  }
});

console.log(`\nRelations (${answer.relations.length}):`);
for (const relation of answer.relations) {
  console.log(`- ${relation.kind}: ${relation.from} -> ${relation.to} (${relation.passage})`);
  console.log(`  ${relation.reason}`);
}

console.log(`\nRejected links (${rejected.length}):`);
for (const { topic, link, reason } of rejected) {
  console.log(`- ${topic}, ${link.passage} ${link.role}: ${reason}: "${link.quote}"`);
}
console.log(`\nLinks: ${accepted} accepted, ${rejected.length} rejected.`);
