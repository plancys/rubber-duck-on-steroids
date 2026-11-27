// Engine check: proves the engine path with the fake model and no key.
// Run with npm run check:engine. It needs uv, like npm run engine.
// It starts the fake model and the engine on free ports through scripts/engine.mjs --fake, sends the fixture lesson
// engine/tests/fixtures/lesson.md to POST /extract, checks the form of the answer, and stops both.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { findQuote } from "../worker/topics/quote.ts";
import { splitLesson } from "../worker/topics/split.ts";

const root = resolve(import.meta.dirname, "..");
const SECRET = "check-engine-secret";
// The first start of the engine installs the Python packages and imports Cognee, so it can take a while.
const START_TIMEOUT_MS = 300_000;
const ROLES = new Set(["explains", "mentions"]);
const KINDS = new Set(["prerequisite", "part_of"]);

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

const enginePort = await freePort();
const modelPort = await freePort();
const engineUrl = `http://127.0.0.1:${enginePort}`;
const env = { ...process.env, ENGINE_PORT: String(enginePort), MODEL_PORT: String(modelPort), ENGINE_SECRET: SECRET };
delete env.ANTHROPIC_API_KEY;

const engine = spawn(process.execPath, [resolve(root, "scripts", "engine.mjs"), "--fake"], {
  cwd: root,
  env,
  stdio: "inherit",
});
let engineExited = false;
engine.on("exit", () => {
  engineExited = true;
});

function stopEngine() {
  if (engineExited) return Promise.resolve();
  return new Promise((resolveStop) => {
    engine.once("exit", resolveStop);
    engine.kill("SIGTERM");
  });
}

async function fail(message) {
  console.error(`The engine check failed. ${message}`);
  await stopEngine();
  process.exit(1);
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForEngine() {
  const started = Date.now();
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (engineExited) await fail("The engine stopped before it answered /health.");
    try {
      const response = await fetch(`${engineUrl}/health`);
      if (response.ok) return;
    } catch {
      // The engine does not listen yet.
    }
    await sleep(500);
  }
  await fail(`The engine did not answer /health within ${START_TIMEOUT_MS / 1000} seconds.`);
}

function postExtract(body, secret = SECRET) {
  return fetch(`${engineUrl}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
}

// Check the form of an engine answer against the request. Returns a short summary.
function checkAnswer(answer, passages) {
  const textOf = new Map(passages.map((passage) => [passage.ref, passage.text]));
  check(answer.engine === "cognee-extract/1", `engine is ${JSON.stringify(answer.engine)}.`);
  check(typeof answer.promptVersion === "string" && answer.promptVersion, "promptVersion is missing.");
  check(answer.model === "claude-haiku-5-5", `model is ${JSON.stringify(answer.model)}.`);
  check(
    answer.usage === null ||
      (Number.isInteger(answer.usage?.inputTokens) && Number.isInteger(answer.usage?.outputTokens)),
    "usage is not null and not two token counts.",
  );
  check(Array.isArray(answer.topics) && answer.topics.length > 0, "The answer has no topic.");
  const names = new Set();
  for (const topic of answer.topics) {
    check(typeof topic.name === "string" && topic.name, "A topic has no name.");
    check(typeof topic.description === "string", `Topic ${topic.name} has no description.`);
    check(topic.sameAs === null || Number.isInteger(topic.sameAs), `Topic ${topic.name} has a wrong sameAs.`);
    check(Array.isArray(topic.links) && topic.links.length > 0, `Topic ${topic.name} has no link.`);
    for (const link of topic.links) {
      check(textOf.has(link.passage), `Topic ${topic.name} links to an unknown passage.`);
      check(ROLES.has(link.role), `Topic ${topic.name} has a wrong role.`);
      check(
        findQuote(textOf.get(link.passage), link.quote) !== null,
        `A quote of ${topic.name} is not in its passage.`,
      );
    }
    names.add(topic.name);
  }
  check(Array.isArray(answer.relations), "The answer has no relation list.");
  for (const relation of answer.relations) {
    check(KINDS.has(relation.kind), "A relation has a wrong kind.");
    check(names.has(relation.from) && names.has(relation.to), "A relation names a topic outside the answer.");
    check(typeof relation.reason === "string", "A relation has no reason.");
    check(textOf.has(relation.passage), "A relation names an unknown passage.");
  }
  for (const kind of KINDS) {
    check(
      answer.relations.some((relation) => relation.kind === kind),
      `The answer has no ${kind} relation.`,
    );
  }
  return `${answer.topics.length} topics, ${answer.relations.length} relations`;
}

try {
  await waitForEngine();
  console.log("ok - the engine answers /health");

  const markdown = readFileSync(resolve(root, "engine", "tests", "fixtures", "lesson.md"), "utf8");
  const passages = splitLesson(markdown);
  const request = {
    lesson: { url: "https://example.com/docs/transactions", title: "Transactions" },
    passages: passages.map((passage) => ({ ref: passage.ref, headingPath: passage.headingPath, text: passage.text })),
    knownTopics: [],
  };

  const wrong = await postExtract(request, "wrong-secret");
  check(wrong.status === 401, `A wrong secret gave ${wrong.status}, not 401.`);
  console.log("ok - a wrong secret gives 401");

  const response = await postExtract(request);
  check(response.status === 200, `The fixture lesson gave ${response.status}, not 200.`);
  const summary = checkAnswer(await response.json(), passages);
  console.log(`ok - the fixture lesson gives a valid answer through the fake model (${summary})`);

  const tooLarge = await postExtract({
    ...request,
    passages: [{ ref: "P1", headingPath: [], text: "a".repeat(200_001) }],
  });
  check(tooLarge.status === 413, `A request above the size limit gave ${tooLarge.status}, not 413.`);
  console.log("ok - a request above the size limit gives 413");
} catch (error) {
  await fail(error instanceof Error ? error.message : String(error));
}

await stopEngine();
console.log("The engine check passed.");
