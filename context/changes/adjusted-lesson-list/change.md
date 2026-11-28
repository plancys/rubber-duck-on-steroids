---
change_id: adjusted-lesson-list
title: Adjusted lesson list
status: impl_reviewed
created: 2026-11-28
updated: 2026-11-28
archived_at: null
---

## Notes

Roadmap item S-04 of milestone M-01 (FR-008, US-01), the north star of the milestone. The learner gets a lesson list that fits the topics they know. The rule skips a lesson when the learner knows every topic that it explains. It also moves a needed lesson up. The Lessons section of the course page shows the list. The plan came from `/10x-plan adjusted-lesson-list` on 2026-11-28. It answers the S-04 part of Open Roadmap Question 1 (Linear RUB-5).

### Run without interaction (2026-11-28)

- The owner asked on 2026-11-28 to run all phases with `/10x-implement` and no interaction. The agent takes the recommended option of each question and runs the checks itself. The owner reviews the history afterwards.
- A subagent wrote the code of each phase. The parent agent ran the gates, the break checks and the commits.
- The branch `adjusted-lesson-list` starts from `origin/main` (`d8ef1fe`). It has no upstream, so a push needs an explicit target.

### Phase 1: course lesson map (2026-11-28)

- `npx supabase migration up` applied `20261128120000_create_course_lesson_map.sql` to the local database. No existing row changed.
- pgTAP: 7 files, 300 tests, with 10 in `course_lesson_map_test.sql`. Break check: inside a rolled-back transaction, a copy of the function that counts `mentions` links made test 6 fail.

### Phase 2: rule function (2026-11-28)

- Mismatch: the snippet of the plan moved lesson 3 before lesson 2 when the two lessons need each other. The approved rule says that such lessons keep the course order. The agent took "Adapt and continue" toward the approved rule. Inside a loop, the walk drops each need of an earlier lesson on a later lesson. Tarjan's algorithm finds the loops. Each move still has a real topic pair as its reason.
- Unit tests: 282, with 15 new. Break checks: a skip on one known topic made 2 tests fail, and a walk with no loop step made the loop test fail.

### Phase 3: course page (2026-11-28)

- Adaptations: the smoke steps use fixture lesson 3, not lesson 1. The checklist steps leave a mark on the only topic of lesson 1, so lesson 1 is already skipped when the new steps start. For one topic, the texts are "You know the 1 topic it explains." and "You know 0 of 1 topic it explains.".
- Gates: 282 unit tests, lint, astro check and the build pass. `LOOKS=all npm run phone-check`: all 180 page checks passed. The "Mark all" click saved 1 mark on the course of the phone check, so each look showed a skipped lesson. Smoke: 91 steps passed, with 3 new lesson path steps, and 2 steps skipped by their flags.
- Local setup, as in CI: `.dev.vars` got `ALLOW_LOOK_OVERRIDE`, `OAUTH_PROVIDERS` and `ALLOW_PRIVATE_COURSE_URLS` before the build. The agent kept a byte copy and put it back after the checks. The services were the fixture site on 8799, the engine with the fake model on 8792 and 8793, the worker on 8788, and the preview on 4322. No job waited before the worker started.
- Manual checks in headless Chromium against the preview, on the local docs course "Get started with ClickHouse" (`560b7697`) of the test account `verify-map+1795799108339@example.com`:

  | Row | Result |
  | --- | --- |
  | 3.5 | "Mark all" in the section of lesson 6 marked its topics. The course page showed lesson 6 with "Skipped" and "You know all 5 topics it explains.", and the summary "Adjusted to the topics you know: 1 of 16 lessons skipped, 0 moved up.". The link of lesson 6 opens `https://clickhouse.com/docs/get-started/use-cases/real-time-analytics` in a new tab. |
  | 3.6 | The topic link "Real-time analytics" of lesson 6 opened `/known#lesson-6`. One click removed the mark, and after a reload lesson 6 showed "You know 4 of 5 topics it explains.". |
  | 3.7 | With no marks, lesson 2 showed `"Table parts" needs "MergeTree". No lesson explains it. Lesson 3 mentions it.`, and the order was 1 to 16. A mark on "MergeTree" or on "Table parts" removed the note, and the order stayed the same. An unmark brought the note back. |
  | 3.8 | This row needs the judgment of the owner, so it stays open. |

- With no marks, the docs course shows 6 gap notes on lessons 1, 2, 3, 8 and 9. The plan says 2. The rule counts each prerequisite that no lesson explains, and the query behind the plan counted only the backward relations.
- The first run of the browser script marked "Background merges" in place of "Table parts", because it picked the first checklist row with the text "Table parts". The second run picked the rows by topic id. The course ended with no mark.

### Phase 4: production and records (2026-11-28)

- The roadmap holds the S-04 records: the answer to the S-04 unknown, the S-04 part of Open Roadmap Question 1, and the note in the backlog row of S-04. The check of row 4.1 counts 3 records.
- Rows 4.2 to 4.4 are human actions. The agent did not push the branch, did not run `npx supabase db push`, and did not merge.
- The owner steps, in this order:
  1. Review the branch `adjusted-lesson-list`. It starts from `origin/main` (`d8ef1fe`).
  2. Apply the migration `20261128120000_create_course_lesson_map.sql` to production with `npx supabase db push`.
  3. Push the branch, open the pull request, and merge it after CI passes.
  4. Check row 4.2 with `gh run list --branch main --limit 1`. Then open a real course with marks in production (row 4.4).

### Implementation review (2026-11-28)

- The full review is `reviews/impl-review.md`: verdict NEEDS ATTENTION, with 0 critical findings, 1 warning and 8 observations. Plan drift: 0 DRIFT and 0 MISSING.
- The agent took the recommended option of each finding: 8 fixed (F1 to F8, F5 through Fix A), and F9 accepted.
- Gates after the fixes: 283 unit tests, lint, astro check, the build, pgTAP (300 tests), the phone check (180 page checks, and the new check found a skipped lesson), and the smoke test (91 steps). The first smoke run failed one sign-in step with 429, because a browser check used the sign-in limit just before it. The second run passed.
- The local setup ended clean. `.dev.vars` is back byte for byte, and the build has no test flags. The agent stopped the preview, the worker, the engine and the fixture site.
- During the run, the owner committed `f2059bf` on this branch. It adds a Linear status step to `/10x-implement` and `/10x-archive`. The phases ran with the earlier version of `/10x-implement`, so the agent did not move RUB-11 at the start.

### Production (2026-11-28)

- The owner approved the merge and the archive. The agent pushed the branch and opened pull request #12. CI passed: `ci` in 1 min 21 s, `smoke (full)` in 4 min 16 s, and `smoke (without-sample)` in 5 min 26 s. The agent merged it as `1b9105f`.
- CI run 46130378573 on `main` passed in all six jobs (row 4.2). The `deploy` job applied `20261128120000_create_course_lesson_map.sql` to production at 09:31 UTC, before it deployed the Worker (row 4.3). The owner did not push the migration by hand, because the deploy job does it first.
- Rows 3.8 (the judgment of the skips) and 4.4 (a real course with marks in production) wait for the owner.
