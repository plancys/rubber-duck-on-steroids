// Production setup: does each provider step that a script can do safely, in a fixed order.
// Step 5d (scripts/setup-google.mjs) sets up the background worker in Google Cloud. It needs the gcloud CLI.
// Zero dependencies on purpose. Run with: SUPABASE_ACCESS_TOKEN=<token> npm run setup:prod
// The script is safe to run again. Each step reads the current state first and asks before it changes a value.
// A human runs this script. It never writes a file, and it never prints a key, token or password,
// except the generated database password, which it prints once.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { setUpGoogle } from "./setup-google.mjs";

const USAGE = `Usage: SUPABASE_ACCESS_TOKEN=<token> node scripts/setup-prod.mjs [--help]

Sets up the production Supabase project, the background worker in Google Cloud,
the GitHub "production" environment, and the Supabase auth settings. The README section "Deployment > One-time setup" has the full manual.`;

const SUPABASE_API = "https://api.supabase.com";
const ENVIRONMENT = "production";
const DEFAULT_REGION = "eu-central-1";
// The Supabase limit for auth emails per hour. It matches [auth.rate_limit] email_sent in supabase/config.toml.
const EMAIL_RATE_LIMIT_PER_HOUR = 30;
const HOOK_PATH = "/api/hooks/send-email";
const WAIT_STEP_MS = 10_000;
const WAIT_LIMIT_MS = 10 * 60_000;
const SECRET_NAMES = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_ACCOUNT_ID",
  "SUPABASE_URL",
  "SUPABASE_KEY",
  "SUPABASE_DB_URL",
  "RESEND_API_KEY",
  "SEND_EMAIL_HOOK_SECRET",
  "GCP_WORKLOAD_IDENTITY_PROVIDER",
  "GCP_SERVICE_ACCOUNT",
  "WORKER_WAKE_SECRET",
];
const VARIABLE_NAMES = [
  "SUPABASE_PROJECT_REF",
  "PRODUCTION_URL",
  "EMAIL_FROM",
  "ADMIN_EMAIL",
  "OAUTH_PROVIDERS",
  "GCP_PROJECT_ID",
  "GCP_REGION",
  "WORKER_WAKE_URL",
];
// The OAuth providers that the app knows. The ids match src/lib/oauth.ts and the Supabase auth config fields.
const OAUTH_PROVIDERS = [
  { id: "github", label: "GitHub" },
  { id: "google", label: "Google" },
];
// The app route that finishes the OAuth flow. The "**" lets the "next" query follow the path.
const OAUTH_CALLBACK_PATTERN = "/auth/callback**";
const useShell = process.platform === "win32";

for (const arg of process.argv.slice(2)) {
  if (arg === "--help" || arg === "-h") {
    console.log(USAGE);
    process.exit(0);
  }
  console.error(`Unknown argument: ${arg}`);
  console.error(USAGE);
  process.exit(2);
}

// A step stops with this error. The main block prints the summary, then exits 1.
class StepError extends Error {}

const results = [];
const openSteps = [];

function step(message) {
  console.log(`\n> ${message}`);
}

function record(name, outcome, note = "") {
  results.push({ name, outcome, note });
}

// ---------- Prompts ----------

// A normal prompt with echo. Ctrl+C stops the run at once.
async function ask(question, fallback = "") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    process.stdout.write("\n");
    process.exit(130);
  });
  const suffix = fallback ? ` [${fallback}]` : "";
  try {
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

// A yes or no prompt. An empty answer gives the default.
async function confirm(question, defaultYes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    process.stdout.write("\n");
    process.exit(130);
  });
  try {
    const answer = (await rl.question(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

// A prompt for a secret. The terminal does not show the characters. Ctrl+C stops the run at once.
function askHidden(question) {
  return new Promise((resolveAnswer) => {
    const stdin = process.stdin;
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          process.exit(130);
        } else if (char === "\r" || char === "\n" || char === "\u0004") {
          cleanup();
          resolveAnswer(value.trim());
          return;
        } else if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else if (char >= " ") {
          value += char;
        }
      }
    };
    process.stdout.write(`${question} (hidden): `);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

// ---------- Commands ----------

// Run a command and return its result. The value in "input" goes to stdin, never to the command line.
// On Windows, npx and gcloud are .cmd files that need a shell. The shell then gets each argument in quotes.
function run(command, args, { input } = {}) {
  const shell = (command === "npx" || command === "gcloud") && useShell;
  const shellArgs = shell ? args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`) : args;
  const result = spawnSync(command, shellArgs, {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    shell,
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    missing: result.error?.code === "ENOENT",
  };
}

function parseJson(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

// ---------- Supabase Management API ----------

// Returns only the message field of an error body. A full body can echo request fields, such as the hook secret.
function errorMessage(text) {
  try {
    const body = JSON.parse(text);
    const message = body?.message ?? body?.error;
    if (typeof message === "string") return message.slice(0, 200);
  } catch {
    // The body is not JSON.
  }
  return "no error message";
}

// The access token stays in this header only. The script never prints it and never passes it to a command.
async function supabaseApi(method, path, body, { allowFail = false } = {}) {
  const response = await fetch(`${SUPABASE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN ?? ""}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    if (allowFail) return null;
    throw new StepError(`Supabase API ${method} ${path} returned HTTP ${response.status}: ${errorMessage(text)}`);
  }
  return text ? JSON.parse(text) : {};
}

// ---------- GitHub ----------

function gh(args, options) {
  return run("gh", args, options);
}

function ghApi(args, options) {
  const result = gh(["api", ...args], options);
  return { ...result, notFound: /HTTP 404|Not Found/i.test(result.stderr) };
}

function listNames(args) {
  const result = gh(args);
  if (!result.ok) return null;
  return parseJson(result.stdout) ?? [];
}

// ---------- Step 1: prerequisites ----------

function readWorkerName() {
  const text = readFileSync(resolve("wrangler.jsonc"), "utf8");
  const match = /"name"\s*:\s*"([^"]+)"/.exec(text);
  return match ? match[1] : null;
}

