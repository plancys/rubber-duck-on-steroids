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
