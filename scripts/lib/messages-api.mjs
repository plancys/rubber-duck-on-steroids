// The Messages API of a local model address: the Claude Code bridge and the fake model use it.
// Zero dependencies on purpose. The engine reaches both through Cognee and LiteLLM, as it reaches the Anthropic API.
//
// LiteLLM asks for a structured answer in one of three forms:
// - "output_format": a JSON schema in output_format (or in output_config.format), with a beta header.
//   LiteLLM 1.111.0 sends this form for claude-haiku-5-5. Phase 1 of the course-topic-graph change found it.
// - "tool": a forced tool call. The tool (LiteLLM names it json_tool_call) holds the schema as its input_schema.
// - "text": no schema field. The Cognee JSON fallback writes the schema into the system text and asks for JSON text.
// The answer has the form that the request asked for.

import { Buffer } from "node:buffer";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { URL } from "node:url";

// The most bytes of one request body.
export const MAX_REQUEST_BYTES = 10_000_000;

// A request that the address cannot read. The server answers 400 with an invalid_request_error.
export class RequestError extends Error {}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// The text of a system field or of a message content: a string, or a list of blocks with text blocks in it.
export function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n\n");
}

// The JSON schema that the Cognee JSON fallback writes into the system text, or null.
export function schemaFromSystemText(system) {
  const match = /conforming to this schema:\s*```json\s*\n([\s\S]*?)\n\s*```/.exec(system);
  if (!match) return null;
  try {
    const schema = JSON.parse(match[1]);
    return isRecord(schema) ? schema : null;
  } catch {
    return null;
  }
}

// Read the parts of a POST /v1/messages body that a local model address needs.
// Throws RequestError when the body is not a Messages API request.
export function readMessagesRequest(body) {
  if (!isRecord(body)) throw new RequestError("The request body must be a JSON object.");
  if (typeof body.model !== "string" || !body.model) throw new RequestError("The request has no model.");
  if (!Array.isArray(body.messages)) throw new RequestError("The request has no messages.");
  const userMessages = body.messages.filter((message) => isRecord(message) && message.role === "user");
  const lastUser = userMessages.at(-1);
  if (!lastUser) throw new RequestError("The request has no user message.");
  const system = textOf(body.system);

  let form = "text";
  let schema;
  let toolName = null;
  const outputConfigFormat = isRecord(body.output_config) ? body.output_config.format : undefined;
  if (isRecord(body.output_format) && isRecord(body.output_format.schema)) {
    form = "output_format";
    schema = body.output_format.schema;
  } else if (isRecord(outputConfigFormat) && isRecord(outputConfigFormat.schema)) {
    form = "output_format";
    schema = outputConfigFormat.schema;
  } else if (Array.isArray(body.tools) && isRecord(body.tool_choice) && body.tool_choice.type === "tool") {
    const tool = body.tools.find((item) => isRecord(item) && item.name === body.tool_choice.name);
    if (!tool || !isRecord(tool.input_schema)) throw new RequestError("The forced tool has no input schema.");
    form = "tool";
    schema = tool.input_schema;
    toolName = tool.name;
  } else {
    schema = schemaFromSystemText(system);
  }

  return {
    model: body.model,
    system,
    user: textOf(lastUser.content),
    form,
    schema,
    toolName,
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : null,
    thinking: isRecord(body.thinking) ? body.thinking : null,
    stream: body.stream === true,
  };
}

function usageOf(usage) {
  return { input_tokens: usage?.inputTokens ?? 0, output_tokens: usage?.outputTokens ?? 0 };
}

// A Messages API answer that holds value in the form of the request.
export function writeMessagesAnswer(request, value, usage) {
  const base = {
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    model: request.model,
  };
  if (request.form === "tool") {
    return {
      ...base,
      content: [
        { type: "tool_use", id: `toolu_${randomUUID().replaceAll("-", "")}`, name: request.toolName, input: value },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: usageOf(usage),
    };
  }
  return {
    ...base,
    content: [{ type: "text", text: JSON.stringify(value) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: usageOf(usage),
  };
}

// A Messages API answer with no content and a stop reason such as "refusal" or "max_tokens".
export function writeStoppedAnswer(request, stopReason, usage) {
  return {
    id: `msg_${randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    model: request.model,
    content: [],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: usageOf(usage),
  };
}

// A Messages API error body.
export function errorAnswer(type, message) {
  return { type: "error", error: { type, message } };
}

// An error of the model source. The server answers 500 with an api_error and this safe message.
export class ModelError extends Error {}

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  response.end(text);
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new RequestError("The request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

// True when the x-api-key header holds the key. The compare takes the same time for each wrong key of that length.
export function sameKey(header, key) {
  if (typeof header !== "string") return false;
  const given = Buffer.from(header, "utf8");
  const wanted = Buffer.from(key, "utf8");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

// Start a local model address. answer(request, headers) returns { message } with a full Messages API answer.
// GET /health answers 200. The server listens on 127.0.0.1 only.
// POST /v1/messages refuses a request with an Origin header, because a web page in the browser of the developer
// sends one and the engine sends none. With a key, it also refuses a request whose x-api-key header holds another
// value. LiteLLM sends the LLM_API_KEY of the engine in that header. onStop runs on SIGINT and SIGTERM.
export function startMessagesServer({ port, answer, onListening, key = null, onStop }) {
  const server = createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, { status: "ok" });
      return;
    }
    if (request.method !== "POST" || pathname !== "/v1/messages") {
      sendJson(response, 404, errorAnswer("not_found_error", "Only POST /v1/messages exists."));
      return;
    }
    if (request.headers.origin !== undefined) {
      sendJson(response, 403, errorAnswer("permission_error", "A request from a browser is not allowed."));
      return;
    }
    if (key !== null && !sameKey(request.headers["x-api-key"], key)) {
      sendJson(response, 401, errorAnswer("authentication_error", "The key of the request is not valid."));
      return;
    }
    try {
      let body;
      try {
        body = JSON.parse(await readBody(request));
      } catch (error) {
        throw error instanceof RequestError ? error : new RequestError("The request body is not JSON.");
      }
      const parsed = readMessagesRequest(body);
      if (parsed.stream) throw new RequestError("This model address does not stream.");
      const { message } = await answer(parsed, request.headers);
      sendJson(response, 200, message);
    } catch (error) {
      if (error instanceof RequestError) {
        sendJson(response, 400, errorAnswer("invalid_request_error", error.message));
      } else if (error instanceof ModelError) {
        sendJson(response, 500, errorAnswer("api_error", error.message));
      } else {
        sendJson(response, 500, errorAnswer("api_error", "The model address failed."));
      }
    }
  });
  server.listen(port, "127.0.0.1", () => onListening?.(server));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      onStop?.();
      server.close(() => process.exit(0));
      server.closeAllConnections();
    });
  }
  return server;
}