function checkPrerequisites() {
  step("Step 1: Check the prerequisites");
  const gaps = [];

  // The cheap check first. It needs no network.
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    gaps.push(
      "SUPABASE_ACCESS_TOKEN is not set. Create a token at https://supabase.com/dashboard/account/tokens " +
        "and set it for this run only: SUPABASE_ACCESS_TOKEN=<token> npm run setup:prod",
    );
  }

  let repo = null;
  const auth = gh(["auth", "status"]);
  if (auth.missing) {
    gaps.push("The GitHub CLI (gh) is not installed. Install it from https://cli.github.com/.");
  } else if (!auth.ok) {
    gaps.push("The GitHub CLI is not logged in. Run: gh auth login");
  } else {
    const view = gh(["repo", "view", "--json", "nameWithOwner"]);
    repo = view.ok ? parseJson(view.stdout)?.nameWithOwner : null;
    if (!repo) gaps.push("The GitHub CLI cannot find the repository. Run the script in the repository folder.");
  }

  let accounts = [];
  const whoami = run("npx", ["wrangler", "whoami", "--json"]);
  const user = whoami.ok ? parseJson(whoami.stdout) : null;
  if (user?.loggedIn && Array.isArray(user.accounts) && user.accounts.length > 0) {
    accounts = user.accounts;
  } else {
    gaps.push("Wrangler is not logged in to Cloudflare. Run: npx wrangler login");
  }

  const workerName = readWorkerName();
  if (!workerName) gaps.push('wrangler.jsonc has no "name" value.');

  if (!process.stdin.isTTY) gaps.push("The script asks questions. Run it in a terminal.");

  if (gaps.length > 0) {
    console.error("The script cannot start. Fix these items, then run it again:");
    for (const gap of gaps) console.error(`- ${gap}`);
    process.exit(1);
  }

  console.log(`Repository: ${repo}`);
  console.log(`Worker name: ${workerName}`);
  record("Prerequisites", "done");
  return { repo, accounts, workerName };
}

// Read the GitHub state. Reads only. A missing environment gives empty lists.
function readGitHubState(repo) {
  const environment = ghApi([`repos/${repo}/environments/${ENVIRONMENT}`]);
  if (!environment.ok && !environment.notFound) {
    throw new StepError(`Cannot read the GitHub environment "${ENVIRONMENT}": ${environment.stderr.trim()}`);
  }
  const exists = environment.ok;
  const secrets = exists ? listNames(["secret", "list", "--env", ENVIRONMENT, "--repo", repo, "--json", "name"]) : [];
  const variables = exists
    ? listNames(["variable", "list", "--env", ENVIRONMENT, "--repo", repo, "--json", "name,value"])
    : [];
  const repoSecrets = listNames(["secret", "list", "--repo", repo, "--json", "name"]);
  if (secrets === null || variables === null || repoSecrets === null) {
    throw new StepError("Cannot list the GitHub secrets and variables. Check the gh login scopes.");
  }
  return {
    environment: exists ? parseJson(environment.stdout) : null,
    secretNames: new Set(secrets.map((item) => item.name)),
    variables: new Map(variables.map((item) => [item.name, item.value])),
    repoSecretNames: new Set(repoSecrets.map((item) => item.name)),
  };
}

// ---------- Main flow ----------

const prerequisites = checkPrerequisites();
const { repo, accounts, workerName } = prerequisites;

// The values for GitHub. A value of undefined means: keep the current value.
const secrets = {};
const variables = {};
// The names that the user already answered "Replace?" for. Step 6 does not ask again.
const decided = new Map();
let github;

