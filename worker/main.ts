// The worker process. It takes jobs from the jobs table one at a time and runs the handler of each job type.
// Zero dependencies on purpose. It runs the same way on a laptop, in CI and in a container: node main.ts
// The web app sends POST /wake after it inserts a job. GET /health shows that the process runs.
// The service key and the wake secret stay in memory. The worker never writes them to the log.

import { createServer, type ServerResponse } from "node:http";
import { handlers } from "./handlers/index.ts";
import { createQueue } from "./queue.ts";
import { isWakeAuthorized } from "./rules.ts";
import { createRunner } from "./run.ts";

const DEFAULT_PORT = 8788;

// Write one JSON line to stdout.
function writeLog(line: object): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

// Stop with a clear message. The message names the setting, never its value.
function exitWith(message: string): never {
  process.stderr.write(`The worker cannot start. ${message}\n`);
  process.exit(1);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) exitWith(`Set the environment variable ${name}.`);
  return value;
}

function readPort(): number {
  const value = process.env.PORT;
  if (!value) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) exitWith("PORT must be a port number.");
  return port;
}

// The interval of the extra job search, or null when WORKER_POLL_SECONDS is not set.
function readPollSeconds(): number | null {
  const value = process.env.WORKER_POLL_SECONDS;
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) exitWith("WORKER_POLL_SECONDS must be a number of seconds above 0.");
  return seconds;
}

const supabaseUrl = required("SUPABASE_URL");
const serviceKey = required("SUPABASE_SERVICE_KEY");
const wakeSecret = required("WORKER_WAKE_SECRET");
if (!URL.canParse(supabaseUrl)) exitWith("SUPABASE_URL must be a URL.");
const port = readPort();
const pollSeconds = readPollSeconds();

const runner = createRunner({ queue: createQueue({ url: supabaseUrl, key: serviceKey }), handlers, log: writeLog });

function reply(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

const server = createServer((request, response) => {
  // The worker reads no request body.
  request.resume();
  const path = (request.url ?? "/").split("?")[0];
  if (request.method === "GET" && path === "/health") {
    reply(response, 200, "ok");
  } else if (request.method === "POST" && path === "/wake") {
    if (!isWakeAuthorized(request.headers.authorization, wakeSecret)) {
      reply(response, 401, "unauthorized");
      return;
    }
    // Reply first, then start the loop. A loop that runs already looks for jobs again before it ends.
    reply(response, 202, "accepted");
    void runner.wake();
  } else {
    reply(response, 404, "not found");
  }
});

server.on("error", (error) => {
  exitWith(`It cannot listen on port ${port}: ${error.message}`);
});

server.listen(port, () => {
  writeLog({ event: "listening", port });
  // Look for jobs once at the start. A job can wait from a time when no worker ran.
  void runner.wake();
});

// The extra job search for a machine that gets no wake request. Cloud Run does not set WORKER_POLL_SECONDS.
const poll =
  pollSeconds === null
    ? null
    : setInterval(() => {
        void runner.wake();
      }, pollSeconds * 1_000);

let stopping = false;

// On SIGTERM or Ctrl+C: take no new job, release the current job with release_job, then stop.
// Cloud Run gives the process about 10 seconds after SIGTERM.
function shutdown(signal: NodeJS.Signals): void {
  // A second signal changes nothing. The first one already releases the job.
  if (stopping) return;
  stopping = true;
  writeLog({ event: "stopping", signal });
  if (poll) clearInterval(poll);
  server.close();
  void runner.stop().finally(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
