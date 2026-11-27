// The Google Cloud part of the production setup: the background worker and the topic engine on Cloud Run, their
// Secret Manager secrets, and the Workload Identity sign-in of GitHub Actions. scripts/setup-prod.mjs calls
// setUpGoogle() as step 5d.
// The steps match the README section "One-time Google setup". Steps 1 (project and billing), 2 (budget alert) and
// 10 (Anthropic spend limit) stay manual.
// Each step reads the current state first. The script shows the full list of changes and asks before it applies it.
// A secret value goes to gcloud over stdin. It never shows on a command line or in the output.

import { randomBytes } from "node:crypto";

export const GOOGLE_SERVICES = [
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "iamcredentials.googleapis.com",
  "secretmanager.googleapis.com",
];
export const DEFAULT_GCP_REGION = "europe-west3";
// The model of the topic engine, in the LiteLLM form. The deploy-engine job uses the same default.
export const DEFAULT_TOPIC_MODEL = "anthropic/claude-haiku-5-5";
// The Secret Manager names that the deploy-worker and deploy-engine jobs in .github/workflows/ci.yml read.
// The worker and the engine both read engine-secret. The engine also reads the Anthropic key.
export const WORKER_SECRETS = {
  serviceKey: "worker-supabase-service-key",
  wakeSecret: "worker-wake-secret",
  anthropicKey: "worker-anthropic-api-key",
  engineSecret: "engine-secret",
};
const POOL = "github";
const DEPLOY_ACCOUNT = "github-deploy";
const DEPLOY_ROLES = ["roles/run.sourceDeveloper", "roles/run.admin", "roles/serviceusage.serviceUsageConsumer"];
const ACCESSOR_ROLE = "roles/secretmanager.secretAccessor";
// A new service account needs some seconds before a binding can name it. A failed binding waits, then tries again.
const RETRY_LIMIT = 4;
const RETRY_WAIT_MS = 5_000;

export class GoogleError extends Error {
  constructor(message, done = []) {
    super(message);
    this.done = done;
  }
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

// The first error line of gcloud. A read command has no secret in it, and a write command never echoes its stdin.
function firstLine(stderr) {
  const line = stderr
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item !== "");
  return (line ?? "no error message").slice(0, 300);
}

export function isNotFound(stderr) {
  return /NOT_FOUND|not found|does not exist|Cannot find/i.test(stderr);
}

// The names of the Google resources. They match the README and the deploy-worker and deploy-engine jobs.
export function googleIds({ projectId, projectNumber, repo, workerName }) {
  // A provider ID has at most 32 characters.
  const provider = workerName.slice(0, 32).replace(/-+$/, "");
  const poolPath = `projects/${projectNumber}/locations/global/workloadIdentityPools/${POOL}`;
  return {
    projectId,
    projectNumber,
    repo,
    computeAccount: `${projectNumber}-compute@developer.gserviceaccount.com`,
    deployAccount: `${DEPLOY_ACCOUNT}@${projectId}.iam.gserviceaccount.com`,
    provider,
    providerName: `${poolPath}/providers/${provider}`,
    principalSet: `principalSet://iam.googleapis.com/${poolPath}/attribute.repository/${repo}`,
    condition: `assertion.repository == '${repo}'`,
    service: `${workerName}-worker`,
    engineService: `${workerName}-engine`,
  };
}

// The address of a Cloud Run service, or null when the service does not exist.
function serviceUrl(service) {
  return typeof service.value?.status?.url === "string" ? service.value.status.url : null;
}

// True when the policy gives the role to the member without a condition.
export function hasBinding(policy, role, member) {
  return (policy?.bindings ?? []).some(
    (binding) => binding.role === role && !binding.condition && (binding.members ?? []).includes(member),
  );
}

// Read one resource. A missing resource gives found: false. Any other error stops the step.
function readJson(gcloud, args) {
  const result = gcloud([...args, "--format=json"]);
  if (result.ok) return { found: true, value: parseJson(result.stdout) };
  if (isNotFound(result.stderr)) return { found: false, value: null };
  throw new GoogleError(`gcloud ${args.slice(0, 3).join(" ")} failed: ${firstLine(result.stderr)}`);
}

