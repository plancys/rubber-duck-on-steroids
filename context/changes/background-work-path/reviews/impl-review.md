<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Path for Background Work

- **Plan**: context/changes/background-work-path/plan.md
- **Scope**: Full plan (completed phases only; Phase 5 has open production rows)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-24
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — The check switch does not stop a direct insert of a demo job

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261124123303_create_jobs.sql:65-79, src/pages/api/jobs/index.ts:23
- **Detail**: Only `POST /api/jobs` checks `ENABLE_JOB_CHECK`. The insert policy and the column grant let any signed-in user insert a `demo` job through the Supabase REST API with their own token, also in production. The worker runs it, and `GET /api/jobs/<id>` and the retry route also work without the switch. The demo is bounded, but with one worker instance many accounts can keep the worker busy.
- **Fix A ⭐ Recommended**: The worker refuses the `demo` type unless its own setting `WORKER_ALLOW_DEMO` is on (CI and local on, production off).
  - Strength: One small change in worker/handlers/index.ts and the launcher. The rule sits where the work runs.
  - Tradeoff: A demo row still lands in the table and fails with "This kind of work is not available."
  - Confidence: HIGH — the handler registry already returns that reason for an unknown type.
  - Blind spot: The production check (row 5.7) then needs the setting on Cloud Run too.
- **Fix B**: Remove the learner's insert grant and add a `create_job` function that accepts only allowed types.
  - Strength: No unwanted row reaches the table at all.
  - Tradeoff: A new migration, new tests, and a changed start route. Each later job type changes the function.
  - Confidence: MEDIUM — the allowed-type rule needs a place to live in the database.
  - Blind spot: How S-01 and S-02 will start their jobs is not designed yet.
- **Decision**: FIXED (Fix A): worker/handlers/index.ts, worker/main.ts, scripts/worker.mjs, deploy-worker env, README production check, new test worker/handlers/index.test.ts

### F2 — The job payload has no size limit

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261124123303_create_jobs.sql:11
- **Detail**: `notes` limits its free-text columns with check constraints. `jobs.payload` has no limit, and with F1 a user can store a payload of many MB that the worker then reads whole.
- **Fix**: Add a new migration with `check (pg_column_size(payload) <= 4096)` and one pgTAP assertion.
- **Decision**: FIXED: migration 20261124170000_limit_job_payload.sql and one pgTAP assertion (71 pass)

### F3 — The service key reaches Cloud Run as a plain environment variable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml (deploy-worker, env_vars) — Phase 5 code, outside the reviewed phases
- **Detail**: Any Google account that can view the service sees `SUPABASE_SERVICE_KEY` and `WORKER_WAKE_SECRET` in the revision settings. The service key passes all access rules. The plan chose plain variables, and the README warns about it.
- **Fix**: Store both values in Google Secret Manager and use the `secrets:` input of `deploy-cloudrun`.
  - Strength: The values do not show in the console.
  - Tradeoff: More Google setup steps and one more role for the runtime account.
  - Confidence: HIGH — the action supports `secrets:` directly.
  - Blind spot: Not tested, because the Google setup does not exist yet.
- **Decision**: FIXED: deploy-worker reads SUPABASE_SERVICE_KEY and WORKER_WAKE_SECRET from Secret Manager (secrets: input); README setup step 9 and AGENTS.md updated. Untested until the Google setup.

### F4 — A handler that ignores the stop signal can overlap the next job

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: worker/run.ts:89-110
- **Detail**: After an abort, the loop stops waiting for the handler and takes the next job. The demo handler stops on the signal, but a later handler that ignores it runs in parallel.
- **Fix**: State in the `Handler` type comment that a handler must stop when `signal` aborts.
- **Decision**: FIXED: the Handler type comment says that a handler must stop on the signal (worker/run.ts).

### F5 — The status poll has no backoff after errors

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/hooks/useJobStatus.ts:32-47, src/pages/api/jobs/[id]/index.ts:42
- **Detail**: On a 500, a 503 or a network error the page asks again every 3 seconds without end. While a job is stale, each poll also sends a wake request.
- **Fix**: Stop after 5 errors in a row, and show the "unknown" text.
- **Decision**: FIXED: the status hook stops after 5 failed requests in a row and the page shows a reload note (useJobStatus.ts, JobStatus.tsx).

### F6 — A stop during the retry wait gives back a failed attempt

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: worker/run.ts:226-236
- **Detail**: The worker calls `release_job` when a stop comes during the wait after a failure, so that failure does not count. With frequent restarts, a failing job can start more than 3 times.
- **Fix**: Call `fail_job` in that path.
- **Decision**: FIXED: a stop during the wait after a failure calls fail_job, not release_job; new unit test in worker/run.test.ts.

### F7 — Nothing removes old jobs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261124123303_create_jobs.sql
- **Detail**: Done and failed jobs stay in the table. This is fine for the demo, but S-01 and S-02 add real volume.
- **Fix**: Add a retention rule in the plan of S-01.
- **Decision**: FIXED: the retention question is an Unknown of S-01 in context/foundation/roadmap.md.

### F8 — Small additions beyond the plan

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .github/workflows/ci.yml:117-124, src/pages/api/jobs/[id]/retry.ts, src/pages/api/jobs/[id]/index.ts, src/lib/jobs.ts:54-90
- **Detail**: The worker log in the CI cleanup step, the extra error codes and texts of the routes, and helper exports. All are within the plan's intent, and the bar fix was approved.
- **Fix**: None needed. Accept as is.
- **Decision**: ACCEPTED: the additions stay as they are.
