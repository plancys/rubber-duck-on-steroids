# Appendix: OpenTutor and LearningMAP

This file is an appendix to `../research.md`. It is the report of one read-only research worker from 2026-11-25. The worker read the code and ran nothing. Scores and effort numbers are the judgment of that worker.

1. Port the ideas (option d) from both projects. Do not run or fork either project.
2. Take the mastery engine from OpenTutor: the BKT update, the FSRS decay at read time, and the cycle check.
3. Take the state model from LearningMAP: derive mastery at read time from an attempt log, with a named forgetting model.
4. Give each topic a stable ID. Both projects use the topic name as the key, and both break there.

Legend: [C] read-in-code, [D] read-in-docs, [I] inference. Paths are relative to each project folder.

# OpenTutor (zijinz456/OpenTutor)

Back-end paths below are relative to `apps/api`.

## 1. What it is, and the data model

- It is a local single-user AI tutor. The back end is FastAPI + SQLAlchemy. The front end is Next.js 16 + React 19. [C] `apps/web/package.json:30-33`
- It supports SQLite only. `config.py:204-220` rejects other database URLs. [C]
- Materials and chunks: `course_content_tree` (id, course_id, parent_id, title, content, level, order_index, source_file, source_type, content_category, blocks_json, search_vector, embedding 1536, metadata). [C] `models/content.py:18-55`
- Concepts: `knowledge_nodes` (id, course_id, name, description, content_node_id, metadata with bloom_level, prerequisites_raw, related_raw). Unique key: (course_id, name). [C] `models/knowledge_graph.py:20-42`
- Edges: `knowledge_edges` (source_id, target_id, relation_type, weight). [C] `models/knowledge_graph.py:45-63`
- Mastery: `concept_mastery` (user_id, knowledge_node_id, mastery_score, practice_count, correct_count, wrong_count, last_practiced_at, next_review_at, stability_days). [C] `models/knowledge_graph.py:66-95`
- Questions: `practice_problems` (question_type, question, options, correct_answer, explanation, knowledge_points, difficulty_layer 1-3, problem_metadata with core_concept and potential_traps, parent_problem_id, is_diagnostic, source_batch_id, source_version, is_archived). [C] `models/practice.py:14-60`
- Attempts: `practice_results` (problem_id, user_id, user_answer, is_correct, error_category, difficulty_layer, answer_time_ms, answered_at). [C] `models/practice.py:67-90`
- Section progress: `learning_progress` (mastery_score, gap_type, FSRS fields) and the append-only `mastery_snapshots`. [C] `models/progress.py:22-64`, `models/mastery_snapshot.py:19-41`

## 2. Pipeline