// True when the secret is missing, or when the user wants to replace it.
async function wantSecret(name) {
  if (decided.has(name)) return decided.get(name);
  const wanted = !github.secretNames.has(name) || (await confirm(`Replace ${name}?`, false));
  decided.set(name, wanted);
  return wanted;
}

async function chooseOne(label, items, describe) {
  if (items.length === 1) return items[0];
  console.log(`${label}:`);
  items.forEach((item, index) => console.log(`  ${index + 1}. ${describe(item)}`));
  for (;;) {
    const answer = Number(await ask(`Number of the ${label.toLowerCase()}`, "1"));
    if (Number.isInteger(answer) && answer >= 1 && answer <= items.length) return items[answer - 1];
    console.log(`Type a number from 1 to ${items.length}.`);
  }
}

function projectRef(project) {
  return project.ref ?? project.id;
}

async function waitForProject(ref) {
  const start = Date.now();
  let last = "";
  for (;;) {
    const project = await supabaseApi("GET", `/v1/projects/${ref}`);
    if (project.status === "ACTIVE_HEALTHY") return;
    if (project.status === "INACTIVE") {
      throw new StepError(
        "The Supabase project is paused. Restore it in the Supabase dashboard, then run setup again.",
      );
    }
    if (project.status !== last) console.log(`Project status: ${project.status}. The script waits.`);
    last = project.status;
    if (Date.now() - start > WAIT_LIMIT_MS) {
      throw new StepError("The Supabase project is not ready after 10 minutes. Run setup again later.");
    }
    await sleep(WAIT_STEP_MS);
  }
}

// A local or empty Site URL means a fresh project. Supabase sets http://localhost:3000 for a new project.
function isLocalSiteUrl(siteUrl) {
  return !siteUrl || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(siteUrl);
}

// Stop before the script changes the project of another app. Two signs: the project is not the one that GitHub
// records, or its Site URL is the URL of another app. Each sign needs an explicit yes. The default is no.
async function checkProjectOwner(ref, knownRef) {
  if (knownRef && ref !== knownRef) {
    const switchProject = await confirm(
      `GitHub uses the Supabase project ${knownRef}. Move production to ${ref}? The app then uses other users and data.`,
      false,
    );
    if (!switchProject) throw new StepError(`Run setup again and select the project ${knownRef}.`);
  }
  const productionUrl = github.variables.get("PRODUCTION_URL");
  const config = await supabaseApi("GET", `/v1/projects/${ref}/config/auth`);
  const siteUrl = typeof config.site_url === "string" ? config.site_url.replace(/\/$/, "") : "";
  if (!isLocalSiteUrl(siteUrl) && productionUrl && siteUrl !== productionUrl) {
    console.log(`The project ${ref} has the Site URL ${siteUrl}. This app uses ${productionUrl}.`);
    console.log("The project can belong to another app. The next steps change its auth settings and its email hook.");
    const useIt = await confirm(`Use the project ${ref} for ${productionUrl}?`, false);
    if (!useIt) throw new StepError("Select the project of this app, or create a new one.");
  }
}

// Step 2: find or create the Supabase project. Returns the ref and, for a new project, the DB password.
async function setUpProject() {
  step("Step 2: Supabase project");
  const projects = await supabaseApi("GET", "/v1/projects");
  const organizations = await supabaseApi("GET", "/v1/organizations");
  if (projects.length === 0 && organizations.length === 0) {
    throw new StepError(
      "The access token sees no Supabase organization and no project. Create the token while you are logged in to the account that owns the project. Give it access to that organization.",
    );
  }

  // GitHub records the production project in SUPABASE_PROJECT_REF. A token from another account cannot see that
  // project, so the script stops before it changes a project of another app.
  const knownRef = github.variables.get("SUPABASE_PROJECT_REF") || null;
  if (knownRef && !projects.some((item) => projectRef(item) === knownRef)) {
    throw new StepError(
      `GitHub uses the Supabase project ${knownRef}, but the access token cannot see it. Create the token while you ` +
        `are logged in to the account that owns ${knownRef}.`,
    );
  }

  // The production project comes first, then a project with the Worker name. Any other project is also a choice,
  // so the script never makes a second project by mistake.
  const rank = (item) => (projectRef(item) === knownRef ? 2 : item.name === workerName ? 1 : 0);
  const sorted = [...projects].sort((a, b) => rank(b) - rank(a));
  const CREATE = { create: true };
  const choices = [...sorted, CREATE];
  const choice =
    sorted.length === 0
      ? CREATE
      : await chooseOne("Supabase project", choices, (item) =>
          item === CREATE ? `Create a new project "${workerName}"` : `${item.name} (${projectRef(item)})`,
        );
  if (choice !== CREATE) {
    const ref = projectRef(choice);
    await waitForProject(ref);
    await checkProjectOwner(ref, knownRef);
    console.log(`Project ref: ${ref}`);
    variables.SUPABASE_PROJECT_REF = ref;
    record("Supabase project", "done", `reused ${ref}`);
    return { ref, password: null };
  }

  if (
    knownRef &&
    !(await confirm(`GitHub uses the Supabase project ${knownRef}. Create a new project anyway?`, false))
  ) {
    throw new StepError(`Run setup again and select the project ${knownRef}.`);
  }
  if (organizations.length === 0) throw new StepError("Your Supabase account has no organization. Create one first.");
  const organization = await chooseOne("Organization", organizations, (item) => `${item.name} (${item.id})`);
  const region = await ask("Region", DEFAULT_REGION);
  if (!(await confirm(`Create the project "${workerName}" in ${organization.name}, region ${region}?`, true))) {
    throw new StepError("The script needs a Supabase project. Run setup again to create one.");
  }
  // 24 random bytes give 32 base64url characters. The password needs no percent-encoding.
  const password = randomBytes(24).toString("base64url");
  const created = await supabaseApi("POST", "/v1/projects", {
    name: workerName,
    organization_id: organization.id,
    region,
    db_pass: password,
  });
  const ref = projectRef(created);
  console.log(`Project ref: ${ref}`);
  variables.SUPABASE_PROJECT_REF = ref;
  console.log(`Database password: ${password}`);
  console.log("Save this password in a password manager now. The script does not show it again.");
  openSteps.push("Save the database password in a password manager, if you did not do it yet.");
  await waitForProject(ref);
  record("Supabase project", "changed", `created ${ref}`);
  return { ref, password };
}