// Read the state of every resource that planGoogleChanges() checks. Reads only.
export function readGoogleState(gcloud, ids, region) {
  const project = ["--project", ids.projectId];
  const projectPolicy = readJson(gcloud, ["projects", "get-iam-policy", ids.projectId]).value;
  const computePolicy = readJson(gcloud, ["iam", "service-accounts", "get-iam-policy", ids.computeAccount, ...project]);
  if (!computePolicy.found) {
    throw new GoogleError(
      `The service account ${ids.computeAccount} does not exist. Cloud Build and the worker use it. ` +
        `Run gcloud services enable compute.googleapis.com --project ${ids.projectId}, then run setup again.`,
    );
  }
  const deployAccount = readJson(gcloud, ["iam", "service-accounts", "describe", ids.deployAccount, ...project]);
  const deployPolicy = deployAccount.found
    ? readJson(gcloud, ["iam", "service-accounts", "get-iam-policy", ids.deployAccount, ...project]).value
    : null;
  const pool = readJson(gcloud, ["iam", "workload-identity-pools", "describe", POOL, "--location=global", ...project]);
  if (pool.value?.state === "DELETED") {
    throw new GoogleError(
      `The Workload Identity pool ${POOL} is deleted. Run gcloud iam workload-identity-pools undelete ${POOL} ` +
        `--location=global --project ${ids.projectId}, then run setup again.`,
    );
  }
  const provider = pool.found
    ? readJson(gcloud, [
        "iam",
        "workload-identity-pools",
        "providers",
        "describe",
        ids.provider,
        "--location=global",
        `--workload-identity-pool=${POOL}`,
        ...project,
      ])
    : { found: false, value: null };
  if (provider.value?.state === "DELETED") {
    throw new GoogleError(
      `The provider ${ids.provider} is deleted. Run gcloud iam workload-identity-pools providers undelete ` +
        `${ids.provider} --location=global --workload-identity-pool=${POOL} --project ${ids.projectId}, ` +
        "then run setup again.",
    );
  }
  // The policy read also shows whether the secret exists.
  const secrets = {};
  for (const name of Object.values(WORKER_SECRETS)) {
    const policy = readJson(gcloud, ["secrets", "get-iam-policy", name, ...project]);
    secrets[name] = { exists: policy.found, policy: policy.value };
  }
  const service = readJson(gcloud, ["run", "services", "describe", ids.service, `--region=${region}`, ...project]);
  const engine = readJson(gcloud, ["run", "services", "describe", ids.engineService, `--region=${region}`, ...project]);
  return {
    projectPolicy,
    computePolicy: computePolicy.value,
    deployExists: deployAccount.found,
    deployPolicy,
    pool: pool.value,
    provider: provider.value,
    secrets,
    serviceUrl: serviceUrl(service),
    engineUrl: serviceUrl(engine),
  };
}