1. Ingestion has 7 steps: hash dedup, MIME, extraction, classification, course match, job row, dispatch. [C] `services/ingestion/pipeline.py:1-9`
2. Chunks: Markdown headings become a tree. Nodes below 50 tokens merge into the parent. The paragraph fallback is 500 tokens. [C] `services/parser/pdf.py:26,103,143,311`
3. A second upload of the same source deletes the old tree nodes and inserts new ones. [C] `services/ingestion/dispatch.py:44-83`
4. The graph build runs after the notes, flashcard and quiz generation. [C] `services/ingestion/auto_generation/orchestrator.py:56-89`
5. Extraction prompt, one call for each section: "extract the key concepts being taught", "name: A concise concept name (2-5 words)", "prerequisites: List of concept names this concept depends on (from this same content)", "related", "bloom_level". [C] `services/loom_extraction.py:51-75`
6. Hard limits: the first 5 sections, 3000 characters each, 10 nodes for each course. [C] `services/loom_extraction.py:95,302,326`, `services/loom_graph.py:488`
7. Output schema: a free-text JSON array. The code cuts from the first `[` to the last `]`. No validation. [C] `services/loom_extraction.py:80-86`, `services/llm/providers/anthropic_client.py:202-203`
8. Dedup: embed "name: description", union-find on cosine > 0.85, keep the longest description, then dedup on the lowercase name. [C] `services/loom_extraction.py:122-183,331-333`
9. Edge types written: `prerequisite` (source depends on target) and `related` from the LLM, `confused_with` from wrong answers and from embedding similarity > 0.6, `reinforces` across courses. No code writes `part_of`. [C] `services/loom_extraction.py:374-401`, `services/loom_confusion.py:26,262-266`, `services/loom_graph.py:508-576`
10. Prerequisite cycles: a Kahn-based check removes the edges that close a cycle. [C] `services/loom_graph.py:236-316`, `services/loom_extraction.py:403-417`
11. Source link: a concept gets the first section whose text contains the concept name. No passage, no offset, no quote. [C] `services/loom_extraction.py:357-361`
12. Questions: the LLM writes 3-8 for each section with `core_concept`, `bloom_level`, `potential_traps`, `difficulty_layer`. [C] `services/parser/quiz.py:42-56`
13. Diagnosis: error categories (conceptual, procedural, computational, reading, careless), simpler derived "diagnostic" problems, and an optional adaptive pretest. The pretest selects the item nearest to the ability estimate and stops at SE < 0.15 or 20 items. [C] `models/practice.py:85-86`, `services/diagnosis/cat_pretest.py:31-33,104-156`
14. Mastery update (BKT): `P(L|correct) = P(L)(1-slip) / [P(L)(1-slip) + (1-P(L))*guess]`, then `P(L) += (1-P(L))*0.10`. The guess value depends on the question type: mc 0.25, tf 0.50, short answer 0.05. [C] `services/loom_mastery.py:29-39,53-76`
15. Stability: an FSRS review with rating 3 for correct and 1 for wrong. [C] `services/loom_mastery.py:139-161`
16. Propagation: prerequisites get +(1/(depth+1))*0.05 or -(1/(depth+1))*0.03, to depth 3. A parent gets +0.1 when all prerequisites pass 0.85. [C] `services/loom_mastery.py:42-48,178-316`
17. Decay at read time: `effective = raw_mastery * R`, `R = (1 + t/(9*S))^-1`. The API returns the raw value, the retrievability and the effective value. [C] `services/loom_graph.py:70-93`, `services/spaced_repetition/fsrs.py:146-157`
18. Adaptation: a learning path (Kahn sort over concepts with mastery < 0.8, tie-break on Bloom level, then mastery), a prerequisite gap walk after a wrong answer (threshold 0.4), a review order (LECTOR), and dashboard block rules. No lesson reorder, no passage collapse. [C] `services/loom_graph.py:129-211,384-477`, `services/lector.py:49`, `services/block_decision/rules.py:183-233`
19. Front end: a custom SVG with its own force simulation. No graph library. Node fill is greyscale: `hsl(0 0% ${20 + mastery*60}%)`. A click shows "Mastery %, Level". A helper builds a focused subgraph of 20 nodes around search terms. [C] `apps/web/src/components/sections/analytics/graph-view.tsx:185-240`, `graph-simulation.ts:3-22`

The critical gap: `update_concept_mastery` runs only for `problem.knowledge_points`. [C] `routers/quiz_submission.py:228-241`. Extracted and generated problems do not set that field. [C] `services/parser/quiz.py:547-555`, `routers/quiz_generation.py:126-135`. Only the demo course and the derived problems set it. [C] grep over `apps/api`. The match is an exact lowercase name. [C] `services/loom_mastery.py:98-106`. Thus normal quiz answers do not change concept mastery. [I]

## 3. Runtime and dependencies

- SQLite (aiosqlite), optional Redis, a local upload disk. Docker Compose limits: api 2 GB, web 1 GB, redis 512 MB. [C] `docker-compose.yml`
- No vector store. The code stores embeddings as JSON text in SQLite. [C] `models/compat.py:34-66`
- LLM providers: OpenAI, Anthropic (native SDK, `anthropic==0.46.0`), DeepSeek, OpenRouter, Gemini, Groq, Ollama, with a circuit breaker. [C] `services/llm/router.py:271-327`, `requirements-core.txt`
- Structured output: none. The prompt asks for JSON and the code parses text. [C]
- Embeddings: an API provider or a local model. The no-op fallback returns zeros, and then the dedup does nothing. [C] `services/embedding/registry.py:28-37`, `services/loom_extraction.py:201-218`
- Auth is off by default. `deployment_mode = "single_user"`. [C] `config.py:57-58`

## 4. License

