# Appendix: effort estimate for the slices of M-01

This file is an appendix to `../research.md`, for the third follow-up of 2026-11-25. It is a short form of the report of one read-only worker. The worker read the roadmap, the PRD, the plan of S-01, the git history and the code. It did not read `research.md`. It ran no build, no test and no network call.

Marks: **F** is a fact from a file or from git. **J** is a judgment of the worker. The researcher read each `file:line` of sections 4 to 6 again on 2026-11-25. All hours are J, and they count the time of the owner.

## 1. The design that the worker estimated

- One new job type in the worker that exists. It makes one model call for each lesson, and code checks each answer.
- Tables with row-level security for each learner: passages, topics with alias names and two lifecycle columns, relations, links from a topic to a passage, an append-only event table, and questions.
- A learner state with four values, from a pure function over the events.
- One React island with `@xyflow/react` and `@dagrejs/dagre`, and an outline list from the server.
- Model calls for the questions of S-06 and the summaries of S-09. The topic job runs again on a second course for S-10.
- No new service, no embeddings and no second database.

This design is composition C0 of `research.md` (R.6), with one more relation type: "part of".

## 2. Calibration from the history

1. F-01: 8.5 hours elapsed on 2026-11-24, with 2,829 lines (F). This time matches the roadmap commit at 08:45 and the review commit at 17:15.
2. S-01: 22.9 hours elapsed, with a night gap of 9.9 hours, and 8,390 lines (F). J: 13 to 15 active hours.
3. One implement phase of S-01 took 15 to 71 minutes. The plan of S-01 took 3.8 hours (F, commit times).
4. S-01 grew by 24% after its plan, with 10 review findings and one setup script (a measure of the worker).
5. The research of S-02 took 4.6 hours (F, file times). The hours below do not include it.

The line counts of the worker exclude lock files, context files and generated types. So they are lower than the counts in `project-maturity.md`, section 4.

## 3. Estimates for each slice

| Slice     | Work items                                                                                                                                                                                                                                                                                  | Optimistic | Likely | Pessimistic |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ----------- |
| S-02      | Database: 4 tables with row-level security, the job type, a quota, a lesson hash. Worker: a passage splitter, the model call, the checks, a rule path with no model. Web: a start route, the map island, the outline. Tests: pgTAP, unit, smoke, the phone check. Prompt runs on real text. | 12         | 20     | 36          |
| S-03      | Database: the event table. A pure state function. Web: quick marks with undo. A smoke test.                                                                                                                                                                                                 | 3          | 5      | 9           |
| S-04      | The decision on the rule. Database: a read of the topics of each lesson. A pure list function. A page with reasons. A check on a real course.                                                                                                                                               | 5          | 8      | 15          |
| S-05      | The first lesson reader: a Markdown render, a sanitizer, text styles. Collapsed blocks, and an undo event.                                                                                                                                                                                  | 5          | 8      | 16          |
| S-06      | Database: questions, an answer function, the job type, a quota. Worker: the question job, a path with no model. Web: the quiz page. A review of the questions.                                                                                                                              | 7          | 11     | 22          |
| S-07      | The overlay prop, a legend, counts for each part, and state colors in the 5 looks of the app (`src/styles/themes.css`).                                                                                                                                                                     | 2          | 3.5    | 7           |
| S-08      | The view of one part, the state in the URL, and a topic page with quotes.                                                                                                                                                                                                                   | 3          | 5.5    | 10          |
| S-09      | Database: a summary cache, the job type, a quota. Worker: the summary job, a path with no model. Web: the summary block. A review of the summaries.                                                                                                                                         | 4          | 7      | 13          |
| S-10      | A limit for the topic list in the prompt. A view of the new topics. A second fixture course. A second real material, and a review of the matches.                                                                                                                                           | 6          | 10     | 22          |
| **Total** | Each row includes the plan, the review and the pull request.                                                                                                                                                                                                                                | **47**     | **78** | **150**     |

## 4. Work that agents do not make faster

J: code takes about 25 of the 78 likely hours. This table gives the rest.

| Work                                                                                                                                                | Likely hours     | Slices                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------- |
| Plans, review decisions, pull requests, CI waits                                                                                                    | 28               | All                          |
| Two owner decisions: Roadmap Questions 1 and 14 (`context/foundation/roadmap.md:249,262`)                                                           | Inside the plans | S-04, S-05, S-06, S-10       |
| The owner reads model output against real course text                                                                                               | 15               | S-02, S-04, S-06, S-09, S-10 |
| Visual checks of the map and the reader                                                                                                             | 6                | S-02, S-05, S-07, S-08       |
| Production: 7 open rows (`context/changes/background-work-path/plan.md:698-702`, `context/archive/2026-11-24-load-course-from-url/plan.md:547-548`) | 4                | S-02, S-06, S-09             |

## 5. Work items that the design text does not name

J: the table of section 3 includes these items, at about 30 likely hours.