// Find the Session pooler host. Try the Management API first, then ask.
async function poolerHost(ref) {
  const pooler = await supabaseApi("GET", `/v1/projects/${ref}/config/database/pooler`, undefined, {
    allowFail: true,
  });
  const entries = Array.isArray(pooler) ? pooler : pooler ? [pooler] : [];
  for (const entry of entries) {
    if (typeof entry.db_host === "string" && entry.db_host.endsWith("pooler.supabase.com")) return entry.db_host;
    const found = /@([a-z0-9.-]+pooler\.supabase\.com)/.exec(String(entry.connection_string ?? ""));
    if (found) return found[1];
  }
  console.log(`Open https://supabase.com/dashboard/project/${ref}, select Connect, then Session pooler.`);
  console.log("Copy the host from the string.");
  console.log("Do not use the direct host db.<ref>.supabase.co. GitHub runners cannot reach it.");
  for (;;) {
    const host = await ask("Session pooler host, for example aws-0-eu-central-1.pooler.supabase.com");
    if (/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(host)) return host;
    console.log("The host must end with pooler.supabase.com.");
  }
}

// Step 3: the Supabase URL, the public key, and the DB URL.
async function readSupabaseValues(ref, password) {
  step("Step 3: Supabase keys and database URL");
  secrets.SUPABASE_URL = `https://${ref}.supabase.co`;

  const keys = await supabaseApi("GET", `/v1/projects/${ref}/api-keys?reveal=false`);
  // The app needs the public key. Never use the service_role key or a secret key.
  const isPublic = (key) =>
    typeof key.api_key === "string" &&
    key.api_key !== "" &&
    !/^sb_(?!publishable_)/.test(key.api_key) &&
    key.name !== "service_role" &&
    key.type !== "secret";
  const key =
    keys.find((item) => item.name === "anon" && isPublic(item)) ??
    keys.find((item) => item.type === "publishable" && isPublic(item));
  if (!key) throw new StepError("The project has no anon key and no publishable key.");
  secrets.SUPABASE_KEY = key.api_key;
  console.log(`Found the ${key.name === "anon" ? "anon" : "publishable"} key.`);

  let dbPassword = password;
  if (!dbPassword) {
    if (!(await wantSecret("SUPABASE_DB_URL"))) {
      record("Supabase keys and DB URL", "done", "kept SUPABASE_DB_URL");
      return;
    }
    dbPassword = await askHidden("Database password of the project");
    if (!dbPassword) {
      record("Supabase keys and DB URL", "skipped", "no database password");
      openSteps.push("Set SUPABASE_DB_URL: run setup again and type the database password.");
      return;
    }
  }
  const host = await poolerHost(ref);
  secrets.SUPABASE_DB_URL = `postgresql://postgres.${ref}:${encodeURIComponent(dbPassword)}@${host}:5432/postgres`;
  record("Supabase keys and DB URL", "done");
}