MIT. [C] `LICENSE`. A fork inside a hosted product is permitted. Keep the copyright notice.

## 5. Maturity

- 289 commits from 2026-02-26 to 2026-11-13. Two bursts: March (114) and October (60). 62 commits have the author "Claude". [C] git log
- 473 Python files, 304 TypeScript files, about 114k lines. About 1185 Python test functions, 42 web test files, 26 Playwright specs, 4 CI workflows. [C]
- The README marks LOOM and LECTOR as "[Experimental]". It says "Multi-user SaaS/classroom mode is out of scope for this beta". [D] `README.md:106,165,169`
- Their health report: version 0.1.1-alpha, score 67/100, "CHANGELOG now 245 days stale". [D] `marketing/health/2026-11-12-report.md`
- Their cleanup log: the endpoint `knowledge-graph-mastery` "only returned an empty placeholder payload". [D] `docs/code-cleanup-matrix.md:35`
- ADR-004 cites `lector_analytics.py`. That file does not exist. [C]
- Quality of the graph-build code: short and clear, but at demo level. It has hard caps, no order in the section query, and it skips the build when one node exists. [C] `services/loom_extraction.py:265-289`
- Coupling: the mastery code needs the SQLAlchemy session. Only `_bkt_update`, the FSRS functions and the cycle functions are pure. [C]
- `_sync_to_learning_progress` selects one row by user and course. The table has one row for each section. With more rows the sync fails and only logs a warning. [I] `services/loom_mastery.py:335-341,360-361`

## 6. Fit (0 to 3)

- N1: 1. Typed edges and real content, but 10 concepts from 5 sections, and a section link by name substring.
- N2: 0. The build skips when a node exists. A new upload deletes the tree nodes and sets the links to null.
- N3: 1. An exact name match adds `reinforces` edges. Mastery does not transfer. The query has no user filter. [C] `services/loom_graph.py:528`
- N4: 2. Good formulas (BKT, stability, read-time decay, confusion edges). No self-mark, no undo, no event log, in-place writes.
- N5: 1. Learning path, gap warnings and review order. No reorder or collapse of source lessons.
- N6: 1. Own SVG view, greyscale mastery, focus subgraph. A click does not open the topic text.
- N7: 0. Single user, SQLite, auth off by default.

## 7. Integration options

- (a) Run as a service: 5-8 days. High risk. Cloud Run has no local persistent disk, and SQLite needs one. [I] There are two sources of truth for lessons. The graph caps stay.
- (b) Use a part as a library: not practical from Node. The pure parts are about 300 lines of Python.
- (c) Fork and adapt: 15-25 days plus permanent upkeep of 114k lines. High risk. You must replace extraction, storage and tenancy.
- (d) Port the ideas: 5-8 days. Low risk. BKT with guess and slip by question type, raw and decayed mastery, cycle removal, Kahn path, embedding dedup as a candidate step, `confused_with` edges, the gap walk.
- Recommendation: (d).

## 8. Best idea, main trap

- Best idea: BKT with guess and slip by question type, plus a separate stability value, plus decay only at read time.
- Main trap: the graph and the mastery state join on a name string, and the generated questions carry no concept tag. The product looks complete, but the loop is open.

# LearningMAP (ai-for-edu/LearningMAP)

## 1. What it is, and the data model

- It is a tutoring demo: topic, graph, quiz, diagnosis, lesson, slides, review. FastAPI + LangGraph, static pages with plain JavaScript. A second FastAPI service (`student_memory/`) keeps the learner memory. [D] `ARCHITECTURE.md:18-28`
- "The system does not ingest user-uploaded documents". The LLM generates all content from the topic string. [D] `ARCHITECTURE.md:28`
- Graph (in session state, no table): `KnowledgeNode` (id, name, description, level: prerequisite, core, extension, mastery), `KnowledgeEdge` (source, target, relation = "prerequisite"), `KnowledgeGraph` (topic, nodes, edges). [C] `src/llm/schemas.py:20-37`
- Questions: `QuizQuestion` (id, knowledge_point, question, options, answer index). [C] `src/llm/schemas.py:40-45`
- Session store: `sessions` (id, data JSON). [C] `src/api/store.py:118`
- Attempts: `memories` (memory_id, user_id, session_id, memory_type, topic, subtopic, timestamp, retrieval_text, raw_json, question_count, correct_count, accuracy, error_types). [C] `student_memory/app/db/migrations.py:28-42`
- Learner notes: `notes` (user_id, category: misconception, preference, style, goal, content, content_hash, source_session_id, archived). [C] `migrations.py:78-89`
- Audit log: `notes_history` (note_id, event: ADD, UPDATE, DELETE, NOOP, REJECT, old_content, new_content, reason, ts). [C] `migrations.py:101-112`
- Mastery series: `mastery_curve` (user_id, topic, knowledge_point, score, ts, source), maximum 10 samples for each point. `progress_snapshots` (user_id, topic, status, mastery_overall). [C] `migrations.py:119-142`
- Mastery view on a node: `MasteryMeta` (last_accuracy, last_seen_at, session_count, retention, status, forgetting_model). [C] `src/llm/schemas.py:9-17`