| Item                                                                                                                                       | Evidence                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| A lesson identity and a hash column                                                                                                        | Section 6, fact 1                                       |
| A chain of jobs: one topic job for many pushes, and a start that catches up                                                                | Section 6, fact 2                                       |
| A payload trigger and a quota for 3 paid job types. A learner can insert a job row.                                                        | `supabase/migrations/20261124123303_create_jobs.sql:79` |
| A path with no model key in CI for topics, questions and summaries                                                                         | `.github/workflows/ci.yml:116`                          |
| Worker: no method reads lesson text. The model call has no retry and a limit of 4,096 output tokens. No guard limits the size of a lesson. | `worker/queue.ts:75-82`, `worker/llm.ts:105,112`        |
| A lesson reader: no page shows lesson text. J: crawled Markdown needs a sanitizer.                                                         | `src/pages/dashboard/courses/[id].astro:44`             |
| The phone check: a tap target needs 44 px, and no element can pass the right edge. J: a map canvas fails the check.                        | `scripts/phone-check.mjs:30,122-141`                    |
| A long job in production: the reply to the wake request goes out first. J: an idle service can stop the job.                               | `worker/main.ts:89-91`                                  |
| A hidden answer key, error states, a script to test prompts, and unit tests for the web app                                                | J                                                       |
| The extension needs no change. Its Stop button sends no call to the product.                                                               | `extension/src/popup.ts:111-119`                        |

## 6. Code facts

**Fact 1: the rows of `lessons`.** File: `supabase/migrations/20261125120000_harden_course_load.sql`.

- F: a reload deletes the old rows (`:104-106`) and inserts rows with new ids (`:113-122`). A lesson that loaded before and fails now keeps its row (`:95-102`).
- F: an extension push updates the row of a known URL in place (`:238-245`). It inserts a row for a new URL (`:259-273`).
- F: the push starts no job (`src/pages/api/extension/pages.ts:64-80`).
- F: `lessons` has no hash column and no `updated_at` column (`supabase/migrations/20261124200800_create_courses.sql:34-53`).
- J: a passage key on the lesson id does not survive a reload.

**Fact 2: one job in progress.** File: `supabase/migrations/20261124123303_create_jobs.sql`.

- F: the rule is a unique partial index on `jobs (user_id)` for the states `waiting` and `running` (`:30-33`).
- F: the insert policy needs `auth.uid()` (`:65-69`). The extension route uses a token and no session of the learner (`src/pages/api/extension/pages.ts:64-74`).
- F: the runner calls `complete_job` after the handler returns (`worker/run.ts:241-244`). So the load handler cannot insert the topic job.
- F: one worker loop serves all learners (`worker/run.ts:160-171`).
- J: one database function must end the load and insert the topic job. A push needs a start through a `security definer` function.

**Fact 3: the lesson text.**

- F: headings stay as `#`, `##` and `###` (`worker/courses/markdown.ts:6-11`, `worker/courses/markdown.test.ts:5-7`).
- F: a lesson holds at most 1 MB of Markdown (`supabase/migrations/20261124200800_create_courses.sql:44`). A course gets at most 200 lessons from the model pick (`worker/llm.ts:10-11`).
- F: the repository holds fixture lessons of about 1 KB only. The worker did not query the local database.
- J: a documentation lesson has 3 to 30 KB, about 1,000 to 8,000 tokens.
- Note of the researcher: section 1 of `research.md` measured 16 lessons with 65,103 characters and 4 lessons with 20,618 characters in the local database.

## 7. Verdict of the worker

- J: the total is 47 to 150 hours, with 78 as the likely value and 85 as the expected value.
- J: ten days of 8 hours hold 80 hours. All nine slices then fit with about 40% confidence.
- J: at the pace of 2026-11-24, 10 days hold about 110 hours. The confidence is then about 70%.
- F: the milestone also needs F-01, which has the status `in-progress` (`context/foundation/roadmap.md:27,44`).

Risks (J):

1. The quality of the topics on real text in S-02. Each later slice inherits its errors.
2. Two open decisions block S-04, S-05, S-06 and S-10, with 37 likely hours.
3. The job and data rules of facts 1 and 2, and a production worker with no proof.

The order to move slices out (J): S-10, then S-09, then S-08. The other six slices need 55.5 likely hours.

Recommendation (J): do not commit to all nine slices in 10 working days. Commit to S-02 to S-08, and keep S-09 and S-10 optional.

## 8. Delta for Cognee in the MVP (2026-11-26)

The same worker estimated two forms of Cognee on top of the table of section 3. It read the Cognee code (commit `1961133`) and this repository. It ran nothing. Cognee paths are paths in the Cognee repository. The researcher read each `file:line` of this section again.

- Form K1: Cognee as a library in a separate Python container. Each run starts with empty stores, and our tables stay the system of record.
- Form K2: Cognee as the store of the map, with one dataset for each learner. The web app reads the map from Cognee.

### Extra work, in hours (optimistic, likely, pessimistic)