// Step 4: the Cloudflare account, PRODUCTION_URL, and the API token.
async function readCloudflareValues() {
  step("Step 4: Cloudflare");
  const account = await chooseOne("Cloudflare account", accounts, (item) => `${item.name} (${item.id})`);
  secrets.CLOUDFLARE_ACCOUNT_ID = account.id;

  const current = github.variables.get("PRODUCTION_URL") ?? "";
  const known = new RegExp(`^https://${workerName}\\.([a-z0-9-]+)\\.workers\\.dev/?$`).exec(current);
  console.log("Find the subdomain at https://dash.cloudflare.com: Workers & Pages, then the account subdomain.");
  let subdomain = "";
  while (!/^[a-z0-9-]+$/.test(subdomain)) {
    subdomain = (await ask("The workers.dev subdomain of the account", known ? known[1] : "")).toLowerCase();
  }
  variables.PRODUCTION_URL = `https://${workerName}.${subdomain}.workers.dev`;
  console.log(`PRODUCTION_URL: ${variables.PRODUCTION_URL}`);

  if (await wantSecret("CLOUDFLARE_API_TOKEN")) {
    console.log("Create the token by hand. A script would need a token that can create tokens.");
    console.log("1. Open https://dash.cloudflare.com/profile/api-tokens, then select Create Token.");
    console.log("2. Use the template Edit Cloudflare Workers.");
    console.log("3. Under Account Resources, select only your account. Select no zones.");
    console.log("4. Do not give the token DNS or billing access.");
    const token = await askHidden("Cloudflare API token (empty to skip)");
    if (token) {
      secrets.CLOUDFLARE_API_TOKEN = token;
    } else {
      openSteps.push("Set CLOUDFLARE_API_TOKEN: run setup again and paste the token. The deploy skips without it.");
    }
  }
  record(
    "Cloudflare",
    secrets.CLOUDFLARE_API_TOKEN || decided.get("CLOUDFLARE_API_TOKEN") === false ? "done" : "skipped",
  );
}

// Step 5: the Resend values and the Send Email Hook secret. Returns true when the hook secret is new.
async function readEmailValues() {
  step("Step 5: Resend");
  console.log("Add and verify the domain at https://resend.com/domains.");
  console.log("Use an address on the domain that Resend verified, for example no-reply@example.com.");
  const from = await ask("EMAIL_FROM (empty to skip)", github.variables.get("EMAIL_FROM") ?? "");
  if (from && !from.includes("@")) throw new StepError("EMAIL_FROM must be an email address.");
  if (from) variables.EMAIL_FROM = from;
  const admin = await ask("ADMIN_EMAIL for the quota alert (empty to skip)", github.variables.get("ADMIN_EMAIL") ?? "");
  if (admin && !admin.includes("@")) throw new StepError("ADMIN_EMAIL must be an email address.");
  if (admin) variables.ADMIN_EMAIL = admin;

  if (await wantSecret("RESEND_API_KEY")) {
    console.log("Create a Resend API key at https://resend.com/api-keys with the permission Sending access only.");
    const key = await askHidden("Resend API key (empty to skip)");
    if (key) {
      secrets.RESEND_API_KEY = key;
    } else {
      openSteps.push("Set RESEND_API_KEY: run setup again and paste the key. The hook cannot send email without it.");
    }
  }

  let hookSecretIsNew = false;
  if (await wantSecret("SEND_EMAIL_HOOK_SECRET")) {
    // The Standard Webhooks format that Supabase uses: v1,whsec_ and base64 of 32 random bytes.
    secrets.SEND_EMAIL_HOOK_SECRET = `v1,whsec_${randomBytes(32).toString("base64")}`;
    hookSecretIsNew = true;
    console.log("Generated a new SEND_EMAIL_HOOK_SECRET.");
  }
  record("Resend", "done");
  return hookSecretIsNew;
}

// The Supabase service key for the worker: a secret key (sb_secret_...) first, else the service_role key.
// The value goes only to Google Secret Manager. Returns null when the API does not show the key.
async function readServiceKey(ref) {
  const keys = await supabaseApi("GET", `/v1/projects/${ref}/api-keys?reveal=true`, undefined, { allowFail: true });
  if (!Array.isArray(keys)) return null;
  // A hidden key has mask characters. Use only a full key.
  const isFull = (key) => typeof key.api_key === "string" && /^[A-Za-z0-9._-]{20,}$/.test(key.api_key);
  const key =
    keys.find((item) => item.type === "secret" && isFull(item) && item.api_key.startsWith("sb_secret_")) ??
    keys.find((item) => item.name === "service_role" && isFull(item));
  return key ? key.api_key : null;
}