## 2. Pipeline

1. Input: the learner types a topic. No material, no chunks. [D]
2. Graph, path A: a rule matches the topic to a route in a fixed taxonomy file (`XES3G5M/metadata/kc_skills.json`). The repository does not contain that file. Parent-child links get the label "prerequisite". [C] `src/skills/kc_loader.py:20-25`, `src/skills/kc_graph.py:22-57,163-167`
3. Graph, path B: one LLM call. It runs when no route matches. Without the taxonomy file it always runs. [I] "Given a learning topic, generate a knowledge graph of related concepts", "Include 4-10 nodes", "source → target means source is prerequisite of target". [C] `src/prompts/knowledge_graph.j2:1,44-48`, `src/agent/nodes/knowledge_graph.py:22,126-132`
4. Output schema: Instructor with the Pydantic model `KnowledgeGraph`. [C] `src/agent/nodes/knowledge_graph.py:88-93`
5. Identity and dedup: the name string only. The prompt says "reuse their names exactly as node `name` (character-for-character)". [C] `knowledge_graph.j2:38`
6. Mastery join: exact name, then normalised name, then the prefix before a colon. [C] `src/agent/mastery_annotator.py:1-14,98-132`
7. Questions: 2 multiple-choice items for each node. The budget moves to weak nodes: priority = 1 - retention, unseen = 0.7, minimum 1. [C] `src/agent/nodes/quiz.py:38-105`
8. The code overwrites `knowledge_point` with the node name, because the LLM changed it. [C] `src/agent/nodes/quiz.py:259-264`
9. Grading: index compare. Diagnosis: "mastered" at 60% correct, else "weak". An untested prerequisite of a mastered node gets "skipped". [C] `src/agent/nodes/diagnosis.py:27-49`
10. Mastery rule, computed at read time: `R = accuracy * exp(-t/S)`, `S = 7 + 7*(sessions-1)` days. Status: R >= 0.70 mastered, >= 0.30 weak, else forgotten. [C] `src/forgetting/ebbinghaus.py:29-70`, `src/agent/mastery_annotator.py:36-45`
11. Accuracy input: a time-weighted mean. The weight is `question_count * exp(-age*ln2/30)`. [C] `student_memory/app/db/sqlite_repo.py:803-910`
12. Misconceptions: one LLM call extracts a maximum of 5 facts. A second call compares each fact with 5 neighbours and selects ADD, UPDATE, DELETE, NOOP or REJECT with a reason. [C] `src/prompts/memory_extract_system.j2:1-17`, `src/prompts/memory_consolidate_system.j2:1-19`, `src/llm/schemas.py:137-164`
13. Adaptation: the lesson covers only the weak points. [C] `src/agent/nodes/lesson.py:60-106`. The next graph obeys "HARD RULES": mastered points are "DO NOT include" or extension only, weak points "MUST appear as `core` nodes". [C] `knowledge_graph.j2:16-29`
14. Review selection: priority = 0.6*staleness (age/14 days) + 0.4*uncertainty (1 - |accuracy - 0.5|*2). It skips points seen in the last day and selects 3-5. [C] `src/agent/nodes/review.py:41-100`
15. Front end: vis-network from a CDN. Colour by status: green mastered, amber weak, red forgotten, grey unseen. Size by level. A tooltip shows the last accuracy and the last date. No click action. [C] `static/index.html:10,1300-1305,1400`

