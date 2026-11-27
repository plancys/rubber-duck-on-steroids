// Claude Code bridge: a local Messages API address that answers through Claude Code with the login of the developer.
// Zero dependencies on purpose. Run it with: node scripts/model-bridge.mjs. npm run engine starts it with no API key.
// It listens on 127.0.0.1:8791 only. MODEL_PORT overrides the port. CLAUDE_BIN overrides the claude command.
//
// The bridge is a local tool for one developer. It never runs in CI or in production, because the Claude Code
// terms do not let a product send the requests of its users through a subscription login.
//
// For each request the bridge runs one claude process in an empty temporary folder, with the user text on
// standard input. It removes ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN from the environment of that process,
// so claude uses the subscription login and not a key. It returns the structured_output field of the result.
// A run with no structured output gives an API error answer. A refusal and a cut answer keep their stop reason.
// The bridge logs the model name and the duration of each claude call. It never logs the text.

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import {
  ModelError,
  RequestError,
  startMessagesServer,
  writeMessagesAnswer,
  writeStoppedAnswer,
} from "./lib/messages-api.mjs";

const PORT = Number(process.env.MODEL_PORT ?? 8791);
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
// The longest claude run. The engine stops a model call after 240 seconds.
const CALL_TIMEOUT_MS = 300_000;
const MODEL_NAME = /^[A-Za-z0-9._-]{1,100}$/;
// These variables link a process to an outer Claude Code session. A bridge run is a separate session.
const SESSION_VARIABLES =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_CODE_(ENTRYPOINT|SESSION_ID|CHILD_SESSION|BRIDGE_SESSION_ID|MESSAGING_SOCKET|MESSAGING_TOKEN|SESSION_ATTENDED|EXECPATH))$/;

// The environment of a claude run: no key, so claude uses the subscription login.
function claudeEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name !== "ANTHROPIC_API_KEY" && name !== "ANTHROPIC_AUTH_TOKEN" && !SESSION_VARIABLES.test(name),
    ),
  );
}

// The parsed JSON object of a text, or null.
function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Run claude once. Resolves with the parsed JSON result. Rejects with ModelError.
async function runClaude({ model, system, user, schema }) {
  const folder = await mkdtemp(join(tmpdir(), "rubber-duck-bridge-"));
  try {
    return await new Promise((resolveRun, reject) => {
      const args = [
        "-p",
        "--safe-mode",
        "--tools",
        "",
        "--no-session-persistence",
        "--system-prompt",
        system,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(schema),
        "--model",
        model,
      ];
      const child = spawn(CLAUDE_BIN, args, { cwd: folder, env: claudeEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
      const out = [];
      let errorBytes = 0;
      const timer = setTimeout(() => child.kill("SIGTERM"), CALL_TIMEOUT_MS);
      child.stdout.on("data", (chunk) => out.push(chunk));
      // The error output can hold parts of the prompt, so the bridge counts it and does not print it.
      child.stderr.on("data", (chunk) => {
        errorBytes += chunk.length;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new ModelError(`Cannot run ${CLAUDE_BIN}: ${error.message}`));
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        const result = parseObject(Buffer.concat(out).toString("utf8").trim());
        if (result) {
          resolveRun(result);
          return;
        }
        const reason = signal ? `stopped by ${signal}` : `exit code ${code}`;
        reject(new ModelError(`claude gave no JSON result (${reason}, ${errorBytes} bytes of error output).`));
      });
      child.stdin.on("error", () => {
        // claude can exit before it reads the whole input. The close handler reports the result.
      });
      child.stdin.end(user);
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

// The token counts of a claude result. Claude Code caches the prompt, so the input count holds the cache parts.
function usageOf(result) {
  const usage = result.usage ?? {};
  const number = (value) => (typeof value === "number" ? value : 0);
  return {
    inputTokens:
      number(usage.input_tokens) + number(usage.cache_creation_input_tokens) + number(usage.cache_read_input_tokens),
    outputTokens: number(usage.output_tokens),
  };
}

startMessagesServer({
  port: PORT,
  async answer(request) {
    if (!MODEL_NAME.test(request.model)) throw new RequestError("The model name is not valid.");
    if (!request.schema) throw new RequestError("The bridge needs an answer schema in the request.");
    const started = Date.now();
    let outcome = "error";
    try {
      const result = await runClaude(request);
      const usage = usageOf(result);
      if (result.stop_reason === "refusal" || result.stop_reason === "max_tokens") {
        outcome = result.stop_reason;
        return { message: writeStoppedAnswer(request, result.stop_reason, usage) };
      }
      if (result.is_error === true || result.structured_output === undefined) {
        throw new ModelError(`claude gave no structured output (${String(result.subtype ?? "no subtype")}).`);
      }
      outcome = "ok";
      return { message: writeMessagesAnswer(request, result.structured_output, usage) };
    } finally {
      console.log(
        JSON.stringify({
          event: "claude_call",
          model: request.model,
          result: outcome,
          durationMs: Date.now() - started,
        }),
      );
    }
  },
  onListening() {
    console.log(`The Claude Code bridge listens at http://127.0.0.1:${PORT}`);
  },
});
