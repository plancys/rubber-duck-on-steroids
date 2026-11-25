import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPrompt, createLessonPicker, LESSON_MODEL, MAX_PICKED, parseLessonIndexes, PICK_TOOL } from "./llm.ts";

const links = [
  { url: "https://docs.example/", text: "Home" },
  { url: "https://docs.example/docs/ducks/first", text: "First" },
  { url: "https://docs.example/docs/ducks/second", text: "" },
];

test("a valid answer gives 0-based indexes in the given order", () => {
  assert.deepEqual(parseLessonIndexes({ lessons: [3, 2] }, 3), [2, 1]);
});

test("an answer without the lessons list is not valid", () => {
  for (const input of [null, "2, 3", [2, 3], {}, { lessons: "2" }, { other: [2] }]) {
    assert.equal(parseLessonIndexes(input, 3), null);
  }
});

test("numbers outside the list, non-integers and duplicates go", () => {
  assert.deepEqual(parseLessonIndexes({ lessons: [0, 4, -1, 2.5, "2", 2, 3, 2] }, 3), [1, 2]);
});

test("an answer with only numbers outside the list is not valid", () => {
  assert.equal(parseLessonIndexes({ lessons: [0, 4, 99] }, 3), null);
  assert.equal(parseLessonIndexes({ lessons: [] }, 3), null);
});

test("the parser keeps at most 200 indexes", () => {
  const lessons = Array.from({ length: 300 }, (_, index) => index + 1);
  assert.equal(parseLessonIndexes({ lessons }, 300)?.length, MAX_PICKED);
});

test("the prompt numbers the links from 1, in page order", () => {
  const prompt = buildPrompt({ title: "Intro to Ducks", url: "https://docs.example/docs/ducks", links });
  assert.match(prompt, /^1\tHome\thttps:\/\/docs\.example\/$/m);
  assert.match(prompt, /^3\t\(no text\)\thttps:\/\/docs\.example\/docs\/ducks\/second$/m);
  assert.match(prompt, /Title: Intro to Ducks/);
});

test("without a key there is no picker", () => {
  assert.equal(createLessonPicker(undefined), null);
  assert.equal(createLessonPicker(""), null);
});

test("the picker makes one forced tool call and reads the tool input", async () => {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fakeFetch: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push({
      url,
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown>,
    });
    const message = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: LESSON_MODEL,
      content: [{ type: "tool_use", id: "toolu_test", name: PICK_TOOL, input: { lessons: [3, 2] } }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 321, output_tokens: 12 },
    };
    return Promise.resolve(
      new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } }),
    );
  };
  const picker = createLessonPicker("test-key", { fetch: fakeFetch });
  assert.ok(picker);
  const result = await picker.pickLessons(
    { title: "Intro to Ducks", url: "https://docs.example/docs/ducks", links },
    new AbortController().signal,
  );
  assert.deepEqual(result, { indexes: [2, 1], inputTokens: 321, outputTokens: 12 });
  assert.equal(requests.length, 1);
  assert.match(requests[0]?.url ?? "", /\/v1\/messages$/);
  const body = requests[0]?.body ?? {};
  assert.equal(body.model, LESSON_MODEL);
  assert.deepEqual(body.tool_choice, { type: "tool", name: PICK_TOOL, disable_parallel_tool_use: true });
});

test("an answer without the tool call gives no indexes", async () => {
  const fakeFetch: typeof fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: LESSON_MODEL,
          content: [{ type: "text", text: "I cannot tell." }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  const picker = createLessonPicker("test-key", { fetch: fakeFetch });
  assert.ok(picker);
  const result = await picker.pickLessons(
    { title: null, url: "https://docs.example/", links },
    new AbortController().signal,
  );
  assert.deepEqual(result, { indexes: null, inputTokens: 10, outputTokens: 4 });
});