## 3. Runtime and dependencies

- SQLite for sessions and for memory. hnswlib for vectors. Local embeddings with BAAI/bge-m3 (about 3 GB RAM). One worker only, because the index is not process-safe. [D] `ARCHITECTURE.md:92,237-257`
- LLM: "OpenAI-compatible gateway only". The `anthropic` package is in the dependency list, but the client uses `instructor.from_openai`. [D] `ARCHITECTURE.md:98`, [C] `src/llm/client.py:35-46`, `pyproject.toml:15`
- The default model name is `claude-sonnet-4-20250514` through such a gateway. [C] `src/llm/client.py:59`
- Structured output: Instructor `response_model`, plus a 4-strategy JSON repair for slides. [D] `ARCHITECTURE.md:67-88,99`
- One hard-coded user: `DEFAULT_USER_ID = "default_user"`. No auth. [C] `src/memory_client.py:23`

## 4. License

Apache-2.0. [C] `LICENSE`. A fork inside a hosted product is permitted. Keep the notices and state the changes. The license includes a patent grant.

## 5. Maturity

- 454 commits from 2026-03-28 to 2026-10-21. The development log stops on 2026-06-02. [C] git log, [D] `development_log.md`
- About 28k lines of Python with the tests, 5 static pages, about 760 test functions, no CI folder. [C]
- The graph code is thin: one prompt and one model. The effort is in lessons and slides (a 961-line slide prompt). [C]
- What their documents and comments say was hard:
  - LLM name drift broke the memory keys: "discriminant (Δ)" against "discriminant". Old rows have the form "node_name: full description". [C] `src/agent/mastery_annotator.py:5-10`
  - Sessions got lost after a refresh. [D] `development_log.md:8`
  - Review selected the same question again and again. [D] `development_log.md:41`
  - Quiz generation hit the `max_tokens` limit. A part failure in the parallel lesson needed cancel logic. [D] `development_log.md:53`
  - The two language branches leaked text into each other. [D] `development_log.md:59-64`
  - "Brittle LLM JSON" needs a fixed repair chain. [D] `ARCHITECTURE.md:67`
- Drift in the code: the score map has "partial" = 0.6, but diagnosis never writes "partial". [C] `src/progress_aggregator.py:27-31`, `src/agent/nodes/diagnosis.py:56-64`
- There are two mastery stores (`memories` and `mastery_curve`). The second one is off by default. [C] `src/progress_aggregator.py:103-104`

## 6. Fit (0 to 3)

- N1: 0. No source text. The LLM invents a graph of 10 nodes from the topic title.
- N2: 0. The LLM makes a new graph in each session.
- N3: 1. A prompt asks for the same names, and a 3-stage match repairs drift. Mastery reads are per topic string.
- N4: 2. Read-time, deterministic, named forgetting model, audit log for notes. No self-mark, no uncertainty value, string keys.
- N5: 1. Real adaptation logic, but for generated lessons. No source lessons to reorder or collapse.
- N6: 1. Clear status colours and legend. No click action, no partial view.
- N7: 0. One hard-coded user, no auth.

## 7. Integration options

- (a) Run as a service: 3-5 days. High risk, low value. It does not read our lessons. The memory service needs a local model and one stateful worker.
- (b) Use a part as a library: not practical from Node. The pure parts are about 400 lines of Python.
- (c) Fork and adapt: 10-15 days. High risk. You must add ingestion, a graph from content, users and Postgres. That is the core.
- (d) Port the ideas: 3-5 days. Low risk. The forgetting interface, the read-time mastery view, the question budget, the review priority, the note consolidation with an audit log.
- Recommendation: (d).

## 8. Best idea, main trap

- Best idea: mastery is a pure function of the attempt log and the time. The result carries the model name (`ebbinghaus_v1`). You can change the model and replay.
- Main trap: an LLM-written name is the topic identity. The project needs a prompt rule, a code overwrite and a 3-stage match to hold it together.

# Comparison

