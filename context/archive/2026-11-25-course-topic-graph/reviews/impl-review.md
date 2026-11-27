<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Course as a Topic Graph

- **Plan**: context/changes/course-topic-graph/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4, 5, 6
- **Date**: 2026-11-27
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Evidence

- Reviewed commit: `26adc43` on `main`. The range `83056f0..26adc43` holds 88 files.
- Plan items checked: 40. Plain matches: 26. Missing files: 0. The 14 lines of "What We're NOT Doing" hold.
- Automated criteria, run again on 2026-11-27: `npm run test:unit` (230 tests), `npm run test:engine` (39 tests), `npm run check:engine`, `npm run lint`, `CI=true npx astro check`, `npm run build`, `npx supabase test db` (256 tests in 5 files), `npm run db:types` with no diff, the worker image, the engine image, the smoke test with the topic steps (89 steps), and the phone check in 5 looks (169 checks). All passed.
- `npx supabase db reset` did not run, to keep the local data of the owner. Each CI smoke job applies the migrations to a clean database, and CI passed on `main`.
- Manual rows: each of the 28 manual rows has evidence in the Notes of `change.md`.
- Checked and found clean: the access checks of the engine routes and the start route, the secret compare, the row level security, the grants and `search_path` of each new table and function, writes across learners, the start trigger inside `complete_job`, SQL and command injection, the HTML and `href` output, secrets in logs and CI, the Cloud Run flags, the lease and abort handling.
- Not verified by reading: the statement timeout of `service_role` in the hosted Supabase against the 60 second limit of `finish_topic_map`. What `claude --safe-mode --tools ""` turns off. The default of `security.checkOrigin` in Astro 7.

## Findings

### F1 — `retry_job` gives topic jobs past the hourly limit

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261124123303_create_jobs.sql:256, supabase/migrations/20261127120000_create_topic_map.sql:351
- **Detail**: The limit of 5 topic jobs in one hour (`RD004`) counts only inserted rows. `retry_job` sets a failed job to `waiting` with 0 attempts. It has no type check and no count, and each signed-in learner can call it through `rpc/retry_job` or `POST /api/jobs/<id>/retry`. A job fails with a retry when no lesson gives a result (`worker/handlers/build-topic-map.ts:412`). Scenario: each lesson of an extension course ends `truncated`. The learner calls the retry in a loop. Each call gives 3 more starts, and each start sends each lesson to the model again. The model budget of all learners goes to one learner. The course page does not show the retry button for a topic job, so only a direct call uses this path.
- **Fix A ⭐ Recommended**: A new migration replaces `retry_job`. It refuses a `build_topic_map` job. The learner uses "Build the topic map" or "Update the map", which insert a new job under the limit.
  - Strength: The limit holds with one small function change. The course page already hides the retry button for topic jobs.
  - Tradeoff: A failed topic job has no retry. The job check page must not offer one for this type.
  - Confidence: HIGH — the insert trigger already holds each rule, and the stored lesson results make a new job continue the work.
  - Blind spot: `load_course` has the same gap with `RD001`. This fix does not close it.
- **Fix B**: Count each retry in the hourly limit, with a new column for the retry time, for `build_topic_map` and `load_course`.
  - Strength: The retry stays for each type, and both limits hold.
  - Tradeoff: A new column and a larger change of the job rules of F-01.
  - Confidence: MEDIUM — the job functions of F-01 need a careful change.
  - Blind spot: No check of the pgTAP tests of F-01 that this changes.
- **Decision**: FIXED via Fix A. `supabase/migrations/20261127200000_fix_topic_map_review.sql` replaces `retry_job`, and 2 pgTAP tests cover it.

### F2 — The live map changes during a build, and a failed finish leaves a mixed map with the status `current`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261127120000_create_topic_map.sql:579, :929, :1087
- **Detail**: The plan says that the map never shows a mix of two runs. `save_lesson_analysis` changes the passages of the live map for each lesson. It deletes the positions that are gone, and the cascade removes their links and relations at once. It writes the new heading path and hash on the other positions, and the old links stay on them. `finish_topic_map` runs only at the end. `topic_links.passage_hash` exists to show a link to an old text, but no reader compares it with `passages.content_hash`. `topic_map_state` does not compare the run of the analyses with the run of the map. Scenario: a reload changes lesson 1 from 5 sections to 3. During the job, the map page shows old quotes below new heading paths, and fewer relations. When `finish_topic_map` fails 3 times, the mix stays, the status is `current`, and the page shows no update button.
- **Fix A ⭐ Recommended**: A new migration changes the 2 page functions. `topic_map_lesson` returns a link only when `passage_hash` equals the `content_hash` of its passage. `topic_map_state` counts a lesson as changed when its analysis has a `run_id` that is not the `run_id` of `course_maps`.
  - Strength: It uses the hash column that the plan made for this case. A map with a failed finish shows `stale` with the update button.
  - Tradeoff: During a build, a changed lesson shows fewer quotes and relations until the finish. The removed relations of deleted positions stay removed.
  - Confidence: MEDIUM — the first change is a filter. The second change needs a look at a run that reuses each lesson, where the analyses keep an older `run_id`.
  - Blind spot: The outline and the overview counts read `course_maps.overview`, which this fix does not change.
