# Path for Background Work Implementation Plan

## Overview

This change gives the product a path for work that takes longer than one page request. A learner starts a job, a worker outside the web app does the work, and the learner sees the progress and the result. The change proves the path with one trivial demo job. It is roadmap item F-01, and it unlocks S-01 (load a course from its URL) and S-02 (course as a topic graph).

## Current State Analysis

The web app runs on Cloudflare Workers and cannot do long work.

- A Worker gets at most 30 seconds after it sends a response (`src/env.d.ts:43`).
- The Free plan allows 10 ms of CPU for each request and 50 outgoing requests (`context/foundation/infrastructure.md:19`).
- The infrastructure research names this gap. It says to plan "Queues plus a consumer Worker, or an external worker" when ingestion arrives (`context/foundation/infrastructure.md:108`).

The app has no mechanism for background work, no job table and no worker.

- The only table is `notes` (`supabase/migrations/20261103220000_create_notes.sql:5`).
- The app talks to the database as the signed-in user only. `createClient` builds a client from the cookies of the request (`src/lib/supabase.ts:6`). A worker has no cookies, so it needs its own credential.
- The repo has no unit test runner. The smoke script and the pgTAP policy tests are the automated checks (`AGENTS.md:62`).

The repo already has the patterns that this change needs.

- A table with one policy for each operation, and a pgTAP test for the policies (`supabase/migrations/20261103220000_create_notes.sql:37`, `supabase/tests/notes_rls_test.sql`).
- An API route that checks the session itself, because the middleware protects only `/dashboard` (`src/pages/api/notes/index.ts:12`, `src/middleware.ts:4`).
- A switch that is off in production: `ALLOW_LOOK_OVERRIDE` (`astro.config.mjs:71`).
- A deploy job that skips with a notice until its settings exist (`.github/workflows/ci.yml:118`).
- A script that reads the local Supabase keys into memory and does not print them (`scripts/local.mjs:125`).

## Desired End State

A signed-in learner opens the check page, starts the demo job, and sees its status change without a manual reload: "Waiting", then "Step 2 of 5: ...", then "Done". The learner can close the page and open it again, and the status is still there. A failed job shows a short reason and a "Try again" button.

The work runs in a worker that is a plain Node process in a container. The same container runs on the developer machine, in CI and on Google Cloud Run. The web app sends one short "wake" request when a job starts. The job table is the source of truth, so a lost wake request or a stopped worker does not lose a job.

To verify the end state:

1. Run `npm start` in one terminal and `npm run worker` in a second terminal, with the switch on.
2. Open `/dashboard/job-check`, start a demo job, and watch it reach "Done".
3. Run `npm run smoke` with `SMOKE_JOB_CHECK=1`. All job steps pass.
4. After the production setup, do the same check on the production address with the switch on.

### Key Discoveries:

- `astro check` and ESLint cover every TypeScript file, because `tsconfig.json` includes `**/*`. Code in a new `worker/` folder gets type checks and lint with no new pipeline step.
- Node 26 runs TypeScript files and TypeScript unit tests directly. A check with `node --test` on two `.ts` files passed with no build step and no warning.
- The CI smoke job starts local Supabase without the edge runtime and without realtime (`.github/workflows/ci.yml:73`). The REST API stays on, and that is the only database interface that the worker needs.
- `remove-sample.mjs` edits only the blocks between the `sample-resource` markers (`scripts/remove-sample.mjs:33`). New code must stay outside those markers, so that the `without-sample` CI variant stays green.
- Google's deploy action deploys a service from a folder of the repo and passes extra flags to `gcloud run deploy`. The flag `--no-cpu-throttling` sets instance-based billing.
- Cloud Run with instance-based billing keeps the CPU on after a response. Cloud Run can still stop an instance that has no requests, at most 15 minutes after the last request.

## What We're NOT Doing

- No cancel of a job. A learner cannot stop a waiting or a running job.
- No message when a job ends. The learner gets no email.
- No list of past jobs. The check page shows only the newest job of the learner.
- No real job type. Course loading (S-01) and topic extraction (S-02) add their own job types later.
- No checkpoints inside a job. A job that starts again runs from its first step.
- No narrow database role for the worker. The worker uses the Supabase service key, as decided.
- No change to `scripts/setup-prod.mjs`. The human does the Google setup by hand from the README steps.
- No live push of the status. The page asks for the status again every 3 seconds.
- No Cloud Run job, no Cloud Scheduler and no Cloud Tasks. The worker is a Cloud Run service.
- No navigation link and no dashboard entry for the check page. The page opens by its address only.

## Implementation Approach

