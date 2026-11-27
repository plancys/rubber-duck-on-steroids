import assert from "node:assert/strict";
import { describe, it } from "node:test";

// The tests need no log output and no real wait.
const quiet = () => undefined;
const noWait = () => Promise.resolve();
import {
  DEFAULT_TOPIC_MODEL,
  GOOGLE_SERVICES,
  WORKER_SECRETS,
  applyGoogleChanges,
  googleIds,
  hasBinding,
  planGoogleChanges,
  readGoogleState,
  setUpGoogle,
} from "./setup-google.mjs";

const ids = googleIds({
  projectId: "duck-prod",
  projectNumber: "123456789",
  repo: "owner/rubber-duck-on-steroids",
  workerName: "rubber-duck-on-steroids",
});
const compute = `serviceAccount:${ids.computeAccount}`;
const deploy = `serviceAccount:${ids.deployAccount}`;
const accessor = "roles/secretmanager.secretAccessor";

// The state of a project that has every resource of the README.
function completeState() {
  const secretPolicy = { bindings: [{ role: accessor, members: [compute] }] };
  return {
    projectPolicy: {
      bindings: [
        { role: "roles/run.builder", members: [compute] },
        { role: "roles/run.sourceDeveloper", members: [deploy] },
        { role: "roles/run.admin", members: [deploy] },
        { role: "roles/serviceusage.serviceUsageConsumer", members: [deploy] },
      ],
    },
    computePolicy: { bindings: [{ role: "roles/iam.serviceAccountUser", members: [deploy] }] },
    deployExists: true,
    deployPolicy: { bindings: [{ role: "roles/iam.workloadIdentityUser", members: [ids.principalSet] }] },
    pool: { state: "ACTIVE" },
    provider: { name: ids.providerName, attributeCondition: ids.condition, state: "ACTIVE" },
    secrets: Object.fromEntries(
      Object.values(WORKER_SECRETS).map((name) => [name, { exists: true, policy: secretPolicy }]),
    ),
    serviceUrl: "https://worker.example.run.app",
    engineUrl: "https://engine.example.run.app",
  };
}

function emptyState() {
  return {
    projectPolicy: { bindings: [] },
    computePolicy: {},
    deployExists: false,
    deployPolicy: null,
    pool: null,
    provider: null,
    secrets: Object.fromEntries(Object.values(WORKER_SECRETS).map((name) => [name, { exists: false, policy: null }])),
    serviceUrl: null,
    engineUrl: null,
  };
}

// A fake gcloud. "answers" maps the start of a command to its result. A command without an answer is not found.
function fakeGcloud(answers) {
  const calls = [];
  const gcloud = (args, options = {}) => {
    const command = args.join(" ");
    calls.push({ command, input: options.input });
    for (const [prefix, answer] of Object.entries(answers)) {
      if (command.startsWith(prefix)) {
        return { ok: true, stdout: typeof answer === "string" ? answer : JSON.stringify(answer), stderr: "" };
      }
    }
    return { ok: false, stdout: "", stderr: "ERROR: NOT_FOUND: Requested entity was not found." };
  };
  return { gcloud, calls };
}

describe("googleIds", () => {
  it("builds the names of the README", () => {
    assert.equal(ids.computeAccount, "123456789-compute@developer.gserviceaccount.com");
    assert.equal(ids.deployAccount, "github-deploy@duck-prod.iam.gserviceaccount.com");
    assert.equal(
      ids.providerName,
      "projects/123456789/locations/global/workloadIdentityPools/github/providers/rubber-duck-on-steroids",
    );
    assert.equal(
      ids.principalSet,
      "principalSet://iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/github/attribute.repository/owner/rubber-duck-on-steroids",
    );
    assert.equal(ids.condition, "assertion.repository == 'owner/rubber-duck-on-steroids'");
    assert.equal(ids.service, "rubber-duck-on-steroids-worker");
    assert.equal(ids.engineService, "rubber-duck-on-steroids-engine");
  });

  it("cuts a long provider ID to 32 characters", () => {
    const long = googleIds({ projectId: "p", projectNumber: "1", repo: "o/r", workerName: "a".repeat(40) });
    assert.equal(long.provider.length, 32);
  });
});

