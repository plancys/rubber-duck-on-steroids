import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RequestError,
  readMessagesRequest,
  sameKey,
  schemaFromSystemText,
  startMessagesServer,
  writeMessagesAnswer,
  writeStoppedAnswer,
} from "./messages-api.mjs";

const schema = {
  type: "object",
  properties: { topics: { type: "array", items: { type: "string" } } },
  required: ["topics"],
  additionalProperties: false,
};
const value = { topics: ["MergeTree"] };
const usage = { inputTokens: 120, outputTokens: 40 };

// The parts that LiteLLM sends in each request: the system text as blocks and the user text as blocks.
function baseRequest(extra) {
  return {
    model: "claude-haiku-5-5",
    max_tokens: 16000,
    system: [{ type: "text", text: "You find the topics." }],
    messages: [{ role: "user", content: [{ type: "text", text: "[passage P1] Engines\nMergeTree stores data." }] }],
    ...extra,
  };
}

describe("readMessagesRequest", () => {
  it("reads the native output format", () => {
    const request = readMessagesRequest(baseRequest({ output_format: { type: "json_schema", schema } }));
    assert.equal(request.form, "output_format");
    assert.deepEqual(request.schema, schema);
    assert.equal(request.model, "claude-haiku-5-5");
    assert.equal(request.system, "You find the topics.");
    assert.equal(request.user, "[passage P1] Engines\nMergeTree stores data.");
    assert.equal(request.maxTokens, 16000);
    assert.equal(request.thinking, null);
  });

  it("reads the output format of output_config", () => {
    const request = readMessagesRequest(baseRequest({ output_config: { format: { type: "json_schema", schema } } }));
    assert.equal(request.form, "output_format");
    assert.deepEqual(request.schema, schema);
  });

  it("reads a forced tool call", () => {
    const request = readMessagesRequest(
      baseRequest({
        tools: [{ name: "json_tool_call", input_schema: schema }],
        tool_choice: { type: "tool", name: "json_tool_call" },
        thinking: { type: "disabled" },
      }),
    );
    assert.equal(request.form, "tool");
    assert.equal(request.toolName, "json_tool_call");
    assert.deepEqual(request.schema, schema);
    assert.deepEqual(request.thinking, { type: "disabled" });
  });

  it("reads JSON text with the schema in the system text", () => {
    const system =
      "You find the topics.\n\nYou MUST respond with valid JSON conforming to this schema:\n```json\n" +
      JSON.stringify(schema, null, 2) +
      "\n```\nDo not include any text outside the JSON object.";
    const request = readMessagesRequest(baseRequest({ system, messages: [{ role: "user", content: "Lesson" }] }));
    assert.equal(request.form, "text");
    assert.deepEqual(request.schema, schema);
    assert.equal(request.user, "Lesson");
  });

  it("gives no schema for JSON text without a schema", () => {
    const request = readMessagesRequest(baseRequest({}));
    assert.equal(request.form, "text");
    assert.equal(request.schema, null);
  });

  it("refuses a body that is not a Messages API request", () => {
    assert.throws(() => readMessagesRequest(null), RequestError);
    assert.throws(() => readMessagesRequest({ messages: [] }), RequestError);
    assert.throws(() => readMessagesRequest({ model: "m", messages: [] }), RequestError);
    assert.throws(
      () => readMessagesRequest(baseRequest({ tools: [{ name: "other" }], tool_choice: { type: "tool", name: "x" } })),
      RequestError,
    );
  });

  it("marks a streaming request", () => {
    assert.equal(readMessagesRequest(baseRequest({ stream: true })).stream, true);
  });
});

describe("writeMessagesAnswer", () => {
  it("answers the native output format with JSON text", () => {
    const request = readMessagesRequest(baseRequest({ output_format: { type: "json_schema", schema } }));
    const answer = writeMessagesAnswer(request, value, usage);
    assert.equal(answer.type, "message");
    assert.equal(answer.role, "assistant");
    assert.equal(answer.model, "claude-haiku-5-5");
    assert.equal(answer.stop_reason, "end_turn");
    assert.deepEqual(answer.content, [{ type: "text", text: JSON.stringify(value) }]);
    assert.deepEqual(answer.usage, { input_tokens: 120, output_tokens: 40 });
    assert.match(answer.id, /^msg_/);
  });

  it("answers a forced tool call with a tool use block", () => {
    const request = readMessagesRequest(
      baseRequest({
        tools: [{ name: "json_tool_call", input_schema: schema }],
        tool_choice: { type: "tool", name: "json_tool_call" },
      }),
    );
    const answer = writeMessagesAnswer(request, value, usage);
    assert.equal(answer.stop_reason, "tool_use");
    assert.equal(answer.content.length, 1);
    assert.equal(answer.content[0].type, "tool_use");
    assert.equal(answer.content[0].name, "json_tool_call");
    assert.deepEqual(answer.content[0].input, value);
  });

  it("answers JSON text with a text block", () => {
    const answer = writeMessagesAnswer(readMessagesRequest(baseRequest({})), value, usage);
    assert.equal(answer.stop_reason, "end_turn");
    assert.deepEqual(JSON.parse(answer.content[0].text), value);
  });

  it("writes a stopped answer with no content", () => {
    const answer = writeStoppedAnswer(readMessagesRequest(baseRequest({})), "refusal", usage);
    assert.equal(answer.stop_reason, "refusal");
    assert.deepEqual(answer.content, []);
  });
});

describe("schemaFromSystemText", () => {
  it("gives null for a broken schema", () => {
    assert.equal(schemaFromSystemText("conforming to this schema:\n```json\n{ broken\n```"), null);
  });
});

describe("startMessagesServer", () => {
  // One server on a free port with the key "test-key". It answers each valid request with the fixed value.
  async function withServer(run) {
    const server = await new Promise((resolveServer) => {
      startMessagesServer({
        port: 0,
        key: "test-key",
        answer: (request) => ({ message: writeMessagesAnswer(request, value, usage) }),
        onListening: resolveServer,
      });
    });
    const address = `http://127.0.0.1:${server.address().port}/v1/messages`;
    try {
      await run(address);
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  }
  const body = JSON.stringify(baseRequest({ output_format: { type: "json_schema", schema } }));

  it("refuses a request from a browser, which sends an Origin header", async () => {
    await withServer(async (address) => {
      const response = await fetch(address, {
        method: "POST",
        headers: { "content-type": "text/plain", origin: "https://example.com", "x-api-key": "test-key" },
        body,
      });
      assert.equal(response.status, 403);
    });
  });

  it("refuses a request with no key or with a wrong key", async () => {
    await withServer(async (address) => {
      const missing = await fetch(address, { method: "POST", headers: { "content-type": "application/json" }, body });
      assert.equal(missing.status, 401);
      const wrong = await fetch(address, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "test-kez" },
        body,
      });
      assert.equal(wrong.status, 401);
    });
  });

  it("answers a request with the key", async () => {
    await withServer(async (address) => {
      const response = await fetch(address, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "test-key" },
        body,
      });
      assert.equal(response.status, 200);
    });
  });

  it("compares the key in full", () => {
    assert.equal(sameKey("test-key", "test-key"), true);
    assert.equal(sameKey("test-ke", "test-key"), false);
    assert.equal(sameKey(undefined, "test-key"), false);
  });
});
