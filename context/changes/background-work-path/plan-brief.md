# Path for Background Work — Plan Brief

> Full plan: `context/changes/background-work-path/plan.md`

## What & Why

The product needs a path for work that takes longer than one page request. A learner starts a job, a worker outside the web app does the work, and the learner sees the progress and the result. Course loading (S-01) and the topic graph (S-02) both need this path, so it comes first as roadmap item F-01.

## Starting Point

The web app runs on Cloudflare Workers. A Worker gets 30 seconds after a response and 10 ms of CPU on the Free plan, so it cannot do long work. The repo has no job table, no worker and no unit test runner.

## Desired End State

A signed-in learner starts a demo job on a check page and sees "Waiting", then "Step 2 of 5", then "Done", with no manual reload. A failed job shows a short reason and a "Try again" button. The work runs in a small container that is the same on the developer machine, in CI and on Google Cloud Run.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Where long work runs | A job table plus a portable Node worker | It has no link to one provider and no time or CPU limit. |
| First production home | A Google Cloud Run service | It starts on a request and pauses when idle, as the user asked. |
| Run mode on Cloud Run | Instance-based billing, and a reply to the wake request at once | The same contract runs on every host, and a job starts in seconds. |
| Worker credential | The Supabase service key | The user selected the least setup over a narrow database role. |
| Jobs for each learner | One job in progress (waiting or running) | One rule bounds the cost for each learner. |
| Failure | Up to 3 attempts, then "Failed" with a reason and "Try again" | Short network problems heal without a click. |
| Progress view | Status, step text and count, refreshed every 3 seconds | It gives honest progress with little machinery. |
| Demo job | It stays behind a switch that is off in production | CI tests the path on every change, and learners see no demo page. |
| Extra scope | None: no cancel, no email, no list of past jobs | The foundation stays the smallest path. |
| Tests | Smoke steps, pgTAP tests and unit tests on `node --test` | The logic that is hardest to see gets direct tests with no new dependency. |
| Worker deploy | A deploy job in CI | The user selected one pipeline for both parts. |
| Google sign-in from CI | Workload Identity Federation | The repo and GitHub hold no Google key. |

## Scope

**In scope:**

- A `jobs` table with access rules, and six database functions that hold the lease, the attempt and the retry rules.
- A worker with zero dependencies in `worker/`, with a wake address, a health address and a demo job.
- Three routes, one helper module, one status component and one check page in the web app.
- Unit tests, pgTAP tests, smoke steps, and two added steps in the CI smoke job.
- A container image, a `deploy-worker` job, and README steps for the Google setup.

**Out of scope:**

- Cancel of a job, a message when a job ends, and a list of past jobs.
- Real job types. S-01 and S-02 add them.
- Checkpoints inside a job. A job that starts again runs from its first step.
- A narrow database role, Cloud Run jobs, Cloud Scheduler, and a live push of the status.

## Architecture / Approach

The job table is the source of truth, and the database functions own the job rules. The web app writes a job row and sends one short wake request. The worker takes jobs through a lease, reports each step, and ends each job. The page reads the status every 3 seconds.

```
Learner page -- start --> Web app -- insert --> jobs table <-- claim, heartbeat, complete -- Worker
     |                      |                                                                  ^
     +-- status, 3 s -------+------------------- POST /wake (short) ---------------------------+
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Job table and rules | The table, the access rules, the functions and their pgTAP tests | A gap in the grants lets a learner change a job. |
| 2. Worker | The worker, the demo job, the unit tests and a local launcher | A lost lease or a stop signal handled in the wrong order. |
| 3. Web app path | The routes, the wake request and the check page | The status route goes over the 10 ms CPU limit of the Free plan. |
| 4. Tests in CI | Smoke steps, the phone check and two added CI steps | A slow worker start makes the smoke job fail at random. |
| 5. Production home | The container, the `deploy-worker` job and the README steps | The Google setup is manual and has many steps. |

**Prerequisites:** Docker for the local Supabase, Node 26.13.0, and a branch named `background-work-path`. Phase 5 also needs a Google Cloud account with a payment card.

**Estimated effort:** About 5 sessions, one for each phase. Phase 5 also needs time from the human for the Google setup.

## Open Risks & Assumptions

- The free amounts of Cloud Run are not confirmed. The sources disagree. The plan asks the human to set a budget alert and to read the bill one day after the check.
- Cloud Run can stop an instance that has no requests. The plan handles that with the lease and with `release_job`, but a job that is longer than an instance life needs checkpoints. That is work for S-01 and S-02.
- Every later job type must be safe to run two times, because a job can start again.
- The Supabase service key passes all access rules. It must stay in the worker environment only.
- The switch hides the check page, but the database still accepts a demo job from a signed-in user. The rule of one job in progress bounds that.

## Success Criteria (Summary)

- A learner starts a demo job and sees it reach "Done" without a reload, on a local machine and in production.
- A failed job shows a reason, and "Try again" starts it again.
- CI fails when a change breaks the job path.
