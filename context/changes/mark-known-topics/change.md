---
change_id: mark-known-topics
title: Mark known topics
status: impl_reviewed
created: 2026-11-27
updated: 2026-11-28
archived_at: null
---

## Notes

Roadmap item S-03 of milestone M-01 (FR-005). A learner marks the topics of a course that they believe they already know. The marks are the first learner data of the product. S-04, S-05 and S-06 read them. The plan came from `/10x-plan mark-known-topics` on 2026-11-27.

The owner asked on 2026-11-28 to run all phases with `/10x-implement` with no interaction: the agent takes the recommended option of each question and runs the checks itself. The owner reviews the history afterwards. A subagent wrote the code of each phase. The parent agent ran the gates, the break checks and the commits.

### Local test setup (2026-11-28)

- The gates need Node 26.13.0 (`.nvmrc`). The default shell had Node 22.22.3, and `npx astro check` refuses it. Prefix the commands with `PATH="$HOME/.nvm/versions/node/v26.13.0/bin:$PATH"`.
- `ALLOW_PRIVATE_COURSE_URLS`, `ALLOW_LOOK_OVERRIDE`, `OAUTH_PROVIDERS` and `ENABLE_JOB_CHECK` are public server settings in `astro.config.mjs`. Astro writes them into the bundle at build time. So they must be in `.dev.vars` before `npm run build`, not only before `npm run preview`. The first smoke run of phase 2 failed with `url_private` for this reason.
- The local `.dev.vars` has no test flags. For each test run the agent copied the file, added the three flags, built, ran the checks, and then put the copy back byte for byte.
- Services: the fixture site on 8799, `ENGINE_PORT=8792 MODEL_PORT=8793 npm run engine -- --fake`, the worker with `TOPIC_ENGINE_URL=http://127.0.0.1:8792`, and `npm run preview -- --port 4322`. In Astro 7, `astro preview` runs as a daemon. Stop it with `npx astro preview stop`.
- Before the worker started, the agent checked the job queue: no topic job waited, so no real map ran against the fake model.

### Phase 1: learner events and the topic list (2026-11-28)

- `npx supabase migration up` applied `20261127230000_create_learner_events.sql` to the local database. No existing row changed.
- pgTAP: 6 files, 285 tests, with 25 in `learner_events_test.sql`. Break check: with the insert check turned off inside a rolled-back transaction, tests 13 and 23 failed.

### Phase 2: state function and marks route (2026-11-28)

- Unit tests: 266, with 30 new. Break checks: no merge walk gave 5 failures, an id in both lists gave 1, and no loop stop in `checklistLessons` gave 1.
- Smoke: 95 steps passed, with the 6 new mark steps.

### Phase 3: checklist page and panel control (2026-11-28)

- Phone check: `LOOKS=all`, all checks passed, with the checklist page in 5 looks at 375 and 320 px. Smoke: 98 steps passed, with 3 new checklist steps.
- Manual checks in headless Chromium against the preview, on the local docs course "Get started with ClickHouse" of the S-02 test account (15 lessons, 101 topics):

  | Row | Result |
  | --- | --- |
  | 3.5 | One toggle saved in 101 ms. "Mark all" in the 15 lessons took 15 clicks and 1.0 s for 101 topics, and "Clear all" took 1.0 s. A reload showed 101 of 101 marks. The row waits for the judgment of the owner. |
  | 3.6 | Lesson 1 (16 topics): one mark, then "Mark all", then "Undo". Only the first topic kept its mark after a reload, and the Undo button was gone. |
  | 3.7 | The "Known" control of the panel went from not pressed to pressed, and the checklist showed the mark after a reload. |
  | 3.8 | With JavaScript off, a click saved the mark and the page came back at `known?notice=marks_saved#lesson-1` with "Marks saved.". A second click removed the mark. |
  | 3.9 | A mark on a parent topic kept its child with no mark after a reload. |

- The course ended with 0 of 101 marks. The checks wrote events for the test account only.

### Phase 4: production and records (2026-11-28)

- The roadmap holds the four records: the answer to the S-03 unknown, the S-03 part of Open Roadmap Question 13, the S-06 note about questions from general to detailed topics, and the parked map idea.
- Rows 4.2 to 4.4 are human actions. The agent did not push the branch, did not run `npx supabase db push`, and did not merge.
- The owner steps, in this order:
  1. Review the branch `mark-known-topics`. It starts from `course-topic-graph-review` (`4cc6827`, the archive commit of S-02, which is not on `origin` yet).
  2. Apply the migration to production with `npx supabase db push`.
  3. Push the branch, open the pull request, and merge it after CI passes.
  4. Check row 4.2 with `gh run list --branch main --limit 1`, then mark topics of a real course in production (row 4.4).

### Implementation review (2026-11-28)

- The full review is `reviews/impl-review.md`: verdict NEEDS ATTENTION, with 0 critical findings, 3 warnings and 6 observations. Plan drift: 0 DRIFT, 0 MISSING, no scope creep.
- The agent took the recommended option of each finding: 7 fixed (F1 to F6, F9), F7 skipped, F8 accepted.
- `supabase/migrations/20261128020000_fix_learner_events_review.sql` (F1, F2): two indexes, and a limit of 2,000 events of one learner in one hour (RD005, HTTP 429). The production push of row 4.3 must apply both migrations.
- `KnownTopicList.tsx` (F3): the focus goes to "Undo" after "Mark all" or "Clear all", to the lesson heading after "Undo", and back to the button after a failure. The lesson count is a polite live region.
- Tests (F4, F5): pgTAP for the server time, the indexes and the limit, a unit test of `topicParents`, and a smoke step that expects 403 for a form post from another site.
- `AGENTS.md` (F6) and the comment of `topicStates` (F9).