| Point               | OpenTutor                                        | LearningMAP                          |
| ------------------- | ------------------------------------------------ | ------------------------------------ |
| Source of the graph | Uploaded content, 5 sections                     | Topic title only                     |
| Concept size        | 2-5 word name, 10 for each course                | 4-10 for each topic                  |
| Edge types          | prerequisite, related, confused_with, reinforces | prerequisite                         |
| Provenance          | Section by name substring                        | None                                 |
| Topic identity      | (course_id, name)                                | Name string                          |
| Incremental update  | None (skip when present)                         | None (new graph each time)           |
| Mastery rule        | BKT + FSRS stability, decay at read              | accuracy * exp(-t/S) at read         |
| State storage       | Mutable row for each concept                     | Attempt rows, derived view           |
| Misconceptions      | Error category, confusion edges                  | Notes with an audit log              |
| Structured output   | Text parse                                       | Instructor + Pydantic                |
| Anthropic           | Native client                                    | Through an OpenAI-compatible gateway |
| Graph view          | Own SVG, greyscale                               | vis-network, 4 status colours        |
| Storage             | SQLite                                           | SQLite + hnswlib                     |
| Users               | Single user, auth optional                       | One hard-coded user                  |
| License             | MIT                                              | Apache-2.0                           |
| Size                | 114k lines                                       | 28k lines of Python                  |
| Port cost (d)       | 5-8 days                                         | 3-5 days                             |

# Verdict

What to learn for N1 to N6:

1. From OpenTutor: use BKT with guess and slip by question type. A self-mark "known" can be a strong prior in the same model. [I]
2. From OpenTutor: store the raw mastery and the stability. Compute the decayed value at read time and show both.
3. From OpenTutor: validate the prerequisite edges as a DAG and remove cycle edges before the save.
4. From OpenTutor: use embedding similarity as a candidate step for dedup, and add `confused_with` edges for misconceptions.
5. From LearningMAP: keep an append-only attempt log and derive the state. That gives undo, replay and inspection.
6. From LearningMAP: store the name of the forgetting model with each result.
7. From LearningMAP: set the topic key in code. Do not let the LLM write the key.
8. From LearningMAP: give more questions to weak topics (1 - retention) and select review by staleness and uncertainty.
9. From LearningMAP: let the LLM propose a memory change (ADD, UPDATE, DELETE, NOOP, REJECT) and write each decision to a history table.

What we must not copy:

1. A name string as the topic identity (both).
2. A graph build that skips when nodes exist, or a new graph in each session (both).
3. Fixed caps on the input: 5 sections, 3000 characters, 10 nodes (OpenTutor).
4. A source link by name substring. N1 needs a passage and a quote (OpenTutor).
5. In-place mastery writes with propagation to other nodes. That blocks undo and replay (OpenTutor).
6. Two mastery stores that blend into each other (both). OpenTutor also counts study time as 30% of section mastery. [C] `services/progress/tracker.py:116-127`
7. A text parse of LLM JSON. Use structured output with a schema (OpenTutor).
8. Learner-specific edges in a shared graph, and a cross-course link with no user filter (OpenTutor).
9. Thresholds set for comfort: "users need to see green to feel progress". [C] `src/agent/mastery_annotator.py:32-34`

Neither project solves N1, N2 or N3. Our design for stable topic IDs, passage provenance and incremental rebuild has no model in these two code bases.

# Inspected and not inspected

- Inspected in OpenTutor: the models, `loom_extraction.py`, `loom_mastery.py`, `loom_graph.py`, parts of `loom_confusion.py`, `lector.py`, `cat_pretest.py`, the ingestion dispatch, the quiz routers, the LLM router, the graph view, the ADRs, the status documents, the README, the git history counts.
- Not inspected in OpenTutor: the agent subsystem, the scheduler, the Canvas and scraper code, cognitive load, most routers, the migrations, `SPEC.md`, `PRD.md`, the test bodies.
- Inspected in LearningMAP: `ARCHITECTURE.md`, `development_log.md`, the schemas, the graph, quiz, grading, diagnosis and review nodes, the forgetting module, the annotator, the memory schema and the mastery aggregate, the graph part of `static/index.html`.
- Not inspected in LearningMAP: the slides pipeline, the PPTX export, the retriever and reranker, the plans in `docs/superpowers`, the test bodies.
- I did not run, build or install anything. I did not read GitHub issues or star counts.
- The effort values are estimates for one developer. [I]