- **Fix B**: Write the new passages next to the old passages, with `lesson_hash` in the key, and change over in `finish_topic_map`.
  - Strength: The live map changes only in one transaction, as the plan says.
  - Tradeoff: A change of the unique key, of 3 functions and of the pgTAP tests. The next slices (S-05 reads passages) depend on this key.
  - Confidence: MEDIUM — the design is clear, and the change is wide.
  - Blind spot: No measure of the extra rows for a course of 500 lessons.
- **Decision**: FIXED via Fix A. The same migration replaces `topic_map_lesson` and `topic_map_state`, and 2 pgTAP tests cover them.

### F3 — One topic job has no limit of engine requests

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: worker/handlers/build-topic-map.ts:395, .github/workflows/ci.yml:416
- **Detail**: An extension course holds at most 500 lessons, and a lesson holds at most 1 MB of text. A lesson goes to the engine in groups of 60,000 characters, so 1 MB gives 18 requests. One job can make 9,000 requests, and each request can take 300 seconds two times. The worker runs one job at a time on one instance. So the large course of one learner stops the jobs of each other learner for hours. Each new start also sends each failed lesson again (`:205`).
- **Fix**: Give one job run a limit of engine requests, for example 200. At the limit the handler stops the lesson loop, builds the map from the stored results, and ends `done`. The map then has the status `partial`, and "Update the map" continues under the hourly limit.
  - Strength: It uses the `partial` status and the stored lesson results that exist. No new job type and no schema change.
  - Tradeoff: A large course needs more than one press of the button.
  - Confidence: HIGH — the handler already ends `done` with lessons that have no result.
  - Blind spot: `topic_map_state` counts a lesson with no analysis as changed, so the status can be `stale` and not `partial`. Both show the update button.
- **Decision**: FIXED. `MAX_RUN_REQUESTS = 200` in `worker/handlers/build-topic-map.ts`, with 1 unit test.

### F4 — A `sameAs` answer joins topics with no limit, and the join stays

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: worker/topics/identity.ts:187, worker/topics/build.ts:412
- **Detail**: Each `sameAs` answer joins two name sets, and joins chain. The map build stores the joined names as alias names, and each later run reads the stored alias names as a fixed decision. Scenario: lesson 5 gives "Index" with `sameAs` "Database index". Lesson 9 gives "Index" with `sameAs` "Array index". The two stored topics become one topic, one gets `merged_into`, and the links of other lessons move. A new analysis with a better prompt cannot undo the join. The cause can be a model error or the text of a crawled page. The effect stays in one course of one learner.
- **Fix A ⭐ Recommended**: Keep the code. Record the limit in the roadmap for S-10, which changes the identity check for two courses.
  - Strength: The plan chose this rule ("the older topic stays and the other gets `merged_into`"), and the owner accepted 2 real maps with it.
  - Tradeoff: A wrong join in a course stays until S-10 or a manual fix.
  - Confidence: MEDIUM — the 2 reviewed maps show no wrong join, and 2 maps are a small sample.
  - Blind spot: No count of joins of 2 stored topics in the real maps.
- **Fix B**: Do not join 2 stored topics through one candidate name. Store each `sameAs` join with its source lesson, so a new analysis of that lesson removes it.
  - Strength: A wrong answer for one lesson cannot join 2 stored topics for good.
  - Tradeoff: A change of the identity module, of the state of `finish_topic_map` and of 2 named unit tests.
  - Confidence: MEDIUM — the union of name sets needs a new data shape.
  - Blind spot: The effect on the "MergeTree" case of the plan needs a test.
- **Decision**: FIXED via Fix A. The roadmap records the limit under the Unknowns of S-10.

### F5 — `AGENTS.md` gives wrong facts about the unit tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: AGENTS.md:27, AGENTS.md:77
- **Detail**: Line 77 says "The web app has no unit tests". Line 27 says that `npm run test:unit` runs the worker and extension tests. Phase 4 added `src/lib/topic-map-layout.test.ts`, and phase 6 added `scripts/setup-google.test.mjs`. `test:unit` now also runs `src/**/*.test.ts` and `scripts/**/*.test.mjs`. The next agent reads `AGENTS.md` first and gets the old picture.
- **Fix**: Change the 2 lines to name the 4 test globs, and say that the web app has unit tests for pure modules in `src/lib/`.
- **Decision**: FIXED. `AGENTS.md` names the 4 test globs.

