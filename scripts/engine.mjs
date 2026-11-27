// Local engine: starts the topic engine of engine/ with a model source, in one command.
// Zero dependencies on purpose. Run with npm run engine, or with: node scripts/engine.mjs [--fake]
// The engine needs uv: https://docs.astral.sh/uv/. uv installs the locked Python packages on the first start.
//
// The model source:
// - --fake: the fake model of scripts/fake-model.mjs. No key and no network. CI uses it.
// - ANTHROPIC_API_KEY in the environment: the Anthropic API with that key.
// - Else: the Claude Code bridge of scripts/model-bridge.mjs. It uses the Claude Code login of the developer.
// The script prints the model source. It never prints a key.
//
// The engine listens on 127.0.0.1:8790 with ENGINE_SECRET=local-engine-secret. ENGINE_PORT, MODEL_PORT and
// ENGINE_SECRET override the defaults. LLM_MODEL selects another model, for example anthropic/claude-sonnet-5-5.
// Ctrl+C stops the engine and the model source.

import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(import.meta.dirname, "..");
const useShell = process.platform === "win32";
const fake = process.argv.slice(2).includes("--fake");
const enginePort = Number(process.env.ENGINE_PORT ?? 8790);
const modelPort = Number(process.env.MODEL_PORT ?? 8791);
const modelAddress = `http://127.0.0.1:${modelPort}`;

function exitWith(message) {
  console.error(`The engine cannot start. ${message}`);
  process.exit(1);
}

for (const [name, port] of [
  ["ENGINE_PORT", enginePort],
  ["MODEL_PORT", modelPort],
]) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) exitWith(`${name} must be a port number.`);
}

const uv = spawnSync("uv", ["--version"], { stdio: "ignore", shell: useShell });
if (uv.error || uv.status !== 0) {
  exitWith("Install uv first: https://docs.astral.sh/uv/getting-started/installation/");
}

// The engine reads its model settings only from LLM_MODEL, LLM_API_KEY and LLM_ENDPOINT.
const env = { ...process.env };
delete env.LLM_API_KEY;
delete env.LLM_ENDPOINT;
env.ENGINE_SECRET ||= "local-engine-secret";
env.PORT = String(enginePort);
// A local engine listens on this machine only. The bridge behind it uses the Claude Code login of the developer.
env.HOST = "127.0.0.1";

let modelScript = null;
let source;
if (fake) {
  delete env.ANTHROPIC_API_KEY;
  modelScript = "fake-model.mjs";
  env.LLM_ENDPOINT = modelAddress;
  // LiteLLM needs a key value. The fake model does not read it.
  env.LLM_API_KEY = "fake-model-no-key";
  source = `the fake model at ${modelAddress}`;
} else if (env.ANTHROPIC_API_KEY) {
  env.LLM_API_KEY = env.ANTHROPIC_API_KEY;
  source = "the Anthropic API, with the key from ANTHROPIC_API_KEY";
} else {
  const claude = spawnSync(process.env.CLAUDE_BIN || "claude", ["--version"], { stdio: "ignore", shell: useShell });
  if (claude.error || claude.status !== 0) {
    exitWith("Set ANTHROPIC_API_KEY, or install Claude Code and sign in, or run npm run engine -- --fake.");
  }
  modelScript = "model-bridge.mjs";
  env.LLM_ENDPOINT = modelAddress;
  // LiteLLM needs a key value. The bridge does not read it.
  env.LLM_API_KEY = "claude-code-bridge-no-key";
  source = `the Claude Code bridge at ${modelAddress}, with your Claude Code login`;
}
console.log(`The engine uses ${source}.`);

const children = new Set();
let stopping = false;

function stopAll(signal = "SIGTERM") {
  stopping = true;
  for (const child of children) child.kill(signal);
}

function startChild(command, args, options, name) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.add(child);
  child.on("error", (error) => {
    console.error(`Cannot start ${name}: ${error.message}`);
    stopAll();
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`${name} stopped (${signal ?? `exit code ${code}`}). The engine script stops too.`);
      process.exitCode = code || 1;
      stopAll();
    }
    if (children.size === 0) process.exit(process.exitCode ?? code ?? 0);
  });
  return child;
}

// Ctrl+C goes to the child processes too, because they share the process group. They stop by themselves.
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => stopAll("SIGTERM"));

async function waitForModel() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${modelAddress}/health`);
      if (response.ok) return;
    } catch {
      // The model source does not listen yet.
    }
    await sleep(200);
  }
  console.error(`The model source does not answer at ${modelAddress}.`);
  stopAll();
  process.exitCode = 1;
}

if (modelScript) {
  // The model source gets no model key. The bridge also removes the Anthropic keys from each claude run.
  const modelEnv = { ...process.env, MODEL_PORT: String(modelPort) };
  delete modelEnv.LLM_API_KEY;
  startChild(process.execPath, [resolve(root, "scripts", modelScript)], { cwd: root, env: modelEnv }, modelScript);
  await waitForModel();
}

if (!stopping) {
  startChild(
    "uv",
    ["run", "--frozen", "python", "-m", "rubber_duck_engine.app"],
    { cwd: resolve(root, "engine"), env, shell: useShell },
    "The engine",
  );
}
