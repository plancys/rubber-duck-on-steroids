// Local worker: starts the worker process with the values of the local Supabase stack.
// Zero dependencies on purpose. Run with npm run worker, or with: node scripts/worker.mjs
// The script reads the service key into memory only. It never prints the key and never writes it to a file.
// To use another Supabase project, set SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const useShell = process.platform === "win32";
const env = { ...process.env };

// The worker has its own packages in worker/node_modules. npm install in the repo root installs them.
if (!existsSync(resolve(root, "worker", "node_modules"))) {
  console.error("The worker packages are missing. Run npm install in the repo root, then run npm run worker.");
  process.exit(1);
}

function stripQuotes(value) {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
    return value.slice(1, -1);
  }
  return value;
}

if (!env.SUPABASE_SERVICE_KEY) {
  // Read the local values into memory only. Do not print them.
  const status = spawnSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
    shell: useShell,
    encoding: "utf8",
  });
  if (status.error || status.status !== 0) {
    console.error(
      "Cannot read the local Supabase values. Start the local stack with npm start, then run npm run worker.",
    );
    process.exit(status.status || 1);
  }
  const local = {};
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) local[match[1]] = stripQuotes(match[2]);
  }
  if (!local.API_URL || !local.SERVICE_ROLE_KEY) {
    console.error("Cannot read the local Supabase values. The output has no API_URL or SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  // The URL and the key must come from the same stack, so the script sets both.
  env.SUPABASE_URL = local.API_URL;
  env.SUPABASE_SERVICE_KEY = local.SERVICE_ROLE_KEY;
  console.log("The worker uses the local Supabase stack.");
}

// The web app uses the same local secret for its wake request.
env.WORKER_WAKE_SECRET ??= "local-wake-secret";
// A local worker also looks for jobs every 5 seconds, so a lost wake request does not leave a job waiting.
env.WORKER_POLL_SECONDS ??= "5";
// A local worker and the CI worker run the demo job of the check page.
env.WORKER_ALLOW_DEMO ??= "true";
// The local engine of npm run engine listens on this address with this secret. scripts/try-topics.mjs uses the same values.
// Without a running engine, a topic job fails with a safe reason after its 3 starts.
env.TOPIC_ENGINE_URL ??= "http://127.0.0.1:8790";
env.TOPIC_ENGINE_SECRET ??= "local-engine-secret";

// Start the worker with the same Node binary that runs this script.
const child = spawn(process.execPath, ["worker/main.ts"], { cwd: root, env, stdio: "inherit" });
// Ctrl+C goes to the worker too, because it shares the process group. The worker releases its job and stops.
process.on("SIGINT", () => {
  // Ignore the signal here. The worker gets it and stops.
});
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("error", (error) => {
  console.error(`Cannot start the worker: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal === "SIGINT" ? 130 : 1));
});
