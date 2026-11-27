// Fake model: a local Messages API address that answers with fixed data, so CI can run the engine with no key.
// Zero dependencies on purpose. It uses no key and no network. Run it with: node scripts/fake-model.mjs
// It listens on 127.0.0.1:8791. MODEL_PORT overrides the port. npm run engine -- --fake starts it.
// With MODEL_KEY set, each request must hold that key in x-api-key. npm run engine sets a new key for each start.
//
// The answer comes from the passage markers of the request ("[passage P1] Heading > Subheading", see
// engine/rubber_duck_engine/prompt.py): one topic for each heading, named after the last heading of the path,
// with an "explains" link and a quote from the start of its passage. With 2 topics or more it adds one
// prerequisite relation (topic 1 before topic 2). With 3 topics or more it adds one part_of relation (topic 3
// is a part of topic 2). The field names are the fields of engine/rubber_duck_engine/model.py.
//
// The server logs one line for each request with the request form, the model, max_tokens and the thinking
// field. It never logs the text of a request.

import { startMessagesServer, writeMessagesAnswer } from "./lib/messages-api.mjs";

const PORT = Number(process.env.MODEL_PORT ?? 8791);
const MARKER = /^\[passage ([A-Za-z0-9_-]+)\](?: (.*))?$/;
const QUOTE_LENGTH = 80;

// The passages of the user text: the reference, the heading path and the text after the marker line.
function readPassages(userText) {
  const passages = [];
  let current = null;
  for (const line of userText.split("\n")) {
    const match = MARKER.exec(line);
    if (match) {
      current = { ref: match[1], headingPath: match[2] ? match[2].split(" > ") : [], lines: [] };
      passages.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return passages.map(({ ref, headingPath, lines }) => ({ ref, headingPath, text: lines.join("\n").trim() }));
}

// A quote from the start of the passage: the first line with text, cut to QUOTE_LENGTH characters.
function quoteOf(text) {
  const line = text.split("\n").find((item) => item.trim()) ?? "";
  return line.trim().slice(0, QUOTE_LENGTH).trim();
}

function buildFakeAnswer(userText) {
  const topics = [];
  const passageOf = new Map();
  for (const passage of readPassages(userText)) {
    const name = passage.headingPath.at(-1)?.trim();
    const quote = quoteOf(passage.text);
    if (!name || !quote || passageOf.has(name)) continue;
    passageOf.set(name, passage.ref);
    topics.push({
      name,
      description: `The lesson section ${name}.`,
      same_as: null,
      links: [{ passage: passage.ref, role: "explains", quote }],
    });
  }
  const relations = [];
  if (topics.length >= 2) {
    relations.push({
      kind: "prerequisite",
      from_topic: topics[0].name,
      to_topic: topics[1].name,
      reason: "The fake model puts the first topic before the second topic.",
      passage: passageOf.get(topics[1].name),
    });
  }
  if (topics.length >= 3) {
    relations.push({
      kind: "part_of",
      from_topic: topics[2].name,
      to_topic: topics[1].name,
      reason: "The fake model puts the third topic inside the second topic.",
      passage: passageOf.get(topics[2].name),
    });
  }
  return { topics, relations };
}

startMessagesServer({
  port: PORT,
  key: process.env.MODEL_KEY || null,
  answer(request, headers) {
    const value = buildFakeAnswer(request.user);
    // A rough count of 4 characters for each token, so the engine and the worker see numbers.
    const usage = {
      inputTokens: Math.ceil((request.system.length + request.user.length) / 4),
      outputTokens: Math.ceil(JSON.stringify(value).length / 4),
    };
    console.log(
      JSON.stringify({
        event: "model_request",
        form: request.form,
        model: request.model,
        maxTokens: request.maxTokens,
        thinking: request.thinking,
        beta: headers["anthropic-beta"] ?? null,
        topics: value.topics.length,
      }),
    );
    return { message: writeMessagesAnswer(request, value, usage) };
  },
  onListening() {
    console.log(`The fake model listens at http://127.0.0.1:${PORT}`);
  },
});