describe("hasBinding", () => {
  it("ignores a binding with a condition", () => {
    const policy = { bindings: [{ role: "roles/run.admin", members: [deploy], condition: { title: "t" } }] };
    assert.equal(hasBinding(policy, "roles/run.admin", deploy), false);
    assert.equal(hasBinding(null, "roles/run.admin", deploy), false);
  });
});

describe("planGoogleChanges", () => {
  it("plans no change for a complete project", () => {
    assert.deepEqual(planGoogleChanges(completeState(), ids, {}), []);
  });

  it("plans every step of the README for an empty project, in a safe order", () => {
    const values = { serviceKey: "sb_secret_x", wakeSecret: "wake", anthropicKey: "sk-ant-x", engineSecret: "engine" };
    const labels = planGoogleChanges(emptyState(), ids, values).map((change) => change.label);
    const index = (text) => labels.findIndex((label) => label.includes(text));
    assert.ok(index("Create the service account") < index(`${deploy} the role roles/run.admin`));
    assert.ok(index("Create the Workload Identity pool") < index("Create the provider"));
    assert.ok(index("Create the provider") < index("Let GitHub Actions"));
    for (const name of Object.values(WORKER_SECRETS)) {
      assert.ok(index(`Create the secret ${name}`) >= 0, name);
      assert.ok(index(`Create the secret ${name}`) < index(`Let the worker read the secret ${name}`));
    }
    // 1 builder role, 1 account, 3 deploy roles, 1 account user, pool, provider, sign-in, 4 secrets, 4 accessors.
    assert.equal(labels.length, 17);
  });

  it("creates the engine secret with its value over stdin only", () => {
    const state = completeState();
    state.secrets[WORKER_SECRETS.engineSecret] = { exists: false, policy: null };
    const changes = planGoogleChanges(state, ids, { engineSecret: "engine-value" });
    assert.deepEqual(
      changes.map((change) => change.label),
      ["Create the secret engine-secret", "Let the worker read the secret engine-secret"],
    );
    assert.equal(changes[0].input, "engine-value");
    assert.ok(!changes[0].args.some((arg) => arg.includes("engine-value")));
  });

  it("sends a secret value over stdin only", () => {
    const changes = planGoogleChanges(completeState(), ids, { anthropicKey: "sk-ant-secret" });
    assert.equal(changes.length, 1);
    assert.equal(changes[0].input, "sk-ant-secret");
    assert.deepEqual(changes[0].args.slice(0, 4), ["secrets", "versions", "add", WORKER_SECRETS.anthropicKey]);
    assert.ok(!changes[0].args.some((arg) => arg.includes("sk-ant-secret")));
  });

  it("fixes the provider condition of another repository", () => {
    const state = completeState();
    state.provider.attributeCondition = "assertion.repository == 'other/repo'";
    const changes = planGoogleChanges(state, ids, {});
    assert.equal(changes.length, 1);
    assert.ok(changes[0].args.includes("update-oidc"));
    assert.ok(changes[0].args.includes(`--attribute-condition=${ids.condition}`));
  });

  it("gives the worker access to a secret that exists without access", () => {
    const state = completeState();
    state.secrets[WORKER_SECRETS.wakeSecret].policy = { etag: "x" };
    const labels = planGoogleChanges(state, ids, {}).map((change) => change.label);
    assert.deepEqual(labels, [`Let the worker read the secret ${WORKER_SECRETS.wakeSecret}`]);
  });
});