The database owns the job rules. One table holds the jobs, and five database functions give the worker its only way to change a job. A job goes to a worker with a lease. A lease that ends returns the job to the queue. The fourth start of a job marks it failed. Because these rules live in the database, pgTAP tests can prove them without a worker.

The worker is TypeScript with zero dependencies in `worker/`. It uses the `fetch` and the HTTP server that Node has built in, and it calls the five database functions through the REST API of Supabase. It has one address for the wake request and one for a health check. A job type is one handler function in a registry, so S-01 and S-02 add a handler and nothing else.

The web app gets three small routes, one helper module and one check page behind a switch. The learner can create a job and read their own jobs. The learner cannot change a job row. "Try again" goes through one database function that checks the owner and the status.

The work goes in this order: database, worker, web app, CI tests, production. Phases 1 to 4 need no Google account. All work happens on the branch `background-work-path`, because `AGENTS.md` forbids commits on `main`.

## Critical Implementation Details

### Timing & lifecycle

Cloud Run sends SIGTERM before it stops an instance and gives the process about 10 seconds. On SIGTERM the worker must take no new job and must release its current job with `release_job`. `release_job` gives the attempt back. Without it, three instance stops would mark a healthy job as failed.

### State sequencing

The web app must send the wake request only after the insert of the job row succeeds. The worker replies to the wake request before it takes a job. A wake request that arrives while the worker already takes jobs must not start a second loop.

### Debug & observability

The worker writes one JSON line to stdout for each job event: claimed, step, done, failed, released. A line holds the job id, the job type and the attempt. A line never holds the payload, the result or a key. The raw error of a failed job goes only to this log. The `error` column gets only a short reason that is safe to show to the learner.

## Phase 1: Job table and rules

### Overview

This phase adds the job table, its access rules and the database functions that hold the job rules. After this phase, pgTAP tests prove the rules, and no worker or page exists.

### Changes Required:

#### 1. Job table

**File**: `supabase/migrations/<timestamp>_create_jobs.sql`

**Intent**: Add the table that holds each job with its owner, its type, its state, its progress and its lease. The table is the single source of truth for a job.

**Contract**: Table `public.jobs` with these columns.

- `id uuid` primary key with a generated default.
- `user_id uuid not null`, default `auth.uid()`, references `auth.users (id)` with `on delete cascade`.
- `type text not null`, with a check that allows only `'demo'`. A later migration adds a type.
- `payload jsonb not null`, default `'{}'`.
- `status text not null`, default `'waiting'`, with a check that allows `waiting`, `running`, `done` and `failed`.
- `step_index integer not null default 0`, `step_count integer not null default 0`, `step_label text`.
- `attempts integer not null default 0`. It counts the starts of the job.
- `error text`. It holds a short reason for the learner.
- `result jsonb`.
- `lease_id uuid`, `lease_expires_at timestamptz`.
- `created_at`, `updated_at` and `finished_at` as `timestamptz`. `updated_at` uses the trigger pattern of `notes`.

Two indexes: a partial unique index on `(user_id)` where `status in ('waiting', 'running')`, and an index on `(created_at)` with the same condition for the queue. The unique index is the rule "one job in progress for each learner".

#### 2. Access rules for the learner

**File**: `supabase/migrations/<timestamp>_create_jobs.sql`

**Intent**: Let a learner create a job and read their own jobs, and nothing else. A learner must not set the state, the progress or the lease of a job.

**Contract**: Row level security is on. The role `authenticated` gets one `select` policy and one `insert` policy, both with `(select auth.uid()) = user_id`. The grants are `select` on the table and `insert (type, payload)` on those two columns only, so every other column takes its default. The role `authenticated` gets no `update` and no `delete`. The role `anon` gets nothing.

#### 3. Functions for the worker

**File**: `supabase/migrations/<timestamp>_create_jobs.sql`

**Intent**: Give the worker its only way to take a job, to report progress and to end a job. The functions hold the lease rule and the attempt rule, so that the rules are the same for every worker.

**Contract**: Five functions in `public`. Only the role `service_role` can execute them. The migration revokes execute from `public`, `anon` and `authenticated`.