| Item                                                                                                                             | K1             | K2               |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------- |
| Container, entry point, memory size                                                                                              | 3, 5, 10       | 4, 7, 14         |
| Deploy, secrets, setup script, docs                                                                                              | 4, 7, 14       | 5, 9, 18         |
| Job contract from Node to Python                                                                                                 | 2, 4, 8        | none             |
| Mapping: our `DataPoint` model, the prompt, chunk to passage                                                                     | 4, 8, 16       | 4, 8, 16         |
| Configuration: embedder, telemetry, preflight, access control                                                                    | 2, 3, 6        | 2, 4, 8          |
| Local development                                                                                                                | 2, 3, 6        | 2, 4, 8          |
| CI with no model key and a fake model. F: a custom model needs the `llm` extractor (`cognee/api/v1/cognify/cognify.py:519-523`). | 4, 6, 12       | 5, 9, 18         |
| Hardening, cold start                                                                                                            | 2, 3, 7        | 2, 4, 8          |
| Prompt runs again on Cognee chunks                                                                                               | 2, 4, 8        | 2, 4, 8          |
| A graph store that separates the learners                                                                                        | none           | 6, 12, 30        |
| A private schema and a role on Supabase                                                                                          | none           | 3, 6, 12         |
| Web sign-in to Cognee. F: the register route is always on (`cognee/api/client.py:389-393`).                                      | none           | 5, 10, 20        |
| Web reads the map, with error states                                                                                             | none           | 4, 8, 16         |
| Marks on node ids after a merge or a delete                                                                                      | none           | 4, 8, 16         |
| A changed lesson needs a full new run. F: `cognee/api/v1/update/update.py:453-457`                                               | none           | 4, 8, 16         |
| Privacy tests outside pgTAP                                                                                                      | none           | 3, 6, 12         |
| **Sum**                                                                                                                          | **25, 43, 87** | **55, 107, 220** |

### C0 work that Cognee removes

| C0 item                                                                                                                                 | Saved hours (optimistic, likely, pessimistic) |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| The model call of S-02 and its parse                                                                                                    | 1, 2, 3                                       |
| The name rule of S-02. F: `cognee/infrastructure/engine/models/DataPoint.py:217-247`                                                    | 0, 0.5, 1                                     |
| K2 only: the topic, relation and link tables with row-level security                                                                    | 2, 4, 7                                       |
| The passage splitter. J: S-05 needs our passages.                                                                                       | 0                                             |
| The summaries of S-09. F: the default summary lists types and relations, with no model call (`cognee/modules/cognify/config.py:18-22`). | 0                                             |
| The matching of S-10. J: a run with empty stores sees no earlier dataset.                                                               | 0                                             |

### Totals

| Composition | Hours (optimistic, likely, pessimistic) | Fits 80 likely hours                                | Order to move slices out     |
| ----------- | --------------------------------------- | --------------------------------------------------- | ---------------------------- |
| C0          | 47, 78, 150                             | All nine slices, with about 40% confidence          | S-10, S-09, S-08             |
| C0 + K1     | 71, 118.5, 233                          | S-02 (60.5), S-03, S-04 and S-07: 77 hours          | S-10, S-09, S-08, S-06, S-05 |
| C0 + K2     | 99, 178.5, 359                          | No set of slices. S-02 alone needs about 113 hours. | All slices after S-02        |

### Largest new risks (J)

1. The privacy of learners in K2. No Neo4j isolation option runs on our stack. F: with isolation off, all datasets share one graph (`cognee/context_global_variables.py:149-170`).
2. Chunks are not passages. F: an explicit chunk size stops at the input limit of the embedder (`cognee/infrastructure/llm/utils.py:51-76`). J: a local fastembed model gives about 512 tokens, so a lesson of 5,000 tokens needs about 10 calls. A vendor embedder avoids this, and it adds a paid key.
3. A second production service with no proof. F: five production rows of F-01 are still open (`context/changes/background-work-path/plan.md:698-702`).

### Decisive findings (F)

1. A custom graph model skips the entity merge. Cognee stores the result under `chunk.contains` as it is (`cognee/tasks/graph/extract_graph_from_data.py:165-172`).
2. A deterministic id comes only from `identity_fields`. Without them, the id is a random UUID4 (`cognee/infrastructure/engine/models/DataPoint.py:189-201`).
3. The relational base of Cognee has no schema (`cognee/infrastructure/databases/relational/ModelBase.py:5-11`). J: on Supabase the tables land in `public`, which our API exposes (`supabase/config.toml:13`).
4. Isolation on Neo4j needs Enterprise `CREATE DATABASE` (`cognee/infrastructure/databases/graph/neo4j_driver/Neo4jDatasetDatabaseHandler.py:31-37`), a Docker container for each dataset (`Neo4jCommunityDatasetDatabaseHandler.py:40-46`), or an Aura instance for each dataset (`Neo4jAuraDevDatasetDatabaseHandler.py:18-20`).
5. Telemetry goes to `https://test.prometh.ai` (`cognee/shared/utils.py:23`) unless the environment sets `TELEMETRY_DISABLED` (`cognee/shared/utils.py:575-580`).

Recommendation (J): K1 fits 80 hours only with S-02, S-03, S-04 and S-07. K2 does not fit.