// The changes that bring the project to the state of the README. "values" holds the secret values to write. A
// missing key keeps the current secret. The order matters: an account exists before a binding names it.
export function planGoogleChanges(state, ids, values) {
  const project = ["--project", ids.projectId];
  const compute = `serviceAccount:${ids.computeAccount}`;
  const deploy = `serviceAccount:${ids.deployAccount}`;
  const changes = [];
  const projectRole = (member, role) => {
    if (hasBinding(state.projectPolicy, role, member)) return;
    changes.push({
      label: `Give ${member} the role ${role} on the project`,
      args: [
        "projects",
        "add-iam-policy-binding",
        ids.projectId,
        `--member=${member}`,
        `--role=${role}`,
        "--condition=None",
      ],
    });
  };

  projectRole(compute, "roles/run.builder");
  if (!state.deployExists) {
    changes.push({
      label: `Create the service account ${ids.deployAccount}`,
      args: [
        "iam",
        "service-accounts",
        "create",
        DEPLOY_ACCOUNT,
        "--display-name=GitHub deploy of the worker",
        ...project,
      ],
    });
  }
  for (const role of DEPLOY_ROLES) projectRole(deploy, role);
  if (!hasBinding(state.computePolicy, "roles/iam.serviceAccountUser", deploy)) {
    changes.push({
      label: `Let ${ids.deployAccount} deploy the worker as ${ids.computeAccount}`,
      args: [
        "iam",
        "service-accounts",
        "add-iam-policy-binding",
        ids.computeAccount,
        `--member=${deploy}`,
        "--role=roles/iam.serviceAccountUser",
        ...project,
      ],
    });
  }

  if (!state.pool) {
    changes.push({
      label: `Create the Workload Identity pool ${POOL}`,
      args: [
        "iam",
        "workload-identity-pools",
        "create",
        POOL,
        "--location=global",
        "--display-name=GitHub Actions",
        ...project,
      ],
    });
  }
  const providerArgs = [ids.provider, "--location=global", `--workload-identity-pool=${POOL}`];
  if (!state.provider) {
    changes.push({
      label: `Create the provider ${ids.provider}. It accepts only ${ids.repo}`,
      args: [
        "iam",
        "workload-identity-pools",
        "providers",
        "create-oidc",
        ...providerArgs,
        "--issuer-uri=https://token.actions.githubusercontent.com",
        "--attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository",
        `--attribute-condition=${ids.condition}`,
        ...project,
      ],
    });
  } else if (state.provider.attributeCondition !== ids.condition) {
    changes.push({
      label: `Change the condition of the provider ${ids.provider} to: ${ids.condition}`,
      args: [
        "iam",
        "workload-identity-pools",
        "providers",
        "update-oidc",
        ...providerArgs,
        `--attribute-condition=${ids.condition}`,
        ...project,
      ],
    });
  }
  if (!hasBinding(state.deployPolicy, "roles/iam.workloadIdentityUser", ids.principalSet)) {
    changes.push({
      label: `Let GitHub Actions of ${ids.repo} sign in as ${ids.deployAccount}`,
      args: [
        "iam",
        "service-accounts",
        "add-iam-policy-binding",
        ids.deployAccount,
        "--role=roles/iam.workloadIdentityUser",
        `--member=${ids.principalSet}`,
        ...project,
      ],
    });
  }

  for (const [key, name] of Object.entries(WORKER_SECRETS)) {
    const value = values[key];
    const current = state.secrets[name] ?? { exists: false, policy: null };
    if (value !== undefined) {
      changes.push({
        label: current.exists ? `Add a new version of the secret ${name}` : `Create the secret ${name}`,
        args: current.exists
          ? ["secrets", "versions", "add", name, "--data-file=-", ...project]
          : ["secrets", "create", name, "--data-file=-", "--replication-policy=automatic", ...project],
        input: value,
        secret: key,
      });
    }
    if ((current.exists || value !== undefined) && !hasBinding(current.policy, ACCESSOR_ROLE, compute)) {
      changes.push({
        label: `Let the worker read the secret ${name}`,
        args: ["secrets", "add-iam-policy-binding", name, `--member=${compute}`, `--role=${ACCESSOR_ROLE}`, ...project],
      });
    }
  }
  return changes;
}

// Apply the changes in order. A failure stops the list. The error carries the changes that are done.
export async function applyGoogleChanges(gcloud, changes, { log, wait }) {
  const done = [];
  for (const change of changes) {
    let result;
    for (let attempt = 1; ; attempt += 1) {
      result = gcloud([...change.args, "--quiet", "--format=none"], { input: change.input });
      if (result.ok || attempt === RETRY_LIMIT || !isNotFound(result.stderr)) break;
      await wait(RETRY_WAIT_MS);
    }
    if (!result.ok) throw new GoogleError(`${change.label}: ${firstLine(result.stderr)}`, done);
    log(`Done: ${change.label}.`);
    done.push(change);
  }
  return done;
}

// Step 5d. Never throws: a failure gives outcome "failed", so the Supabase and GitHub steps still run.
// ctx: gcloud(args, { input }), ask, confirm, askHidden, log, wait, readServiceKey(), repo, workerName, github.
export async function setUpGoogle(ctx) {
  const result = { secrets: {}, variables: {}, openSteps: [], outcome: "skipped", note: "" };
  try {
    await runGoogleSetup(ctx, result);
  } catch (error) {
    if (!(error instanceof GoogleError)) throw error;
    ctx.log(`The Google step stopped: ${error.message}`);
    result.outcome = "failed";
    result.note = error.message;
    result.openSteps.push("Fix the Google error above, then run setup again. The Google step is safe to run again.");
  }
  return result;
}