### F6 — The plan text says the old thing in 9 places that the Notes record

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/course-topic-graph/plan.md:99, :335, :415, :467, :594, :643, :651
- **Detail**: Each deviation is in the Notes of `change.md`, and the owner decided or saw each one. The plan still says: no attribution link (it shows at 44 px). `save_lesson_analysis` replaces the passages (it updates them by position). One more try only for a network error and 502 (also 429, 503 and 504). A failed lesson never fails the job (an engine with no answer fails it). A direct insert in the smoke test (it uses the start route). The tap rule for each element in the canvas (it skips a fully clipped element). The overview through dagre (one column). Zoom 1 on a phone (on each screen). `data-status` with 4 values (5, with `building`).
- **Fix**: Add a section "Deviations" at the end of the plan, before "Progress". It lists the 9 items with a pointer to the Notes. Do not change the phase blocks.
- **Decision**: FIXED. The plan has a section "Deviations" before "Progress".

### F7 — Five additions have no record in the plan or the Notes

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: engine/rubber_duck_engine/extract.py:154, engine/rubber_duck_engine/settings.py:69, worker/topics/schema.ts:32, scripts/setup-google.mjs:403, scripts/phone-check.mjs:348
- **Detail**: Each addition is small and helps the plan. The engine sets the retry of the Cognee model call to 1 attempt and wraps `litellm.acompletion`. This reaches into Cognee internals, and a guard stops the engine start when Cognee changes them. The engine has a sixth setting `HOST`. The schema check has 3 more removal reasons (`invalidItem`, `quoteTooLong`, `unknownRelationPassage`). The setup script asks for the model and accepts only `anthropic/...`. The phone check prints SKIP, not FAIL, when the course has no map. The smoke test fails in that case, so CI still sees a lost map.
- **Fix**: Add the 5 items to the "Deviations" section of F6. Add one line to `AGENTS.md`: a Cognee upgrade needs a check of `prepare_cognee`.
- **Decision**: FIXED. The section "Deviations" lists the 5 additions, and `AGENTS.md` has a line about `prepare_cognee()`.

### F8 — A topic name can hold line breaks, and it goes into the system prompt of later requests

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: worker/topics/schema.ts:144, engine/rubber_duck_engine/prompt.py:68
- **Detail**: A topic name is model text with no quote check. The schema check only trims it. The engine writes up to 150 known topics with their alias names into the system prompt of each later request of the course. Scenario: a crawled page makes the model give a name with a line break and a new "rule". That text then sits in the system prompt for the later lessons. The quote check still holds each quote to the lesson text, and the effect stays in one course.
- **Fix**: In `checkAnswer`, write each run of white space in a name, a description and a reason as one space. In `build_system_prompt`, do the same for each name and alias name.
- **Decision**: FIXED. `worker/topics/schema.ts` and `engine/rubber_duck_engine/prompt.py` put each name on one line, with 1 unit test and 1 engine test.

### F9 — The local bridge accepts each local request, and a stop leaves `claude` processes

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/lib/messages-api.mjs:179, scripts/model-bridge.mjs:79, scripts/model-bridge.mjs:122
- **Detail**: The bridge is a local tool for one developer. It has no secret and no `Origin` check. During `npm run engine`, a web page in the browser of the developer can send a `text/plain` POST to `http://127.0.0.1:8791/v1/messages`. Each request starts one `claude` process for up to 300 seconds with the login of the developer. The page cannot read the answer. On Ctrl+C the bridge exits, the child process runs on, and its temporary folder stays.
- **Fix**: `scripts/engine.mjs` makes a random key for each start, and the bridge refuses a request with a wrong key or with an `Origin` header. The bridge keeps its child processes in a set and stops them on a signal.
- **Decision**: FIXED. `scripts/engine.mjs` makes a new `MODEL_KEY` for each start. The bridge and the fake model refuse a request with another key or with an `Origin` header, and the bridge stops its `claude` runs on a stop. 4 unit tests.

### F10 — Row 6.9 has two cost figures for the same build

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/course-topic-graph/change.md (Notes, phase 6, row 6.9)
- **Detail**: The engine log gives 47,509 input and 53,803 output tokens for the production build, about 0.032 USD at the list price. The Anthropic usage page showed 0.0079 USD at the time of the check. The owner accepted the cost. The Notes do not explain the gap, and the statement "5 USD covers about 55 builds" depends on the higher figure.
- **Fix**: Read the Anthropic usage page again on 2026-11-28 or later, and write the final figure into the Notes of row 6.9.
- **Decision**: ACCEPTED. The owner accepts the gap between the 2 figures. The Notes keep both figures.
