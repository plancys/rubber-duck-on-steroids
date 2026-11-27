---
change_id: course-topic-graph
title: Course topic graph
status: implementing
created: 2026-11-25
updated: 2026-11-27
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 1: engine proof (2026-11-27)

- Request form (LiteLLM 1.111.0, Cognee 1.6.11, `anthropic/claude-haiku-5-5`): `POST /v1/messages` with `output_format: {type: "json_schema", schema}` and the header `anthropic-beta: structured-outputs-2025-11-13`. The engine sets `max_tokens` to 16000. The request has no `thinking` field and no `tools`.
- Thinking: the request sets no thinking, so Haiku 5.5 uses its default adaptive thinking at effort `medium`. The output token count includes the thinking tokens.
- API key path, ClickHouse lesson 2 "Why is ClickHouse so fast?" (12,183 characters): 1 call, 17.2 s, 5,666 input and 3,797 output tokens, 11 topics, 3 relations. The cost is about 0.0025 USD. The stop rule of phase 1 does not apply.
- Claude Code path, the same lesson (a run of the subagent): 1 call, 27.0 s, 6,367 input and 7,338 output tokens, 18 topics, 14 relations (3 `prerequisite`, 11 `part_of`). The two paths give different counts for the same lesson.
- Claude Code path, the same lesson (a run of the owner, with the subscription login): 1 call, 38.0 s, 6,361 input and 10,369 output tokens. The Claude Code path gives more output tokens and takes longer than the API key path.
- Memory of the engine process after 3 lessons on the API key path (lessons 2, 5 and 1): a footprint of 406 MB and a peak of 418 MB, measured with `footprint` on macOS. The peak did not change after the first lesson, so the Cognee import holds the memory. `ps -o rss` showed 38 MB, because macOS compresses idle pages. Phase 6 uses 1 GiB for the engine on Cloud Run, because 512 MiB leaves too little room.
- Three lessons on the API key path, prompt 1:

  | Lesson | Characters | Topics | `prerequisite` | `part_of` | Rejected links | Output tokens |
  | --- | --- | --- | --- | --- | --- | --- |
  | 1 "What is ClickHouse?" | 6,661 | 14 | 3 | 3 | 1 | 4,371 |
  | 2 "Why is ClickHouse so fast?" | 12,183 | 11 | 3 | 0 | 0 | 3,797 |
  | 5 "Choose a service" | 7,449 | 9 | 3 | 2 | 0 | 4,837 |

- Quality findings for the review of phase 6:
  - Some quotes do not name their topic. For example, the quote of `Window functions` in lesson 1 is "and scalar subqueries.", and the quote of `ClickPipes` in lesson 5 holds no product name.
  - Some quotes are fragments, for example the `Merge` quote in lesson 2 that ends with "during the".
  - The quote check removed 1 paraphrased quote (`SQL` in lesson 1). The topic then had no link left.
- Input for phase 3: when the quote check removes the last link of a topic, the topic goes, and each relation to that topic must go too. In lesson 1 the relation `Window functions -> SQL` (`part_of`) points at such a topic.
- Input for phase 3: lesson 5 holds `ClickHouse -> ReplacingMergeTree` as a prerequisite and `ReplacingMergeTree` as a part of `ClickHouse`. The ancestor rule removes the prerequisite.

### Phase 2: knowledge tables and job rules (2026-11-27)

- Migration: `supabase/migrations/20261127120000_create_topic_map.sql`. It was applied to the local database with `npx supabase migration up`. No existing row changed.
- `save_lesson_analysis` replaces the passages of a lesson by position. A passage keeps its id while its position stays, so the links of the visible map stay valid until `finish_topic_map` runs. `topic_links.passage_hash` shows a link to an old text.
- Input for phase 3: `save_lesson_analysis` takes the named arguments `course_id`, `lesson_url`, `content_hash`, `status`, `run_id`, and optional `error`, `engine`, `prompt_version`, `model`, `input_tokens`, `output_tokens`, `result`, `passages`. `passages` is `[{ position, heading_path, start_offset, end_offset, content_hash }]` with no text. An analysed lesson needs `result` and `passages`, and a failed lesson needs `error`, else the function raises 23514.
- Input for phase 3: `finish_topic_map(course_id, run_id, state)` takes `state` as `{ topics: [{ id, name, description, aliases: [{ alias, normalized }], home_lesson_url, merged_into, retired }], links: [{ topic_id, lesson_url, position, role, quote, quote_start }], relations: [{ kind, from_topic_id, to_topic_id, reason, lesson_url, position }], overview, report }`. The worker makes the uuid of each new topic. A topic that the state leaves out loses its `course_topics` row, so the state must keep retired and merged topics.
- Input for phase 3: `start_topic_map` returns `{ course, lessons, analyses, topics }`, or null for a course that does not exist. It returns no passages, so the report must take passage counts from the stored `result`.
- Input for phase 3: the extension can save a page between `start_topic_map` and `read_lesson_text`. The handler hashes the text that it reads with MD5, which gives the same value as `md5()` in Postgres, and sends that hash.
- The topic quota counts the jobs that the crawl trigger starts. After 5 crawl loads in one hour, a crawl load starts no topic job, and nothing tells the learner. In phase 4 the course page then shows no map or an old map, and the button gives the quota error.
- The smoke test and the phone check use the reload route with an empty course id to see if a job is in progress: the route answers `job_active` or `not_found`. They wait at most 60 seconds.

### Phase 3: topic job in the worker (2026-11-27)