async function runGoogleSetup(ctx, result) {
  const { gcloud, ask, confirm, log, wait, repo, workerName, github } = ctx;
  const manualGuide = "or follow the README section One-time Google setup";

  const auth = gcloud(["auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]);
  if (auth.missing) {
    result.note = "gcloud is not installed";
    result.openSteps.push(
      `Set up the Google worker: install gcloud (https://cloud.google.com/sdk/docs/install), run gcloud auth login, then run setup again, ${manualGuide}.`,
    );
    return;
  }
  const account = auth.ok ? auth.stdout.trim().split("\n")[0] : "";
  if (!account) {
    result.note = "gcloud is not logged in";
    result.openSteps.push(`Set up the Google worker: run gcloud auth login, then run setup again, ${manualGuide}.`);
    return;
  }
  log(`gcloud account: ${account}`);
  if (!(await confirm("Set up the background worker in Google Cloud now?", true))) {
    result.note = "you said no";
    result.openSteps.push(`Set up the Google worker: run setup again, ${manualGuide}.`);
    return;
  }

  log(
    "Create the Google Cloud project and link a billing account by hand first (README, One-time Google setup, step 1).",
  );
  const knownProject = github.variables.get("GCP_PROJECT_ID") ?? "";
  const configured = gcloud(["config", "get-value", "project"]);
  const projectId = await ask(
    "Google Cloud project ID",
    knownProject || (configured.ok ? configured.stdout.trim() : ""),
  );
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new GoogleError("A project ID has 6 to 30 lowercase letters, digits or hyphens, and starts with a letter.");
  }
  if (knownProject && projectId !== knownProject) {
    const move = await confirm(
      `GitHub uses the Google project ${knownProject}. Move the worker to ${projectId}?`,
      false,
    );
    if (!move) throw new GoogleError(`Run setup again and use the project ${knownProject}.`);
  }
  const project = readJson(gcloud, ["projects", "describe", projectId]);
  if (!project.found || project.value?.lifecycleState !== "ACTIVE" || !project.value?.projectNumber) {
    throw new GoogleError(
      `The project ${projectId} does not exist or is not active. Create it in the Google Cloud console.`,
    );
  }
  const billing = gcloud(["billing", "projects", "describe", projectId, "--format=json"]);
  const billingInfo = billing.ok ? parseJson(billing.stdout) : null;
  if (billingInfo && billingInfo.billingEnabled !== true) {
    throw new GoogleError(
      `The project ${projectId} has no billing account. Link one under Billing in the Google Cloud console.`,
    );
  }
  if (!billingInfo)
    log("Cannot read the billing state. The next changes fail when the project has no billing account.");

  const region = await ask(
    "Cloud Run region, near the Supabase project",
    github.variables.get("GCP_REGION") || DEFAULT_GCP_REGION,
  );
  if (!/^[a-z]+-[a-z]+\d+$/.test(region))
    throw new GoogleError(`${region} is not a region name, for example ${DEFAULT_GCP_REGION}.`);
  // The deploy-engine job sets LLM_PROVIDER=anthropic, so the model must be an Anthropic model.
  const topicModel = await ask("Model of the topic engine", github.variables.get("TOPIC_MODEL") || DEFAULT_TOPIC_MODEL);
  if (!/^anthropic\/[a-z0-9][a-z0-9.-]*$/.test(topicModel)) {
    throw new GoogleError(
      `${topicModel} is not an Anthropic model in the LiteLLM form, for example ${DEFAULT_TOPIC_MODEL}.`,
    );
  }
  const ids = googleIds({ projectId, projectNumber: project.value.projectNumber, repo, workerName });

  // The services first. The default compute account exists only after the services are on.
  const enabled = readJson(gcloud, ["services", "list", "--enabled", "--project", projectId]).value ?? [];
  const enabledNames = new Set(
    enabled.map(
      (item) =>
        item.config?.name ??
        String(item.name ?? "")
          .split("/")
          .pop(),
    ),
  );
  const missingServices = GOOGLE_SERVICES.filter((name) => !enabledNames.has(name));
  if (missingServices.length > 0) {
    log(`These services are off: ${missingServices.join(", ")}.`);
    if (!(await confirm("Turn them on?", true))) throw new GoogleError("The worker needs these services.");
    await applyGoogleChanges(
      gcloud,
      [{ label: "Turn on the services", args: ["services", "enable", ...missingServices, "--project", projectId] }],
      { log, wait },
    );
  }

  const state = readGoogleState(gcloud, ids, region);
  const values = await readSecretValues(ctx, state, result);

  const changes = planGoogleChanges(state, ids, values);
  if (changes.length > 0) {
    log("These Google Cloud changes are next:");
    for (const change of changes) log(`  - ${change.label}`);
    if (!(await confirm("Apply these changes?", true))) {
      result.note = "you said no to the changes";
      result.openSteps.push(`Set up the Google worker: run setup again, ${manualGuide}.`);
      return;
    }
    try {
      await applyGoogleChanges(gcloud, changes, { log, wait });
    } catch (error) {
      // Secret Manager holds the new wake secret. GitHub must get the same value.
      if (error instanceof GoogleError && error.done.some((change) => change.secret === "wakeSecret")) {
        result.secrets.WORKER_WAKE_SECRET = values.wakeSecret;
      }
      throw error;
    }
  }

  if (values.wakeSecret !== undefined) result.secrets.WORKER_WAKE_SECRET = values.wakeSecret;
  result.secrets.GCP_WORKLOAD_IDENTITY_PROVIDER = state.provider?.name ?? ids.providerName;
  result.secrets.GCP_SERVICE_ACCOUNT = ids.deployAccount;
  result.variables.GCP_PROJECT_ID = projectId;
  result.variables.GCP_REGION = region;
  result.variables.TOPIC_MODEL = topicModel;
  if (state.serviceUrl) {
    result.variables.WORKER_WAKE_URL = `${state.serviceUrl}/wake`;
  } else {
    result.openSteps.push("After the first worker deploy, run setup again. It then sets WORKER_WAKE_URL.");
  }
  // The worker reads an empty TOPIC_ENGINE_URL as no engine, so the first worker deploy can come before the engine.
  if (state.engineUrl) {
    result.variables.TOPIC_ENGINE_URL = state.engineUrl;
  } else {
    result.openSteps.push(
      "After the first engine deploy, run setup again. It then sets TOPIC_ENGINE_URL. Then run the workflow again.",
    );
  }
  if (Object.keys(values).length > 0) {
    result.openSteps.push(
      "Run Actions > CI > Run workflow on main. The worker and the engine read a new Secret Manager value only after a deploy.",
    );
  }
  result.openSteps.push("Set the Google budget alert and the Anthropic spend limit, if you did not do it yet.");
  result.outcome = changes.length > 0 ? "changed" : "done";
  result.note = `${projectId}, ${region}`;
}

// Ask for the secret values. A missing key in the result keeps the current secret.
async function readSecretValues(ctx, state, result) {
  const { confirm, askHidden, log, readServiceKey, github } = ctx;
  const values = {};

  const serviceKeyName = WORKER_SECRETS.serviceKey;
  const serviceKeyExists = state.secrets[serviceKeyName].exists;
  if (!serviceKeyExists || (await confirm(`Replace the Secret Manager secret ${serviceKeyName}?`, false))) {
    let key = await readServiceKey();
    if (key) {
      log("Read the Supabase service key from the Supabase project. It goes only to Secret Manager.");
    } else {
      log("Supabase project > Settings > API Keys: copy the service_role key or a secret key (sb_secret_...).");
      key = await askHidden("Supabase service key (empty to skip)");
    }
    if (key) {
      values.serviceKey = key;
    } else if (!serviceKeyExists) {
      result.openSteps.push(
        `Create the secret ${serviceKeyName}: run setup again. The worker cannot start without it.`,
      );
    }
  }

  // Secret Manager and the GitHub secret WORKER_WAKE_SECRET must hold the same value. The script cannot read the
  // GitHub value, so a gap in one of the two stores gives a new value for both.
  const wakeName = WORKER_SECRETS.wakeSecret;
  const wakeInBoth = state.secrets[wakeName].exists && github.secretNames.has("WORKER_WAKE_SECRET");
  if (!wakeInBoth || (await confirm("Replace the wake secret in Secret Manager and in GitHub?", false))) {
    values.wakeSecret = randomBytes(32).toString("hex");
    log("Generated a new wake secret for Secret Manager and the GitHub secret WORKER_WAKE_SECRET.");
  }

  // The worker and the engine read the engine secret from Secret Manager. GitHub does not hold a copy, so the
  // script makes a new value only for a missing secret, or when you replace it.
  const engineName = WORKER_SECRETS.engineSecret;
  if (!state.secrets[engineName].exists || (await confirm(`Replace the Secret Manager secret ${engineName}?`, false))) {
    values.engineSecret = randomBytes(32).toString("hex");
    log(`Generated a new engine secret for the Secret Manager secret ${engineName}.`);
  }

  const anthropicName = WORKER_SECRETS.anthropicKey;
  const anthropicExists = state.secrets[anthropicName].exists;
  if (!anthropicExists || (await confirm(`Replace the Secret Manager secret ${anthropicName}?`, false))) {
    log("Set the spend limit before you create the key (README, One-time Google setup, step 10):");
    log("1. Open https://platform.claude.com/settings/spend-limits and set a small monthly limit, for example 5 USD.");
    log("2. Open https://platform.claude.com/settings/keys and create a key with the name rubber-duck-worker.");
    let key = await askHidden("Anthropic API key (empty to skip)");
    if (key && !key.startsWith("sk-ant-") && !(await confirm("The key does not start with sk-ant-. Use it?", false))) {
      key = "";
    }
    if (key) {
      values.anthropicKey = key;
    } else if (!anthropicExists) {
      result.openSteps.push(
        `Create the secret ${anthropicName}: run setup again. The deploy-worker and deploy-engine jobs fail without it.`,
      );
    }
  }
  return values;
}