- `claim_job(lease_seconds integer default 60)` returns one job row or no row. It takes the oldest job that is `waiting`, or that is `running` with a lease that ended. It locks with `for update skip locked`. If the job already has 3 attempts, the function sets it to `failed` with the reason "The work stopped before it ended." and looks at the next job. In the other case it adds 1 to `attempts`, sets `running`, sets a new `lease_id` and sets `lease_expires_at`.
- `heartbeat_job(job_id uuid, lease uuid, step_index integer, step_count integer, step_label text, lease_seconds integer default 60)` returns `boolean`. It writes the progress and extends the lease. It returns `false` when the job does not hold this lease.
- `complete_job(job_id uuid, lease uuid, result jsonb)` returns `boolean`. It sets `done` and `finished_at`.
- `fail_job(job_id uuid, lease uuid, reason text)` returns `boolean`. With fewer than 3 attempts it sets `waiting` and clears the lease. With 3 attempts it sets `failed`, `error` and `finished_at`.
- `release_job(job_id uuid, lease uuid)` returns `boolean`. It sets `waiting`, clears the lease and subtracts 1 from `attempts`.

Each function that takes a lease changes the row only when `lease_id` equals the given lease and the status is `running`.

#### 4. Function for the learner

**File**: `supabase/migrations/<timestamp>_create_jobs.sql`

**Intent**: Let a learner start a failed job again without a right to update the row.

**Contract**: `retry_job(job_id uuid)` returns `boolean`. It is `security definer` with a fixed `search_path`. It changes the row only when `user_id` equals `auth.uid()` and the status is `failed`. It sets `waiting`, sets `attempts` to 0 and clears `error`, the progress, the lease and `finished_at`. Only `authenticated` can execute it.

#### 5. Policy and rule tests

**File**: `supabase/tests/jobs_test.sql`

**Intent**: Prove the access rules and the job rules in the database, with the pattern of `notes_rls_test.sql`.

**Contract**: The tests cover these cases.

- A learner reads their own job and does not read the job of a different learner.
- A learner cannot insert a second job while one is `waiting` or `running`.
- A learner cannot update or delete a job, and cannot insert a job with a status or an owner of their choice.
- A learner cannot execute the five worker functions.
- `claim_job` takes the oldest waiting job and adds 1 to `attempts`.
- A second `claim_job` does not take a job with a live lease, and does take a job with a lease that ended.
- `fail_job` returns the job to `waiting` at attempts 1 and 2, and sets `failed` at attempt 3.
- `claim_job` sets `failed` for a job with 3 attempts and a lease that ended.
- `heartbeat_job`, `complete_job` and `fail_job` return `false` for a wrong lease and change nothing.
- `release_job` gives the attempt back.
- `retry_job` works for the owner of a failed job only, and not for a job that is not failed.

#### 6. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Give the web app and the worker the types of the new table and functions.

**Contract**: The file comes from `npm run db:types`. Nobody edits it by hand.

### Success Criteria:

#### Automated Verification:

- The migration applies to a clean local database: `npx supabase db reset`
- The policy and rule tests pass: `npx supabase test db`
- The generated types are current: `npm run db:types` leaves no diff after the commit
- Lint passes: `npm run lint`
- Type checks pass: `npx astro check`

#### Manual Verification:

- In the local Supabase Studio, the `jobs` table shows row level security as on, with one `select` policy and one `insert` policy

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Worker

### Overview

This phase adds the worker process, the demo job and the unit tests. After this phase, a job row that a developer inserts by hand runs to its end on the developer machine.

### Changes Required:

#### 1. Worker entry point

**File**: `worker/main.ts`

**Intent**: Start a small HTTP server that receives the wake request and starts the job loop. The process must run the same way on a laptop, in CI and in a container.

**Contract**: The process reads these environment variables.

- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`: necessary. The process stops with a clear message when one is absent.
- `WORKER_WAKE_SECRET`: necessary.
- `PORT`: default `8788`.
- `WORKER_POLL_SECONDS`: optional. When it is set, the worker also looks for jobs at this interval. Cloud Run does not set it.

The server has two addresses.

- `POST /wake` needs the header `Authorization: Bearer <WORKER_WAKE_SECRET>`. It replies `202` at once and then starts the job loop if no loop runs. A wrong secret gets `401`.
- `GET /health` replies `200`.

On SIGTERM the process takes no new job, calls `release_job` for its current job, and stops.

#### 2. Database calls

**File**: `worker/queue.ts`

**Intent**: Keep every call to the database in one module, so that the rest of the worker does not know the REST API.

**Contract**: One function for each of the five worker database functions. Each one sends `POST <SUPABASE_URL>/rest/v1/rpc/<function>` with the headers `apikey` and `Authorization: Bearer <SUPABASE_SERVICE_KEY>`. A call has a time limit of 10 seconds. The module never writes the key to the log.

#### 3. Job loop and rules

**File**: `worker/run.ts`, `worker/rules.ts`

**Intent**: Take jobs one at a time until the queue is empty, keep the lease alive while a handler runs, and end each job with the correct database call.

**Contract**:

- The loop calls `claim_job`, runs the handler of the job type, and calls `complete_job` or `fail_job`. It stops when `claim_job` returns no row.
- While a handler runs, a timer calls `heartbeat_job` every 20 seconds. A handler also calls it through `step(index, count, label)`. When a call returns `false`, the worker stops the handler through an `AbortSignal` and writes no result.
- A handler gets `{ payload, attempt, step, signal }` and returns a JSON result.
- When a handler throws, the worker waits `attempt × 5` seconds and then calls `fail_job`. The reason comes from a handler error that is marked as safe for the learner. Any other error gets the reason "The work did not finish.".
- A job with an unknown type fails with the reason "This kind of work is not available.".
- `worker/rules.ts` holds the decisions as pure functions: the wait before a retry, the check of the wake header, and the limits of the demo payload.

#### 4. Handler registry and demo job

**File**: `worker/handlers/index.ts`, `worker/handlers/demo.ts`

**Intent**: Give later slices one place to add a job type, and prove the path with a job that does no real work.

**Contract**: `handlers` maps a job type to a handler. The demo handler reads `{ steps, stepSeconds, failTimes }` from the payload and puts each value inside its limit: `steps` 1 to 10 with default 5, `stepSeconds` 0 to 5 with default 2, `failTimes` 0 to 3 with default 0. It reports each step, waits `stepSeconds` for each step, and throws a safe error while `attempt` is not more than `failTimes`. Its result is `{ steps: <count> }`.

#### 5. Unit tests

**File**: `worker/rules.test.ts`, `worker/handlers/demo.test.ts`, `worker/run.test.ts`

**Intent**: Test the logic that an end-to-end run shows only slowly.

**Contract**: The tests use `node:test` and `node:assert`. They cover the wait before a retry, the check of the wake header, the limits of the demo payload, the demo failure rule for each attempt, and the loop with a fake queue: a job that ends, a job that fails, a job that loses its lease, and an unknown job type.

#### 6. Local launcher and scripts

**File**: `scripts/worker.mjs`, `package.json`

**Intent**: Start the worker on a developer machine and in CI with the local Supabase values, and keep the service key out of every file.

**Contract**: `scripts/worker.mjs` has zero dependencies. When `SUPABASE_SERVICE_KEY` is not in the environment, it reads `API_URL` and `SERVICE_ROLE_KEY` from `npx supabase status -o env` into memory, as `scripts/local.mjs:125` does, and does not print them. It sets `WORKER_WAKE_SECRET` to `local-wake-secret` and `WORKER_POLL_SECONDS` to `5` when they are absent. Then it starts `node worker/main.ts`. `package.json` gets two scripts: `worker` runs the launcher, and `test:unit` runs `node --test "worker/**/*.test.ts"`. `package.json` also gets the dev dependency `@types/node` in the major version of `.nvmrc`.

#### 7. Lint for the worker

**File**: `eslint.config.js`

**Intent**: Lint the worker with the Node globals, as the `scripts/**/*.mjs` block does for the scripts.

**Contract**: One new config block for `worker/**/*.ts` with the Node globals. The strict type-checked rules stay on for the worker.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type checks pass: `npx astro check`
- The worker starts and its health address replies: `npm run worker` and then `curl -sf http://localhost:8788/health`
- A wake request with a wrong secret gets 401, and one with the correct secret gets 202

#### Manual Verification:

- A demo job row that the developer inserts in the local Supabase Studio goes from `waiting` to `done`, and its step columns change on the way
- The worker log shows one JSON line for each job event and shows no key and no payload

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Web app path

### Overview

This phase connects the web app to the job table and the worker. After this phase, a signed-in learner starts the demo job on a page and sees its progress and its result.

### Changes Required:

#### 1. Settings

**File**: `astro.config.mjs`, `.env.example`

**Intent**: Add the switch for the check page and the two settings for the wake request.

**Contract**: The `env.schema` gets three entries.

- `ENABLE_JOB_CHECK`: boolean, server, public, default `false`.
- `WORKER_WAKE_URL`: string, server, secret, optional.
- `WORKER_WAKE_SECRET`: string, server, secret, optional.

`.env.example` gets the three names as comments, with the local values `http://localhost:8788/wake` and `local-wake-secret`, and a note that production keeps the switch off.

#### 2. Job helpers

**File**: `src/lib/jobs.ts`

**Intent**: Hold the job view, the texts and the wake request in one module, as `src/lib/notes.ts` does for notes.

**Contract**:

- `JobView`: `{ id, type, status, stepIndex, stepCount, stepLabel, attempts, maxAttempts, error, result, updatedAt }`. `maxAttempts` is the constant 3.
- `toJobView(row)` maps a database row to a `JobView`. It never returns the lease columns or the payload.
- `wakeWorker()` sends `POST WORKER_WAKE_URL` with the bearer secret and a time limit of 5 seconds. It runs through `waitUntil` from `cloudflare:workers`, so the response does not wait for it. It does nothing when a setting is absent, and it never throws.
- `needsWake(row, now)` is `true` when the job is `waiting` or `running`, and its `updated_at` is more than 30 seconds old.
- Error keys and their texts for the page, with the pattern of `noteErrorText`: `job_active`, `not_available`, `not_configured`, `unknown`.

#### 3. Route to start a job

**File**: `src/pages/api/jobs/index.ts`

**Intent**: Create a job for the signed-in learner and wake the worker.

**Contract**: `POST /api/jobs` with a form. It checks the session as `src/pages/api/notes/index.ts:12` does. It accepts the type `demo` only when `ENABLE_JOB_CHECK` is `true`, and puts the demo values inside their limits. It inserts `{ type, payload }` with the client of the learner. A unique violation redirects to the check page with `error=job_active`. After a successful insert it calls `wakeWorker()` and redirects to `/dashboard/job-check?job=<id>`.

#### 4. Route to read a job

**File**: `src/pages/api/jobs/[id]/index.ts`

**Intent**: Give the page the current state of one job in a short request.

**Contract**: `GET /api/jobs/<id>` returns the `JobView` as JSON with `cache-control: no-store`. It returns `401` without a session and `404` for a job that the learner cannot read. When `needsWake` is `true`, it calls `wakeWorker()`.

#### 5. Route to retry a job

**File**: `src/pages/api/jobs/[id]/retry.ts`

**Intent**: Start a failed job again for its owner.

**Contract**: `POST /api/jobs/<id>/retry` calls `retry_job` with the client of the learner. When the function returns `true`, the route calls `wakeWorker()`. It redirects to `/dashboard/job-check?job=<id>`.

#### 6. Status component

**File**: `src/components/jobs/JobStatus.tsx`, `src/components/hooks/useJobStatus.ts`

**Intent**: Show the state of a job and refresh it without a reload of the page.

**Contract**: `useJobStatus(jobId, initial)` asks `GET /api/jobs/<id>` every 3 seconds while the status is `waiting` or `running`, and stops at `done` or `failed`. `JobStatus` shows these texts.

- `waiting`: "Waiting for a worker".
- `running`: "Step 2 of 5: <label>", and "Attempt 2 of 3" from the second attempt.
- `done`: "Done".
- `failed`: "Failed", the reason, and a "Try again" button that posts to the retry route.

The component uses token classes only, and each button has `min-h-11 min-w-11`, as `AGENTS.md:56` and `AGENTS.md:63` require.

#### 7. Check page

**File**: `src/pages/dashboard/job-check.astro`

**Intent**: Give the developer and CI one page that starts the demo job and shows its state.

**Contract**: The page returns `404` when `ENABLE_JOB_CHECK` is `false`. With the switch on, it uses `AppLayout`, shows a form that posts to `/api/jobs` with the three demo values, and shows `JobStatus` for the job in `?job=<id>`, or for the newest job of the learner. It shows the text of an `error` key. The page gets no entry in `src/lib/nav.ts` and no entry on the dashboard.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checks pass: `npx astro check`
- The production build passes: `npm run build`
- Unit tests still pass: `npm run test:unit`
- With the switch off, `GET /dashboard/job-check` returns 404 for a signed-in user

#### Manual Verification:

- With the switch on and the worker running, a demo job on the check page goes from "Waiting for a worker" through the steps to "Done" without a reload
- The status is still there after the learner closes the page and opens it again
- A second start while a job is in progress shows the "job active" message
- A demo job with `failTimes` 1 shows "Attempt 2 of 3" and then "Done"
- A demo job with `failTimes` 3 shows "Failed" with a reason, and "Try again" starts it again
- With the worker stopped, a new job stays on "Waiting for a worker", and it runs after the worker starts
- The check page obeys the phone rules at 320px in the active look

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Tests in CI

### Overview

This phase makes CI protect the path. After this phase, a change that breaks the job path fails the smoke job.

### Changes Required:

#### 1. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove the full path against a running server and a running worker, with the cookie jars that the script already has.

**Contract**: The job steps run only when `SMOKE_JOB_CHECK` is set, as the hook steps do with `SMOKE_HOOK_SECRET` (`scripts/smoke.mjs:4`). They sit outside the `sample-resource` markers. The steps are these.