describe("readGoogleState", () => {
  it("reads missing resources as absent", () => {
    const { gcloud } = fakeGcloud({
      "projects get-iam-policy": { bindings: [] },
      "iam service-accounts get-iam-policy 123456789-compute": {},
    });
    const state = readGoogleState(gcloud, ids, "europe-west3");
    assert.equal(state.deployExists, false);
    assert.equal(state.pool, null);
    assert.equal(state.provider, null);
    assert.equal(state.serviceUrl, null);
    assert.equal(state.engineUrl, null);
    assert.equal(state.secrets[WORKER_SECRETS.anthropicKey].exists, false);
    assert.equal(state.secrets[WORKER_SECRETS.engineSecret].exists, false);
  });

  it("reads the address of the worker and of the engine", () => {
    const { gcloud, calls } = fakeGcloud({
      "projects get-iam-policy": { bindings: [] },
      "iam service-accounts get-iam-policy 123456789-compute": {},
      [`secrets get-iam-policy ${WORKER_SECRETS.engineSecret}`]: { bindings: [] },
      "run services describe rubber-duck-on-steroids-worker": { status: { url: "https://worker.example.run.app" } },
      "run services describe rubber-duck-on-steroids-engine": { status: { url: "https://engine.example.run.app" } },
    });
    const state = readGoogleState(gcloud, ids, "europe-west3");
    assert.equal(state.serviceUrl, "https://worker.example.run.app");
    assert.equal(state.engineUrl, "https://engine.example.run.app");
    assert.equal(state.secrets[WORKER_SECRETS.engineSecret].exists, true);
    assert.ok(calls.some((call) => call.command.includes("rubber-duck-on-steroids-engine --region=europe-west3")));
  });

  it("stops when the default compute account does not exist", () => {
    const { gcloud } = fakeGcloud({ "projects get-iam-policy": { bindings: [] } });
    assert.throws(() => readGoogleState(gcloud, ids, "europe-west3"), /compute\.googleapis\.com/);
  });

  it("stops on an error that is not 'not found'", () => {
    const gcloud = () => ({ ok: false, stdout: "", stderr: "ERROR: PERMISSION_DENIED: no access" });
    assert.throws(() => readGoogleState(gcloud, ids, "europe-west3"), /PERMISSION_DENIED/);
  });
});

describe("applyGoogleChanges", () => {
  it("tries a binding again while a new account is not visible", async () => {
    let attempts = 0;
    const gcloud = () => {
      attempts += 1;
      return attempts < 3
        ? { ok: false, stdout: "", stderr: "ERROR: Service account does not exist." }
        : { ok: true, stdout: "", stderr: "" };
    };
    const done = await applyGoogleChanges(gcloud, [{ label: "bind", args: ["x"] }], {
      log: quiet,
      wait: noWait,
    });
    assert.equal(attempts, 3);
    assert.equal(done.length, 1);
  });

  it("stops at the first failure and names the changes that are done", async () => {
    const gcloud = (args) =>
      args[0] === "b"
        ? { ok: false, stdout: "", stderr: "ERROR: PERMISSION_DENIED" }
        : { ok: true, stdout: "", stderr: "" };
    const changes = [
      { label: "a", args: ["a"] },
      { label: "b", args: ["b"] },
      { label: "c", args: ["c"] },
    ];
    await assert.rejects(
      applyGoogleChanges(gcloud, changes, { log: quiet, wait: noWait }),
      (error) => error.done.length === 1 && error.done[0].label === "a",
    );
  });
});