// Step 5d: the background worker in Google Cloud. A failure here does not stop the Supabase and GitHub steps.
async function setUpWorker(ref) {
  step("Step 5d: Google Cloud worker");
  console.log("Open https://console.cloud.google.com/billing to link billing, and set a budget alert.");
  console.log("Set the Anthropic spend limit at https://platform.claude.com/settings/spend-limits.");
  console.log("Create the key rubber-duck-worker at https://platform.claude.com/settings/keys.");
  const google = await setUpGoogle({
    gcloud: (args, options) => run("gcloud", args, options),
    ask,
    confirm,
    askHidden,
    log: (message) => console.log(message),
    wait: (ms) => sleep(ms),
    readServiceKey: () => readServiceKey(ref),
    repo,
    workerName,
    github,
  });
  Object.assign(secrets, google.secrets);
  Object.assign(variables, google.variables);
  openSteps.push(...google.openSteps);
  // The script made the wake secret, and Secret Manager holds it. GitHub gets it without a "Replace?" question.
  if (google.secrets.WORKER_WAKE_SECRET !== undefined) decided.set("WORKER_WAKE_SECRET", true);
  record("Google Cloud worker", google.outcome, google.note);
}

// Step 6: the GitHub environment, the secrets, and the variables.
async function writeGitHub() {
  step("Step 6: GitHub");
  console.log(`Environment settings: https://github.com/${repo}/settings/environments`);
  let changed = false;
  const base = `repos/${repo}/environments/${ENVIRONMENT}`;
  const policy = github.environment?.deployment_branch_policy;
  if (!github.environment || !policy?.custom_branch_policies) {
    const question = github.environment
      ? `The environment "${ENVIRONMENT}" has no custom branch rule. Allow only the branch main?`
      : `Create the environment "${ENVIRONMENT}" with the branch rule main?`;
    if (!(await confirm(question, true))) throw new StepError(`The deploy needs the "${ENVIRONMENT}" environment.`);
    const body = JSON.stringify({
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
    });
    const put = ghApi(["-X", "PUT", base, "--input", "-"], { input: body });
    if (!put.ok) throw new StepError(`Cannot create the environment: ${put.stderr.trim()}`);
    changed = true;
  }
  const policies = ghApi([`${base}/deployment-branch-policies`]);
  const names = policies.ok ? (parseJson(policies.stdout)?.branch_policies ?? []).map((item) => item.name) : [];
  if (!names.includes("main")) {
    const post = ghApi(["-X", "POST", `${base}/deployment-branch-policies`, "-f", "name=main", "-f", "type=branch"]);
    if (!post.ok) throw new StepError(`Cannot add the branch rule main: ${post.stderr.trim()}`);
    console.log("Added the branch rule main.");
    changed = true;
  }

  for (const name of SECRET_NAMES) {
    const value = secrets[name];
    if (value === undefined) continue;
    if (!(await wantSecret(name))) continue;
    // The value goes over stdin. It never shows on the command line.
    const result = gh(["secret", "set", name, "--env", ENVIRONMENT, "--repo", repo], { input: value });
    if (!result.ok) throw new StepError(`Cannot set the secret ${name}: ${result.stderr.trim()}`);
    console.log(`Set the secret ${name}.`);
    changed = true;
    if (github.repoSecretNames.has(name)) {
      console.log(
        `Note: a repository secret ${name} also exists. The deploy job uses the environment secret. ` +
          "The ci job uses the repository secret.",
      );
    }
  }

  for (const name of VARIABLE_NAMES) {
    const value = variables[name];
    if (value === undefined) continue;
    const current = github.variables.get(name);
    if (current === value) continue;
    // Step 5c computes OAUTH_PROVIDERS from the Supabase state, so yes is the default for it. A kept old list
    // shows a button for a provider that is off.
    // Step 2 confirms a new project, so yes is the default for SUPABASE_PROJECT_REF too.
    const replaceByDefault = name === "OAUTH_PROVIDERS" || name === "SUPABASE_PROJECT_REF";
    if (current !== undefined && !(await confirm(`Replace ${name} (${current} -> ${value})?`, replaceByDefault))) {
      continue;
    }
    const result = gh(["variable", "set", name, "--env", ENVIRONMENT, "--repo", repo, "--body", value]);
    if (!result.ok) throw new StepError(`Cannot set the variable ${name}: ${result.stderr.trim()}`);
    console.log(`Set the variable ${name}.`);
    changed = true;
  }
  record("GitHub", changed ? "changed" : "done");
}

// Show the fields that change and ask before the PATCH. Secret fields show as hidden.
async function patchAuth(ref, current, desired) {
  const changes = Object.entries(desired).filter(([field, value]) => current[field] !== value);
  if (changes.length === 0) return false;
  console.log("These auth settings change:");
  for (const [field, value] of changes) {
    const hidden = field.includes("secret");
    const before = hidden ? "(hidden)" : JSON.stringify(current[field]);
    const after = hidden ? "(hidden)" : JSON.stringify(value);
    console.log(`  ${field}: ${before} -> ${after}`);
  }
  if (!(await confirm("Apply these changes?", true))) return null;
  await supabaseApi("PATCH", `/v1/projects/${ref}/config/auth`, Object.fromEntries(changes));
  return true;
}