- The check page returns 200 for the signed-in smoke user.
- A demo job with 2 steps of 1 second reaches `done` within 60 seconds, and its view shows `stepCount` 2.
- A second start while a job is in progress redirects with `error=job_active`.
- A demo job with `failTimes` 1 reaches `done` with `attempts` 2.
- A demo job with `failTimes` 3 reaches `failed` with `attempts` 3, and the retry route returns it to `waiting` or `running`.
- A request for the job of the main user with the session of a second user returns 404.
- A request for a job without a session returns 401.

#### 2. Phone check

**File**: `scripts/phone-check.mjs`

**Intent**: Apply the phone rules to the check page.

**Contract**: The page list gets `/dashboard/job-check`, only when the server has the switch on. The entry sits outside the `sample-resource` markers.

#### 3. CI smoke job

**File**: `.github/workflows/ci.yml`

**Intent**: Run the unit tests and the job smoke steps in CI. The user approved two added steps in this job.

**Contract**:

- The existing step that appends test values to `.dev.vars` (`.github/workflows/ci.yml:79`) also appends `ENABLE_JOB_CHECK=true`, `WORKER_WAKE_URL=http://localhost:8788/wake` and `WORKER_WAKE_SECRET=local-wake-secret`, and adds `SMOKE_JOB_CHECK=1` to `$GITHUB_ENV`.
- Added step 1, after the database policy tests: `npm run test:unit`.
- Added step 2, before the step that starts the preview: start `npm run worker` in the background and wait until `http://localhost:8788/health` replies.

Both matrix variants run the steps. The `ci` job and the `deploy` job do not change in this phase.

#### 4. Agent guidelines

**File**: `AGENTS.md`

**Intent**: Tell the next agent that the worker, its commands and its tests exist.

**Contract**: The section "Build, test, and development commands" gets `npm run worker` and `npm run test:unit`. The section "Project structure" gets one entry for `worker/` and one for the job files in `src/`. The section "Testing" says that the unit test runner is `node --test`, for the worker only. The hard rules, the deploy rules and the security rules keep their text.

### Success Criteria:

#### Automated Verification:

- The smoke test passes with the job steps: `SMOKE_JOB_CHECK=1 npm run smoke`, with the preview and the worker running
- The phone check passes for the check page: `npm run phone-check`
- The smoke test still passes without `SMOKE_JOB_CHECK`, and it skips the job steps
- The sample removal still leaves a green repo: `node scripts/remove-sample.mjs --yes` on a scratch copy, then `npm run lint` and `npx astro check`
- The pull request shows the `ci` job and both `smoke` variants as passed

#### Manual Verification:

- The log of the CI smoke job shows the unit test step and the worker start step, and shows no key

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 5: Production home

### Overview

This phase gives the worker its production home on Google Cloud Run and connects the production web app to it. After this phase, a demo job runs in production. The human does the Google setup. An agent writes the files and does not deploy by hand.

### Changes Required:

#### 1. Container image

**File**: `worker/Dockerfile`, `worker/.dockerignore`

**Intent**: Build a small image that holds only the worker.

**Contract**: The base image has the Node major version of `.nvmrc`. The image copies only `worker/`, runs as a user that is not root, and starts `node main.ts`. It installs no package. `.dockerignore` keeps the test files out of the image. The worker imports nothing from `src/` at run time. An `import type` from `src/db/database.types.ts` is permitted, because Node removes it.

#### 2. Worker deploy job

**File**: `.github/workflows/ci.yml`

**Intent**: Deploy the worker from CI on a push to `main`. The user selected a deploy job in CI.

**Contract**: A new job `deploy-worker`.

- It needs `ci` and `smoke`, and it has the same `if` condition, the same `environment: production` and the same concurrency pattern as `deploy`.
- Its permissions are `contents: read` and `id-token: write`.
- Its first step checks the settings, with the pattern of `.github/workflows/ci.yml:118`. When `GCP_WORKLOAD_IDENTITY_PROVIDER` is absent on a push, the job prints a notice that names the README section and ends with success.
- It deploys only when a file in `worker/` changed in the push, or when the event is `workflow_dispatch`.
- It signs in with `google-github-actions/auth` through Workload Identity Federation: the secrets `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT`. The repo holds no Google key.
- It deploys with `google-github-actions/deploy-cloudrun`: the service name `rubber-duck-on-steroids-worker`, `source: worker`, the variables `GCP_PROJECT_ID` and `GCP_REGION`, and the flags `--no-cpu-throttling --no-invoker-iam-check --min-instances=0 --max-instances=1 --cpu=1 --memory=512Mi`.
- It gives the service three environment variables from the `production` environment: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `WORKER_WAKE_SECRET`.

#### 3. Wake settings for the web app

**File**: `.github/workflows/ci.yml`