describe("setUpGoogle", () => {
  const github = { variables: new Map(), secretNames: new Set() };
  const base = {
    ask: async (_question, fallback) => fallback,
    confirm: async (_question, defaultYes) => defaultYes,
    askHidden: async () => "sk-ant-test",
    log: quiet,
    wait: noWait,
    readServiceKey: async () => "sb_secret_test",
    repo: "owner/rubber-duck-on-steroids",
    workerName: "rubber-duck-on-steroids",
    github,
  };

  it("skips with an open step when gcloud is not installed", async () => {
    const gcloud = () => ({ ok: false, stdout: "", stderr: "", missing: true });
    const result = await setUpGoogle({ ...base, gcloud });
    assert.equal(result.outcome, "skipped");
    assert.match(result.openSteps[0], /install gcloud/);
  });

  it("sets up an empty project and returns the GitHub values", async () => {
    const { gcloud, calls } = fakeGcloud({
      "auth list": "me@example.com\n",
      "config get-value project": "duck-prod\n",
      "projects describe duck-prod": { projectNumber: "123456789", lifecycleState: "ACTIVE" },
      "billing projects describe": { billingEnabled: true },
      "services list": GOOGLE_SERVICES.map((name) => ({ config: { name } })),
      "projects get-iam-policy": { bindings: [] },
      "iam service-accounts get-iam-policy 123456789-compute": {},
      "projects add-iam-policy-binding": "",
      "iam service-accounts create": "",
      "iam service-accounts add-iam-policy-binding": "",
      "iam workload-identity-pools create": "",
      "iam workload-identity-pools providers create-oidc": "",
      "secrets create": "",
      "secrets add-iam-policy-binding": "",
    });
    const result = await setUpGoogle({ ...base, gcloud });
    assert.equal(result.outcome, "changed");
    assert.equal(result.secrets.GCP_SERVICE_ACCOUNT, ids.deployAccount);
    assert.equal(result.secrets.GCP_WORKLOAD_IDENTITY_PROVIDER, ids.providerName);
    assert.match(result.secrets.WORKER_WAKE_SECRET, /^[0-9a-f]{64}$/);
    assert.deepEqual(result.variables, {
      GCP_PROJECT_ID: "duck-prod",
      GCP_REGION: "europe-west3",
      TOPIC_MODEL: DEFAULT_TOPIC_MODEL,
    });
    assert.ok(result.openSteps.some((item) => item.includes("WORKER_WAKE_URL")));
    assert.ok(result.openSteps.some((item) => item.includes("TOPIC_ENGINE_URL")));
    // The wake secret in Secret Manager is the value that goes to GitHub.
    const wakeCall = calls.find((call) => call.command.startsWith(`secrets create ${WORKER_SECRETS.wakeSecret}`));
    assert.equal(wakeCall.input, result.secrets.WORKER_WAKE_SECRET);
    // The engine secret is a new random value. It goes only to Secret Manager, not to GitHub.
    const engineCall = calls.find((call) => call.command.startsWith(`secrets create ${WORKER_SECRETS.engineSecret}`));
    assert.match(engineCall.input, /^[0-9a-f]{64}$/);
    assert.notEqual(engineCall.input, result.secrets.WORKER_WAKE_SECRET);
    assert.ok(!Object.values(result.secrets).includes(engineCall.input));
    // No secret value is on a command line.
    for (const call of calls) {
      assert.ok(!call.command.includes("sk-ant-test") && !call.command.includes("sb_secret_test"), call.command);
      assert.ok(!call.command.includes(engineCall.input), call.command);
    }
  });

  it("keeps the engine secret and returns the engine address and the model of a complete project", async () => {
    const complete = completeState();
    const { gcloud, calls } = fakeGcloud({
      "auth list": "me@example.com\n",
      "config get-value project": "duck-prod\n",
      "projects describe duck-prod": { projectNumber: "123456789", lifecycleState: "ACTIVE" },
      "billing projects describe": { billingEnabled: true },
      "services list": GOOGLE_SERVICES.map((name) => ({ config: { name } })),
      "projects get-iam-policy": complete.projectPolicy,
      "iam service-accounts get-iam-policy 123456789-compute": complete.computePolicy,
      "iam service-accounts describe": {},
      "iam service-accounts get-iam-policy github-deploy": complete.deployPolicy,
      "iam workload-identity-pools describe": { state: "ACTIVE" },
      "iam workload-identity-pools providers describe": complete.provider,
      "secrets get-iam-policy": { bindings: [{ role: accessor, members: [compute] }] },
      "run services describe rubber-duck-on-steroids-worker": { status: { url: complete.serviceUrl } },
      "run services describe rubber-duck-on-steroids-engine": { status: { url: complete.engineUrl } },
    });
    const result = await setUpGoogle({
      ...base,
      gcloud,
      github: {
        variables: new Map([["TOPIC_MODEL", "anthropic/claude-sonnet-5-5"]]),
        secretNames: new Set(["WORKER_WAKE_SECRET"]),
      },
    });
    assert.equal(result.outcome, "done");
    assert.equal(result.variables.TOPIC_ENGINE_URL, "https://engine.example.run.app");
    assert.equal(result.variables.WORKER_WAKE_URL, "https://worker.example.run.app/wake");
    // The prompt offers the model of GitHub, so a run with no new answer keeps it.
    assert.equal(result.variables.TOPIC_MODEL, "anthropic/claude-sonnet-5-5");
    assert.ok(!result.openSteps.some((item) => item.includes("TOPIC_ENGINE_URL")));
    assert.ok(
      !calls.some((call) => call.command.startsWith("secrets create") || call.command.startsWith("secrets versions")),
    );
  });

  it("stops the Google step on a model that is not an Anthropic model", async () => {
    const { gcloud } = fakeGcloud({
      "auth list": "me@example.com\n",
      "config get-value project": "duck-prod\n",
      "projects describe duck-prod": { projectNumber: "123456789", lifecycleState: "ACTIVE" },
      "billing projects describe": { billingEnabled: true },
    });
    const ask = async (question, fallback) => (question.includes("topic engine") ? "openai/gpt-5" : fallback);
    const result = await setUpGoogle({ ...base, gcloud, ask });
    assert.equal(result.outcome, "failed");
    assert.match(result.note, /Anthropic model/);
  });

  it("keeps the wake secret for GitHub when a later change fails", async () => {
    const { gcloud } = fakeGcloud({
      "auth list": "me@example.com\n",
      "config get-value project": "duck-prod\n",
      "projects describe duck-prod": { projectNumber: "123456789", lifecycleState: "ACTIVE" },
      "billing projects describe": { billingEnabled: true },
      "services list": GOOGLE_SERVICES.map((name) => ({ config: { name } })),
      "projects get-iam-policy": completeState().projectPolicy,
      "iam service-accounts get-iam-policy 123456789-compute": completeState().computePolicy,
      "iam service-accounts describe": {},
      "iam service-accounts get-iam-policy github-deploy": completeState().deployPolicy,
      "iam workload-identity-pools describe": { state: "ACTIVE" },
      "iam workload-identity-pools providers describe": completeState().provider,
      [`secrets get-iam-policy ${WORKER_SECRETS.serviceKey}`]: { bindings: [{ role: accessor, members: [compute] }] },
      [`secrets get-iam-policy ${WORKER_SECRETS.anthropicKey}`]: { bindings: [{ role: accessor, members: [compute] }] },
      [`secrets get-iam-policy ${WORKER_SECRETS.engineSecret}`]: { bindings: [{ role: accessor, members: [compute] }] },
      [`secrets create ${WORKER_SECRETS.wakeSecret}`]: "",
    });
    // The wake secret is new. Its accessor binding then fails with an error that is not "not found".
    const failing = (args, options) =>
      args[0] === "secrets" && args[1] === "add-iam-policy-binding"
        ? { ok: false, stdout: "", stderr: "ERROR: PERMISSION_DENIED" }
        : gcloud(args, options);
    const result = await setUpGoogle({ ...base, gcloud: failing });
    assert.equal(result.outcome, "failed");
    assert.match(result.secrets.WORKER_WAKE_SECRET, /^[0-9a-f]{64}$/);
    assert.equal(result.secrets.GCP_SERVICE_ACCOUNT, undefined);
  });
});