// Stop when the GET answer does not have a field that the script writes. The script never guesses a field name.
function requireFields(config, fields) {
  const missing = fields.filter((field) => !(field in config));
  if (missing.length > 0) {
    throw new StepError(
      `The Supabase auth config has no field ${missing.join(", ")}. Apply the "Production auth settings" ` +
        "from the README by hand.",
    );
  }
}

// Step 7: the Supabase auth settings. The email rate limit is not here. Step 8 sets it after the hook is on.
async function setAuthSettings(ref) {
  step("Step 7: Supabase auth settings");
  console.log(`URL settings: https://supabase.com/dashboard/project/${ref}/auth/url-configuration`);
  const config = await supabaseApi("GET", `/v1/projects/${ref}/config/auth`);
  const desired = {
    site_url: variables.PRODUCTION_URL,
    // The production URL, and the OAuth callback with any "next" query.
    uri_allow_list: `${variables.PRODUCTION_URL},${variables.PRODUCTION_URL}${OAUTH_CALLBACK_PATTERN}`,
    mailer_autoconfirm: false,
    password_min_length: 8,
  };
  requireFields(config, Object.keys(desired));
  const outcome = await patchAuth(ref, config, desired);
  record("Supabase auth settings", outcome ? "changed" : outcome === null ? "skipped" : "done");
}

// Before step 6: store a new hook secret in Supabase, with the hook off. Supabase then uses its own mailer.
// Supabase gets the secret before GitHub does. So a declined or failed write here stops the run before GitHub
// changes, and the two stores never hold different secrets when a later run turns the hook on.
async function storeHookSecret(ref) {
  step("Step 5b: Store the new hook secret in Supabase");
  const config = await supabaseApi("GET", `/v1/projects/${ref}/config/auth`);
  requireFields(config, ["hook_send_email_enabled", "hook_send_email_uri", "hook_send_email_secrets"]);
  const outcome = await patchAuth(ref, config, {
    hook_send_email_uri: `${variables.PRODUCTION_URL}${HOOK_PATH}`,
    hook_send_email_secrets: secrets.SEND_EMAIL_HOOK_SECRET,
    hook_send_email_enabled: false,
  });
  if (outcome === null) {
    throw new StepError("The new SEND_EMAIL_HOOK_SECRET must go to Supabase first. GitHub did not change.");
  }
  openSteps.push("If step 6 stops, run setup again and answer y to Replace SEND_EMAIL_HOOK_SECRET.");
}

// Before step 6: the GitHub and Google sign-in. Each provider is optional. The step writes the provider fields to
// Supabase first, so the GitHub variable OAUTH_PROVIDERS names only the providers that are on in Supabase.
async function setOAuthProviders(ref) {
  step("Step 5c: OAuth providers");
  const name = "OAuth providers";
  const fields = OAUTH_PROVIDERS.flatMap(({ id }) => [
    `external_${id}_enabled`,
    `external_${id}_client_id`,
    `external_${id}_secret`,
  ]);
  const config = await supabaseApi("GET", `/v1/projects/${ref}/config/auth`);
  requireFields(config, fields);

  console.log("Register one OAuth app at each provider that you want. The README section OAuth login has the steps.");
  console.log(`  Homepage URL: ${variables.PRODUCTION_URL}`);
  console.log(
    `  GitHub "Authorization callback URL" and Google "Authorized redirect URIs": https://${ref}.supabase.co/auth/v1/callback`,
  );
  console.log("  GitHub OAuth app: https://github.com/settings/developers, then New OAuth App");
  console.log("  Google OAuth client: https://console.cloud.google.com/apis/credentials, then Create credentials");
  console.log(`  Supabase providers: https://supabase.com/dashboard/project/${ref}/auth/providers`);

  const desired = {};
  for (const { id, label } of OAUTH_PROVIDERS) {
    const enabledField = `external_${id}_enabled`;
    const currentId = typeof config[`external_${id}_client_id`] === "string" ? config[`external_${id}_client_id`] : "";
    const isOn = config[enabledField] === true;
    if (isOn && !(await confirm(`Keep the ${label} sign-in on?`, true))) {
      desired[enabledField] = false;
      continue;
    }
    const clientId = await ask(`${label} client ID (empty to skip)`, currentId);
    if (!clientId) continue;
    // A new client ID needs its own secret. For the same client ID that is on, the secret stays unless you replace it.
    const needsSecret = !isOn || clientId !== currentId;
    if (needsSecret || (await confirm(`Replace the ${label} client secret?`, false))) {
      const secret = await askHidden(`${label} client secret (empty to skip)`);
      if (!secret) {
        if (needsSecret) {
          openSteps.push(`Set the ${label} sign-in: run setup again and paste the client secret.`);
          continue;
        }
      } else {
        desired[`external_${id}_secret`] = secret;
      }
    }
    desired[enabledField] = true;
    desired[`external_${id}_client_id`] = clientId;
  }

  const outcome = await patchAuth(ref, config, desired);
  // Without the PATCH, the providers keep their current state.
  const state = outcome ? { ...config, ...desired } : config;
  const active = OAUTH_PROVIDERS.filter(({ id }) => state[`external_${id}_enabled`] === true).map(({ id }) => id);
  if (active.length > 0) {
    variables.OAUTH_PROVIDERS = active.join(",");
    console.log(`OAUTH_PROVIDERS: ${variables.OAUTH_PROVIDERS}`);
  } else if (github.variables.get("OAUTH_PROVIDERS")) {
    openSteps.push(
      "No OAuth provider is on. Delete the GitHub variable OAUTH_PROVIDERS by hand, so the app shows no OAuth button.",
    );
  }
  record(name, outcome ? "changed" : outcome === null ? "skipped" : "done", active.join(",") || "none");
}