**Intent**: Give the production Worker the address and the secret of the wake request, and let the human turn the switch on for a check.

**Contract**: The `deploy` job sends `WORKER_WAKE_SECRET` (a secret) and `WORKER_WAKE_URL` (a variable) to the Worker with the other secrets, only when they are set. The build step of the `deploy` job reads the variable `ENABLE_JOB_CHECK`. The settings check of the `deploy` job does not make these three necessary.

#### 4. Setup steps for the human

**File**: `README.md`

**Intent**: Give the human every step of the Google setup and of the production check, because an agent does not set production secrets.

**Contract**: A new section "Background worker" under "Deployment". It has these parts.

- What the worker is, and how to run it on a local machine.
- The one-time Google setup: a project with billing and a budget alert, the Cloud Run, Cloud Build and Artifact Registry services, a service account for the deploy, and Workload Identity Federation for this repository.
- The settings of the `production` environment in GitHub: the secrets `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `SUPABASE_SERVICE_KEY` and `WORKER_WAKE_SECRET`, and the variables `GCP_PROJECT_ID`, `GCP_REGION` and `WORKER_WAKE_URL`.
- The order of the first deploy: deploy the worker, copy its address into `WORKER_WAKE_URL` with `/wake` at the end, then run the `deploy` job again.
- The production check: set the variable `ENABLE_JOB_CHECK` to `true`, deploy, run a demo job, remove the variable, deploy again.
- A warning that the Supabase service key passes all access rules, and that it goes only to the worker.

The section "The pipeline" gets one line for the `deploy-worker` job.

#### 5. Agent guidelines for production

**File**: `AGENTS.md`

**Intent**: Keep the security rules complete for the next agent.

**Contract**: The section "Security and configuration" gets two lines. The Supabase service key lives only in the worker environment and never in the web app or in a file. The human does the Google setup and sets the Google settings in GitHub.

### Success Criteria:

#### Automated Verification:

- The container builds: `docker build -t rubber-duck-worker worker/`
- The container runs against the local Supabase, and its health address replies
- Lint passes: `npm run lint`
- The pull request shows the `ci` job and both `smoke` variants as passed

#### Manual Verification:

- Before the Google settings exist, a push to `main` shows the `deploy-worker` job as passed with the skip notice
- After the Google setup, the `deploy-worker` job deploys the worker, and the health address of the service replies
- With the switch on in production, a demo job on the production check page reaches "Done"
- A demo job that starts after the worker instance stopped also reaches "Done"
- After the check, the variable `ENABLE_JOB_CHECK` is removed, and the production check page returns 404
- The Google billing page shows a cost of zero, or a cost that the human accepts, one day after the check

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- The wait before a retry for attempts 1, 2 and 3.
- The check of the wake header: correct secret, wrong secret, no header.
- The limits of the demo payload: values below, inside and above each limit, and values of a wrong type.
- The demo failure rule: with `failTimes` 1, attempt 1 fails and attempt 2 passes.
- The job loop with a fake queue: a job that ends, a job that fails, a lost lease that stops the handler, an unknown job type, and an empty queue.

### Integration Tests:

- pgTAP tests for the access rules and for each database function, listed in Phase 1.
- Smoke steps for the full path through the web app and the worker, listed in Phase 4.

### Manual Testing Steps:

1. Start `npm start` and `npm run worker` with the switch on. Open `/dashboard/job-check`.
2. Start a demo job with 5 steps. Watch the step text change every 2 seconds until "Done".
3. Start a demo job, close the page, open it again. The status is still there.
4. Start a demo job with `failTimes` 3. Wait for "Failed". Select "Try again".
5. Stop the worker. Start a demo job. It stays on "Waiting for a worker". Start the worker. The job runs.
6. Stop the worker in the middle of a job with Ctrl+C. The job returns to `waiting`, and its attempt count does not grow.

## Performance Considerations

- Each open check page sends one request every 3 seconds while a job runs. A request needs two database calls: the session and the job row. That is inside the limits of the Workers Free plan for the first users.
- The status route does little CPU work, but the 10 ms limit of the Free plan applies to it. The infrastructure research names the trigger for the paid plan (`context/foundation/infrastructure.md:19`).
- A wake request costs one outgoing request of the 50 that the Free plan allows for each request.
- On Cloud Run, each wake keeps one instance on for the job time plus at most 15 idle minutes. `--max-instances=1` bounds the cost.
- The worker takes one job at a time. That is enough for the first users. A later change can add a second loop.

## Migration Notes

- The migration only adds a table and functions. It changes no existing table.
- Supabase migrations do not roll back with the Worker (`context/foundation/infrastructure.md:95`). A rollback of the web app leaves the `jobs` table in place, and the table does no harm without the routes.
- The `deploy` job applies the migration to production with `SUPABASE_DB_URL`, as it does today.
- The worker and the web app deploy through two jobs. A new job type must reach the worker before the web app offers it. For F-01 this order does not matter, because the demo type ships with both.

## References

- Roadmap item: `context/foundation/roadmap.md`, F-01
- Requirements: `context/foundation/prd.md`, FR-002 and FR-003
- Stack decision: `context/foundation/tech-stack.md`
- Platform limits and the ingestion risk: `context/foundation/infrastructure.md:19`, `context/foundation/infrastructure.md:108`
- Table and policy pattern: `supabase/migrations/20261103220000_create_notes.sql:37`
- Policy test pattern: `supabase/tests/notes_rls_test.sql`
- API route pattern: `src/pages/api/notes/index.ts:7`
- Switch pattern: `astro.config.mjs:71`
- Skip pattern of the deploy job: `.github/workflows/ci.yml:118`
- Local key handling: `scripts/local.mjs:125`
- Cloud Run billing settings: https://docs.cloud.google.com/run/docs/configuring/billing-settings
- Cloud Run request timeout: https://docs.cloud.google.com/run/docs/configuring/request-timeout
- Google deploy action: https://github.com/google-github-actions/deploy-cloudrun

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Job table and rules

#### Automated

- [x] 1.1 The migration applies to a clean local database — 52a8708
- [x] 1.2 The policy and rule tests pass — 52a8708
- [x] 1.3 The generated types are current — 52a8708
- [x] 1.4 Lint passes — 52a8708
- [x] 1.5 Type checks pass — 52a8708

#### Manual

- [x] 1.6 The jobs table shows row level security as on, with one select policy and one insert policy — 52a8708

### Phase 2: Worker

#### Automated

- [x] 2.1 Unit tests pass — 0e2bb1c
- [x] 2.2 Lint passes — 0e2bb1c
- [x] 2.3 Type checks pass — 0e2bb1c
- [x] 2.4 The worker starts and its health address replies — 0e2bb1c
- [x] 2.5 A wake request with a wrong secret gets 401, and one with the correct secret gets 202 — 0e2bb1c

#### Manual

- [x] 2.6 A demo job row inserted by hand goes from waiting to done, and its step columns change — 0e2bb1c
- [x] 2.7 The worker log shows one JSON line for each job event and shows no key and no payload — 0e2bb1c

### Phase 3: Web app path

#### Automated

- [x] 3.1 Lint passes
- [x] 3.2 Type checks pass
- [x] 3.3 The production build passes
- [x] 3.4 Unit tests still pass
- [x] 3.5 With the switch off, the check page returns 404 for a signed-in user

#### Manual

- [x] 3.6 A demo job goes from waiting through the steps to done without a reload
- [x] 3.7 The status is still there after the learner closes the page and opens it again
- [x] 3.8 A second start while a job is in progress shows the job active message
- [x] 3.9 A demo job with failTimes 1 shows attempt 2 of 3 and then done
- [x] 3.10 A demo job with failTimes 3 shows failed with a reason, and Try again starts it again
- [x] 3.11 With the worker stopped, a new job stays waiting, and it runs after the worker starts
- [x] 3.12 The check page obeys the phone rules at 320px in the active look

### Phase 4: Tests in CI

#### Automated

- [ ] 4.1 The smoke test passes with the job steps
- [ ] 4.2 The phone check passes for the check page
- [ ] 4.3 The smoke test still passes without SMOKE_JOB_CHECK, and it skips the job steps
- [ ] 4.4 The sample removal still leaves a green repo
- [ ] 4.5 The pull request shows the ci job and both smoke variants as passed

#### Manual

- [ ] 4.6 The log of the CI smoke job shows the unit test step and the worker start step, and shows no key

### Phase 5: Production home

#### Automated

- [ ] 5.1 The container builds
- [ ] 5.2 The container runs against the local Supabase, and its health address replies
- [ ] 5.3 Lint passes
- [ ] 5.4 The pull request shows the ci job and both smoke variants as passed

#### Manual

- [ ] 5.5 Before the Google settings exist, the deploy-worker job passes with the skip notice
- [ ] 5.6 After the Google setup, the deploy-worker job deploys the worker, and the health address replies
- [ ] 5.7 With the switch on in production, a demo job reaches done
- [ ] 5.8 A demo job that starts after the worker instance stopped also reaches done
- [ ] 5.9 After the check, the switch variable is removed, and the production check page returns 404
- [ ] 5.10 The Google billing page shows a cost of zero, or a cost that the human accepts