- The engine client reads the engine name and the prompt version from `GET /health` before it selects the lessons that need a call.
- An engine that does not answer (a network error, 429, 503 or 504 after the second try) fails the whole job with a retry, so the course keeps its last map. A 401 fails the job with no retry. A 422, 400, 413, a timeout or a 502 after the second try fails only that lesson.
- `npm run worker` uses `http://127.0.0.1:8790` and `local-engine-secret` when `TOPIC_ENGINE_URL` and `TOPIC_ENGINE_SECRET` are not set. CI has no engine until phase 5, so each topic job there fails after 3 starts, in about 40 seconds. A local smoke run with no engine passed 69 of 69 steps in 77 seconds.
- A new topic gets its id from a hash of the course id and its first normalized name, so the map build stays a pure function.
- The manual checks ran on the local "Get started with ClickHouse" course through the Claude Code bridge:

  | Check | Result |
  | --- | --- |
  | 3.5 Reload, then the topic job starts by itself | `done`: 16 lessons analysed, 16 calls, 5.3 minutes, 61,840 input and 77,664 output tokens. 101 topics, 192 links, 62 relations, 86 passages. |
  | 3.6 Second run with no change | `done`: 0 analysed, 16 reused, no lesson line, the same topic ids. |
  | 3.7 Lesson 2 changed | `done`: 1 lesson line for lesson 2, 15 reused, the same topic ids, 1 topic retired. |
  | 3.8 Lessons 3 to 6 changed, worker stopped after the first lesson | Worker 1 analysed lesson 3 and released the job. Worker 2 analysed lessons 4 to 6, with no second call for lesson 3. |
  | 3.9 No reachable engine | `failed` after 3 starts with "The topic engine is not reachable.". The map and the topic ids did not change. |

- Report of the first build: the quote check removed 2 links, 1 topic and 1 relation. The ancestor rule removed 2 prerequisites, and the parent rule removed 1 second parent. 6 of 86 passages have no topic. 0 of 15 prerequisites point against the lesson order.

### Phase 4: topic map in the web app (2026-11-27)

- `@xyflow/react` 12.12.1 and `@dagrejs/dagre` 3.1.4, pinned. `eslint.config.js` got a block for `src/**/*.test.ts`, as the worker and extension tests have.
- The map starts at zoom 1 on each screen. A first view that fits the whole map gave nodes of 100 by 24 px on a wide screen, against the 44 px rule. The button "Whole map" fits the whole map on request.
- The overview places the lessons in one column in course order, with no dagre. With dagre, each lesson with no arrow went into one long row. Each arrow is an arc on the right side, with its count.
- The map shows the React Flow attribution link, enlarged to 44 px. React Flow asks for a Pro subscription when the attribution is hidden. The owner chose the visible link.
- A defect that the manual checks found and that this phase fixed: on a 320 px phone, the first view of lesson 2 showed an empty canvas. The top rank of a wide layout sat far from its left side, and the first view showed the top left corner of the layout. Now the first view starts at the left node of the top rank when the map is wider than the canvas.
- The manual checks ran in a headless browser against the production build:
  - 4.5 and 4.6 on a test account with an extension course and the fake engine: the states `none`, `building`, `current`, `partial` and `stale`, and the build button.
  - 4.7 to 4.12 on a second test account, `verify-map+1795799108339@example.com` with the password `Verify-map-password-1`, local only. It loaded the docs course, and its topic job ran through the Claude Code bridge in 6 minutes. Results: 16 lesson boxes with 5 arrows. Lesson 2 with 19 topics, 4 parent boxes, 14 arrows and 6 marks of other lessons. A panel with quotes and links. The Tab key reaches a topic after 6 presses, and Enter opens the panel. The outline with no script shows 16 lessons, 19 topics and 34 quotes. 30 phone page views in 5 looks with 0 failures.
- The course of the earlier checks belongs to a test account with no sign-in identity, so nobody can sign in to view its map.

### Phase 5: CI path (2026-11-27)

- The plan asks for a direct insert of a topic job for the course of another learner. The smoke test has no Supabase URL or key for an insert through REST. So it sends the insert through the start route with the session of the second learner. The route inserts the job and reads nothing before the insert, so the job rule of the database gives the answer `course_not_ready`. The pgTAP test in `supabase/tests/topic_map_test.sql` covers the raw insert.
- The smoke test cannot see the id of a topic job that a crawl load starts. So the step for the crawl course checks the course page: the status `current` and no failed topic job. The smoke test follows only the job of the extension course to `done`.
- Topic jobs for each learner in one smoke run: the course learner starts 3, the main smoke user starts 0, and the phone check learner starts 1. The quota is 5 in one hour.
- `astral-sh/setup-uv` has no major version tag, so CI pins `v10.3.3` with uv `0.13.7`. `engine/Dockerfile` copies uv `0.13.7` too. Change both together.
- The engine image is 2.33 GB unpacked. The packages take 1.5 GB: litellm 206 MB, lance 180 MB, pyarrow 155 MB and lancedb 149 MB. The image runs as uid 10001.
- The phone check skips an element inside the map canvas for the tap size rule only when no part of the element is inside the canvas box.
- Local gates on ports that keep the engine and the bridge of the owner free: the engine with the fake model on 8792 and 8793, the worker with `TOPIC_ENGINE_URL=http://127.0.0.1:8792`, and the preview on 4322. Results: the smoke test passed 89 steps in 45 seconds, with the 9 topic steps. The phone check passed 20 map page checks in 5 looks at 320 and 375 px. The engine tests passed 39 tests.
- Break check: a canvas of 150vw made the phone check fail on 4 map pages. A map state with no links made the smoke step "open lesson lists a topic with a quote" fail.
