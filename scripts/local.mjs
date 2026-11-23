// Local run: starts the local Supabase stack, applies pending migrations, writes missing env files, and starts the dev server.
// Zero dependencies on purpose. Run with npm start, or with: node scripts/local.mjs [--setup-only] [--exclude=<services>]
// An env file that points to a cloud Supabase URL makes the script skip Docker and the local database.
// The script writes an env file only when it does not exist. It never changes an existing file.

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";

const USAGE = "Usage: node scripts/local.mjs [--setup-only] [--exclude=<comma-separated services>]";
const ENV_FILES = [".env", ".dev.vars"];
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);
const useShell = process.platform === "win32";

let setupOnly = false;
let exclude = null;
for (const arg of process.argv.slice(2)) {
  if (arg === "--setup-only") setupOnly = true;
  // Accept only service names, because on Windows the value goes through the shell.
  else if (/^--exclude=[a-z0-9,-]+$/.test(arg)) exclude = arg.slice("--exclude=".length);
  else {
    console.error(`Unknown argument: ${arg}`);
    console.error(USAGE);
    process.exit(2);
  }
}

function step(message) {
  console.log(`\n> ${message}`);
}

// Read the KEY=value lines of an env file. The result is null when the file does not exist.
function readEnvFile(name) {
  const path = resolve(name);
  if (!existsSync(path)) return null;
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values[match[1]] = stripQuotes(match[2]);
  }
  return values;
}

function stripQuotes(value) {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    return value.slice(1, -1);
  }
  return value;
}

// A value counts as cloud only when it parses as a URL with a host that is not local.
function isCloudUrl(value) {
  if (!value) return false;
  try {
    return !LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

// Run a command with the output on the terminal. Stop the script when the command fails.
// With hideStdout, the script drops the stdout of the command. Use it when the command prints keys.
function runStep(name, command, args, { hideStdout = false } = {}) {
  step(name);
  const stdio = hideStdout ? ["inherit", "ignore", "inherit"] : "inherit";
  const result = spawnSync(command, args, { stdio, shell: useShell });
  const code = result.error ? 1 : result.status;
  if (code !== 0) {
    console.error(`Step failed: ${name}`);
    process.exit(code ?? 1);
  }
}

function startDevServer() {
  step("Start the dev server");
  const child = spawn("npx", ["astro", "dev"], { stdio: "inherit", shell: useShell });
  // Ctrl+C goes to the dev server too, because it shares the process group. This script waits for its exit code.
  process.on("SIGINT", () => {
    // Ignore the signal here. The dev server gets it and stops.
  });
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.on("error", (error) => {
    console.error(`Cannot start the dev server: ${error.message}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    process.exit(code ?? (signal === "SIGINT" ? 130 : 1));
  });
}

const envFiles = Object.fromEntries(ENV_FILES.map((name) => [name, readEnvFile(name)]));
const cloudFile = ENV_FILES.find((name) => isCloudUrl(envFiles[name]?.SUPABASE_URL));

if (cloudFile) {
  console.log(`The app uses the cloud Supabase project from ${cloudFile}. The script skips the local database.`);
  const [first, second] = ENV_FILES;
  // The build reads .env and the dev runtime reads .dev.vars. Two different URLs give two different databases.
  if (envFiles[first] && envFiles[second] && envFiles[first].SUPABASE_URL !== envFiles[second].SUPABASE_URL) {
    console.warn(
      `Warning: ${first} and ${second} have different SUPABASE_URL values. Use the same project in both files.`,
    );
  }
  if (envFiles[first] && !envFiles[second]) {
    copyFileSync(resolve(first), resolve(second));
    console.log(`Copied ${first} to ${second}.`);
  } else if (envFiles[second] && !envFiles[first]) {
    copyFileSync(resolve(second), resolve(first));
    console.log(`Copied ${second} to ${first}.`);
  }
} else {
  step("Check Docker");
  const docker = spawnSync("docker", ["info"], { stdio: "ignore", shell: useShell });
  if (docker.error || docker.status !== 0) {
    console.error("Docker is not running. Start Docker, then run npm start again.");
    process.exit(1);
  }

  const startArgs = ["supabase", "start"];
  if (exclude) startArgs.push("-x", exclude);
  // supabase start prints all local keys on stdout. The progress and the errors go to stderr.
  runStep("Start local Supabase", "npx", startArgs, { hideStdout: true });
  runStep("Apply pending migrations", "npx", ["supabase", "migration", "up", "--local"]);

  // Read the local values into memory only. Do not print them.
  step("Read the local Supabase values");
  const status = spawnSync("npx", ["supabase", "status", "-o", "env"], {
    stdio: ["ignore", "pipe", "inherit"],
    shell: useShell,
    encoding: "utf8",
  });
  if (status.error || status.status !== 0) {
    console.error("Step failed: Read the local Supabase values");
    process.exit(status.status || 1);
  }
  const local = {};
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) local[match[1]] = stripQuotes(match[2]);
  }
  if (!local.API_URL || !local.ANON_KEY) {
    console.error("Step failed: Read the local Supabase values. The output has no API_URL or ANON_KEY.");
    process.exit(1);
  }

  step("Write the env files");
  // The anon key and the publishable key both work with the local stack.
  const localKeys = new Set([local.ANON_KEY, local.PUBLISHABLE_KEY].filter(Boolean));
  const mismatched = [];
  for (const name of ENV_FILES) {
    const values = envFiles[name];
    if (!values) {
      writeFileSync(resolve(name), `SUPABASE_URL=${local.API_URL}\nSUPABASE_KEY=${local.ANON_KEY}\n`);
      console.log(`Wrote ${name}.`);
    } else if (values.SUPABASE_URL !== local.API_URL || !localKeys.has(values.SUPABASE_KEY)) {
      mismatched.push(name);
    } else {
      console.log(`Kept ${name}.`);
    }
  }
  // Stop here. A dev server with values that do not match cannot sign in, and the script never changes the file.
  if (mismatched.length > 0) {
    for (const name of mismatched) {
      console.error(`${name} does not match the local Supabase stack. Delete ${name}, then run npm start again.`);
    }
    process.exit(1);
  }
}

if (setupOnly) {
  console.log("\nSetup is complete.");
} else {
  startDevServer();
}