// Step 8: the Send Email Hook. The hook turns on only when the deployed route answers 401 to a call without a signature.
async function setEmailHook(ref, hookSecretIsNew) {
  step("Step 8: Send Email Hook");
  console.log(`Hooks page: https://supabase.com/dashboard/project/${ref}/auth/hooks`);
  const name = "Send Email Hook";
  const hookUri = `${variables.PRODUCTION_URL}${HOOK_PATH}`;
  const config = await supabaseApi("GET", `/v1/projects/${ref}/config/auth`);
  requireFields(config, [
    "hook_send_email_enabled",
    "hook_send_email_uri",
    "hook_send_email_secrets",
    "rate_limit_email_sent",
  ]);

  if (hookSecretIsNew) {
    // storeHookSecret wrote the new secret to Supabase before step 6. The deployed Worker does not have it yet.
    console.log("Run the deploy, then run setup again. The next run turns the hook on.");
    openSteps.push("Run the deploy, then run setup again to turn on the Send Email Hook and raise the email limit.");
    record(name, "changed", "secret stored, hook off until the deploy");
    return;
  }

  let status = "no answer";
  try {
    const response = await fetch(hookUri, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal: globalThis.AbortSignal.timeout(10_000),
    });
    status = `HTTP ${response.status}`;
  } catch {
    // The Worker is not deployed, or the network failed.
  }
  if (status !== "HTTP 401") {
    console.log(`The hook route answered: ${status}. Run the deploy, then run setup again.`);
    openSteps.push("Run the deploy, then run setup again to turn on the Send Email Hook and raise the email limit.");
    record(name, "skipped", `route answered ${status}`);
    return;
  }
  if (!config.hook_send_email_secrets) {
    throw new StepError("Supabase has no hook secret. Run setup again and answer y to Replace SEND_EMAIL_HOOK_SECRET.");
  }
  const outcome = await patchAuth(ref, config, { hook_send_email_uri: hookUri, hook_send_email_enabled: true });
  record(name, outcome ? "changed" : outcome === null ? "skipped" : "done");
  if (outcome !== null) await setEmailRateLimit(ref, config);
}

// Supabase checks this limit before it calls the Send Email Hook. Its default fits the built-in sender only.
// Supabase accepts a new value only when the hook is on or custom SMTP is set, so the limit comes after the hook,
// in its own PATCH. 30 an hour matches supabase/config.toml and keeps a burst far below the Resend Free limit of
// 100 a day.
async function setEmailRateLimit(ref, config) {
  const outcome = await patchAuth(ref, config, { rate_limit_email_sent: EMAIL_RATE_LIMIT_PER_HOUR });
  record("Email rate limit", outcome ? "changed" : outcome === null ? "skipped" : "done");
}

function printSummary() {
  step("Summary");
  for (const { name, outcome, note } of results) {
    console.log(`  ${name}: ${outcome}${note ? ` (${note})` : ""}`);
  }
  const manual = [
    ...openSteps,
    "Revoke the Supabase access token at https://supabase.com/dashboard/account/tokens when you do not need it.",
    "Check the Resend domain DNS records at https://resend.com/domains, if you did not do it yet.",
  ];
  console.log("\nManual steps that are still open:");
  for (const item of manual) console.log(`  - ${item}`);
}

try {
  github = readGitHubState(repo);
  const project = await setUpProject();
  await readSupabaseValues(project.ref, project.password);
  await readCloudflareValues();
  const hookSecretIsNew = await readEmailValues();
  if (hookSecretIsNew) await storeHookSecret(project.ref);
  await setOAuthProviders(project.ref);
  await setUpWorker(project.ref);
  await writeGitHub();
  await setAuthSettings(project.ref);
  await setEmailHook(project.ref, hookSecretIsNew);
  printSummary();
} catch (error) {
  // Print only the message. A network error has no secret in its message.
  console.error(`\nStopped: ${error instanceof Error ? error.message : String(error)}`);
  printSummary();
  process.exit(1);
}
