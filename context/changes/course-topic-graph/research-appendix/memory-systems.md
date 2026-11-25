# Appendix: Honcho, Memobase, Remnic, Letta Code and PersonaMem

This file is an appendix to `../research.md`. It is the report of one read-only research worker from 2026-11-25. The worker read the code and ran nothing. Scores and effort numbers are the judgment of that worker.

Recommended action: port ideas into our Postgres schema. Do not run or fork any of the five projects for the learner core. None of them has a topic graph.

Claim tags: [code] = read in code, [docs] = read in README or docs, [inf] = inference. Paths are relative to each project folder. Effort numbers are [inf] for one developer.

## Scope of the inspection

- Inspected: data models, prompts, pipeline entry points, configuration, licenses, git history counts, file and test counts.
- Not inspected: test quality, runtime behavior (nothing ran), the Letta server (not in the clone), honcho SDK internals, most of the 396k lines of `remnic-core`, the PersonaMem dataset on HuggingFace.
- All five model who a person is, or what an agent remembers. None models what a person knows about a concept.

## 1. honcho (plastic-labs, AGPL-3.0, v3.6.1)

**What it is.** A FastAPI memory service. It derives "conclusions" about "peers" from messages. [code]

**Data model** (`src/models.py`) [code]

- `Tenant` :221, `Workspace` :270, `Peer` :328, `Session` :398, `Message` :470 (`content`, `token_count`, `seq_in_session`, `peer_name`).
- `Collection` :742 is one (`observer`, `observed`) pair. Thus each peer holds a separate view of each other peer.
- `Document` :825 is one conclusion: `content`, `level`, `times_derived`, `embedding`, `observer`, `observed`, `session_name`, `deleted_at`, `sync_state`.
- `level` is `explicit | deductive | inductive | contradiction` (`src/utils/types.py:294`).
- Provenance: `DocumentSource` :1080 links a derived conclusion to its premises. `ConclusionSourceMessage` :1128 links an explicit conclusion to the cited messages.
- Peer card: a list of strings in `Peer.internal_metadata` (`src/crud/peer_card.py:156`). Prefixes are `IDENTITY:`, `ATTRIBUTE:`, `RELATIONSHIP:`, `INSTRUCTION:` (`src/dreamer/specialists.py:193-228`).
- History: `DreamRun` :1428 and `DreamRunChange` :1500 record each created and removed conclusion and the peer card before and after.
- Separation: each table has `tenant_id` first in the key and uses `HASH (tenant_id)` partitions (:127, :209). The connection sets the `app.tenant` setting at checkout (`src/db.py:151`). A startup validator refuses to boot when row-level security is not enabled and forced (`src/startup/tenant_isolation_validator.py:1-30`). JWT claims scope a token to workspace, peer, session or scope (`src/security.py:77-83`).

**Pipelines** [code]

- Deriver: a Postgres queue with `FOR UPDATE SKIP LOCKED` (`src/deriver/queue_manager.py:474`). The deriver groups messages into a token-bounded batch and makes one LLM call with a structured output (`src/deriver/deriver.py:188`).
- Prompt (`src/deriver/prompts.py:67-87`): "Analyze messages to extract **explicit atomic facts** about the target peer." "Each conclusion states exactly one independent fact." "set `source_indices` to the `idx` values of the messages it rests on".
- Deduplication (`src/crud/document.py`): exact match on normalized content, level and session (:639). Then a semantic match at cosine distance 0.05 or less (:371). The richer text wins (:1750). A repeat increments `times_derived` (:1953).
- Dreamer: a scheduled job runs a deduction specialist, then an induction specialist (`src/dreamer/orchestrator.py:143-146`). An optional surprisal sample selects unusual conclusions as hints (`src/dreamer/surprisal.py`).
- Dialectic: a tool-loop agent answers questions about a peer (`src/dialectic/core.py:81`, route `/{peer_id}/chat` in `src/routers/peers.py:245`). Prompt: "A confident \"I don't know\" is ALWAYS correct" (`src/dialectic/prompts.py:329`).
- pgvector: `Vector(1536)` columns with HNSW indexes on `documents` and `message_embeddings` (:650, :1040). Full-text search uses `to_tsvector` (:554).

**Runtime.** Python 3.13, Postgres with pgvector, Redis for cache, two processes (API and deriver) (`docker-compose.yml.example:13,55,114,138`). LLM transports: `anthropic | openai | gemini` (`src/config.py:27`). Embeddings: `openai | gemini` only (:28). Default models are `gpt-5.4-mini` (:998). Anthropic works for the LLM calls, but the service needs a second vendor for embeddings. [code]

**License.** AGPL-3.0 for the server. The SDKs are Apache-2.0 (`sdks/python/pyproject.toml:6`, `sdks/typescript/package.json:6`). [code]

- Hosted fork: AGPL section 13 applies to a modified version that users reach over a network. You must offer those users the complete source of your modified version. If you merge honcho code into the product, the copyleft covers the combined work. [inf]
- Separate service: you run honcho unmodified and call it through the HTTP API with the Apache-2.0 SDK. The product stays a separate work and keeps its own license. If you change honcho, you publish those changes. Learners reach honcho only through our backend, and that indirect case is a gray area. Ask a lawyer before a commercial launch. [inf]
- Ported ideas carry no duty. Copied prompt text or code does. Rewrite the prompts in our own words. [inf]

**Maturity.** 931 commits, 334 after 2026-08-01, 66k lines of source, 368 test files, 46 migrations. Extraction of one part is hard: the tenancy, queue, telemetry and LLM layers touch every module. [code]

**Fit**

| Need | Score | Reason                                                                                                                              |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| N1   | 1     | No topic graph. The source-link tables are a good provenance pattern.                                                               |
| N2   | 1     | Scope backfill and removal jobs soft-delete dependent conclusions (`src/crud/scope.py:10-15`).                                      |
| N3   | 0     | No concept identity.                                                                                                                |
| N4   | 1     | Free-text conclusions with a reinforcement count and contradictions. No mastery value, no decay, LLM updates are not deterministic. |
| N5   | 1     | The dialectic can answer "what does this learner know", at an LLM cost for each question.                                           |
| N6   | 0     | No graph view.                                                                                                                      |
| N7   | 2     | Strong tenant isolation, scoped tokens, a peer can be a codebase or a team.                                                         |

**Integration.** (a) Service: 4 to 6 days, plus a second container, Redis, and an embedding vendor. Risk: cost and AGPL questions. (b) Library: not practical. (c) Fork: 15 days or more, AGPL duties. (d) Port ideas: 2 to 3 days. **Recommended: (d).**

**Best idea.** Evidence tables: each derived row links to the exact source rows, and each background run writes a change log. **Main trap.** It stores sentences about a person. A mastery model needs numbers per topic.

## 2. memobase (memodb-io, Apache-2.0, v0.1.0)

**What it is.** A FastAPI service that keeps a slot-based user profile and an event timeline. [code]

**Data model** (`src/server/api/memobase_server/models/database.py`) [code]

- `Project` :186 (`project_id`, `project_secret`, `profile_config`), `User` :242, `GeneralBlob` :286, `BufferZone` :346 (`token_size`, `status`), `UserProfile` :419 (`content`, `attributes`), `UserEvent` :459 (`event_data`, `embedding`), `UserEventGist` :515.
- A profile slot is `attributes = {topic, sub_topic}` plus a `content` memo (`models/response.py:66-73`).
- A slot definition has `name`, `description`, `update_description`, `validate_value` (`types.py:10-14`). `attribute_unify` lowercases names and replaces spaces (:6).
- Default slots: `basic_info`, `contact_info`, `education`, `demographics`, `work`, `interest`, `psychological`, `life_event` (`prompts/user_profile_topics.py:9-77`).
- Separation: `project_id` is in each primary key. A bearer token maps to one project (`api_layer/middleware.py:126-199`). No row-level security. No session entity.

**Pipelines** [code]

- Buffer: each inserted chat goes to `buffer_zones`. A flush starts when idle tokens exceed 1024 (`controllers/buffer.py:66-90`, `env.py:86`) or on an explicit flush call. `buffer_flush_interval` exists in `env.py:85` but no other file reads it.
- Flush (`controllers/modal/chat/__init__.py:38-118`): summarize chats to a memo, then in parallel extract slots and tag the event, then merge, then reorganize a topic over 15 sub-topics, then re-summarize a slot over 128 tokens.
- Extract prompt (`prompts/extract_profile.py:39-52`): "You are a professional psychologist." "You can create your own topics/sub_topics if you find it necessary". Strict mode forbids new slots (:113).
- Merge prompt (`prompts/merge_profile_yolo.py:51-63,117-119`): one call for all slots, with a line per memo: `APPEND`, `UPDATE [UPDATED_MEMO]` or `ABORT`. "Ensure updated memos do not exceed 5 sentences." "Preserve time annotations".
- Event: `event_data = {profile_delta, event_tip, event_tags}` (`models/response.py:103-108`). Thus each event stores the profile change that it caused.
- Context pack with a token budget and topic filters (`controllers/context.py:115`).

**Runtime.** Python 3.12, Postgres with pgvector, Redis for locks and queues (`src/server/docker-compose.yml:4,23`). LLM: OpenAI-compatible endpoints or Doubao only (`llms/__init__.py:15`). Anthropic is not supported natively. An OpenAI-compatible Anthropic endpoint can work, untested. Embeddings: `openai | jina | ollama` (`env.py:105`). [code]

**License.** Apache-2.0. A hosted fork is free of source duties. Keep the notices. [code]

**Maturity.** 467 commits, but 13 commits after 2025-09 and the last on 2026-01-11. The roadmap stops at 2025-Q3. 12k lines, 12 test files. Extraction is easy: the prompts and the merge parser are small files. [code]

**Fit**

| Need | Score | Reason                                                                          |
| ---- | ----- | ------------------------------------------------------------------------------- |
| N1   | 0     | "Topic" here means a profile category, not a course concept.                    |
| N2   | 0     | No source documents.                                                            |
| N3   | 1     | Fixed slot keys with normalized names give stable identity. The idea transfers. |
| N4   | 1     | One memo per slot with dates. No uncertainty, no decay, LLM merge.              |
| N5   | 1     | Token-budget context pack.                                                      |
| N6   | 0     | No graph.                                                                       |
| N7   | 1     | Project-level tenancy only.                                                     |

**Integration.** (a) Service: 3 to 4 days, risk: dormant project, no Anthropic path. (b) Library: no. (c) Fork: 8 to 10 days, you own a dead upstream. (d) Port: 1 to 2 days. **Recommended: (d).**

**Best idea.** The batch merge with `APPEND / UPDATE / ABORT`, and the event row that stores its `profile_delta`. That delta gives cheap undo. **Main trap.** The extractor may invent slots. Without strict mode, identity drifts.

## 3. remnic (joshuaswarren, MIT, v10.0.103)

**What it is at its core.** `packages/remnic-core`: a local-first memory engine for coding agents. Memories are Markdown files with YAML frontmatter, plus local SQLite and JSON indexes. The other 37 packages are connectors, importers, capture daemons, plugins, a CLI and a benchmark suite. [code]

**Memory model** (`packages/remnic-core/src/types.ts`) [code]

- `MemoryCategory` :55: `fact, preference, correction, entity, decision, relationship, principle, commitment, moment, skill, rule, procedure, reasoning_trace`.
- `MemoryFrontmatter` :2818: `id`, `category`, `confidence`, `confidenceTier` (`explicit | implied | inferred | speculative`), `status`, `supersedes`, `supersededBy`, `valid_at`, `invalid_at`, `lifecycleState`, `verificationState` (`unverified | user_confirmed | system_inferred | disputed`), `decayScore`, `heatScore`, `mw_success`, `mw_fail`, `contentHash`, `derived_from`, `sources`, `faithfulness`.
- Provenance: `ProvenanceSource` :3107 has `sessionKey`, `turnId`, `observedAt`, `quote`, `charStart`, `charEnd`. `locateQuoteOffsets` finds the quote in the source text and returns the offsets (`src/provenance.ts:655`).
- Separation: namespaces of kind `default | shared | project | branch | team-project | explicit` (`src/namespaces/catalog.ts:68`), with principals and read or write checks. It is a directory layout, not a multi-tenant database.

**Algorithms** [code]

- Memory worth (`src/memory-worth.ts:14-21,62`): `(s + 1) / (s + f + 2)`, with counters multiplied by `2^(-age / halfLife)`. A pure function, the caller passes `now`. No data gives 0.5.
- Trust score (`src/trust-score.ts:1-36`): one score from worth, provenance, faithfulness, corroboration and contradiction, with a per-component breakdown. No signal gives a neutral value.
- Faithfulness gate (`src/extraction-faithfulness.ts:1-25`): an entailment check of each extracted fact against its quote only.
- Corrections (`src/correction/correction-contract.ts:73-79,126-132,156-179`): classes `wrong, outdated, incomplete, wrong_scope, never_store`. Actions `supersede, edit, retract, rescope, redaction_rule`. A plan holds a `diff`, a `confidence` and an expiry, and then an apply step runs.
- Temporal supersession (`src/temporal-supersession.ts:1-14`), page versions with revert (`src/page-versioning.ts:1-17`), lifecycle states with heat and decay (`src/lifecycle.ts:135-252`).
- Evaluation: `packages/bench` has runners for LongMemEval, LoCoMo, PersonaMem, MemoryAgentBench and others, plus its own suites such as `memcorrect`, `contradiction-detection` and `ingestion-citation-accuracy` (`packages/bench/src/benchmarks/`).
- Related packages: `belief-ledger` (claims with stance and prediction grades), `coding-graph` (tree-sitter symbols into a SQLite graph).

**Runtime.** Node 22.12 or later, the file system, `better-sqlite3`, LanceDB, Orama. No external database. LLM: Anthropic Messages API is supported (`src/fallback-llm.ts:135-137,760`), also OpenAI-compatible and local servers. Embeddings: OpenAI or local. [code]

**License.** MIT. A fork or a copy inside a hosted product is free. Keep the copyright notice. [code]

**Maturity.** 5,944 commits, 1,178 after 2026-08-01, about 1,900 test files. One human author wrote 4,526 commits. `remnic-core` has 396k lines and 912 top-level source files. The pure modules (`memory-worth.ts`, `trust-score.ts`, `provenance.ts`) are easy to copy. The engine as a whole is not practical to embed in a Postgres product. [code]

**Fit**

| Need | Score | Reason                                                                                                    |
| ---- | ----- | --------------------------------------------------------------------------------------------------------- |
| N1   | 1     | Quote and offset provenance is exactly the passage link we need. No concept graph.                        |
| N2   | 1     | Content hash, supersession and version snapshots. Built for files.                                        |
| N3   | 1     | Entity consolidation exists. I did not read it in depth. [inf]                                            |
| N4   | 2     | Deterministic counters with decay, verification states, correction plans. It scores memories, not skills. |
| N5   | 1     | Recall ranking with budgets. No lesson logic.                                                             |
| N6   | 0     | The X-ray is an explanation record, not a graph view.                                                     |
| N7   | 2     | Namespaces, principals, connectors and a code graph. Single-machine design.                               |

**Integration.** (a) Service (`remnic-server`): 5 to 8 days, risk: file storage on Cloud Run, bus factor of one. (b) Library: 4 to 6 days, heavy native dependencies. (c) Fork: not sensible at this size. (d) Port: 2 to 4 days for the worth function, the provenance locator and the correction contract. **Recommended: (d), with direct copies of the small MIT modules.**

**Best idea.** The update rule as a pure function with a neutral prior, and the explanation record for each score. **Main trap.** The size. It is easy to lose days in reading.

## 4. letta-code (letta-ai, Apache-2.0, v0.34.59)

**What it is.** A terminal agent harness. It talks to Letta Cloud or to a local backend. [code, docs]

**Memory model** [code]

- Legacy blocks: `persona` and `human`, each with `label`, `description`, `value`, `read_only` (`src/agent/memory.ts:16,71-83`). The older block tools are in `src/tools/removed-tools.ts`.
- Current model, MemFS: memory is a git repository of Markdown files. A root file is part of the system prompt. Each file has exactly `name` and `description` in frontmatter. `MEMORY.md` is an index without frontmatter (`src/agent/prompts/letta_root_memfs.md:28-30`).
- Limits: depth 2, 20,000 characters per file, 65,536 for core memory (`src/memory-constraints.ts:325-331`).
- Separation: one memory directory per agent (`src/backend/local/paths.ts:52`). Shared memory repositories attach to several agents. No tenant model in this repository.

**How the agent edits memory** [code]

- The agent uses normal file tools and bash on the memory directory, then commits. "Changes affect your future context only after they are committed" (`letta_root_memfs.md:56`).
- A pre-commit hook validates frontmatter, limits and read-only files (`src/agent/memory-git-hooks.ts:25-35`).
- A `Memory(path)` tool opens deferred directories one level at a time (`src/tools/descriptions/Memory.md`).
- Guidance: "Treat each change as a revision of that prompt, not an append to a log" (`src/skills/builtin/maintaining-core-memory/SKILL.md:6`).

**Runtime.** Bun or Node 22 to 26, git, a Letta backend. Anthropic works through bring-your-own-key (`src/providers/byok-providers.ts:137`). [code]

**License.** Apache-2.0. No source duty for a hosted fork. [code]

**Maturity.** 4,151 commits, 1,188 after 2026-08-01, 1,176 test files. The memory code depends on the CLI, the permission system and git processes. Extraction is hard and has little value for us. [code]

**Fit**

| Need | Score | Reason                                                              |
| ---- | ----- | ------------------------------------------------------------------- |
| N1   | 0     | No graph.                                                           |
| N2   | 1     | Git history gives versions.                                         |
| N3   | 0     | None.                                                               |
| N4   | 1     | Inspectable text with undo through git. No numbers, no determinism. |
| N5   | 0     | None.                                                               |
| N6   | 0     | None.                                                               |
| N7   | 1     | Shared memory repositories and the index pattern.                   |

**Integration.** (a) Service: not applicable, it is a CLI. (b) Library: no. (c) Fork: no. (d) Port: 1 day. **Recommended: (d), small.**

**Best idea.** Progressive disclosure: a short index with one-line descriptions, and the detail opens on demand. That fits N6 "one part at a time". **Main trap.** Free-form self-edited text is the opposite of a deterministic learner state.

## 5. PersonaMem (bowen-upenn, MIT)

**What it is.** A research benchmark and its generator, 5k lines of Python. No data model for production. [code]

**What it measures** [code, docs]

- Whether an LLM tracks a user profile that changes over many sessions. Contexts have 32k, 128k or 1M tokens (README:45-53). The best models scored about 52% (README:86).
- Question types (`prepare_qa.py:164-688`): recall facts, identify new things, generalize past reasons, recall reasons behind updates, track the full sequence of updates, recommend by the latest preference, recall the latest preference.
- Metrics per question: `distance_to_ref_in_tokens` and `num_irrelevant_tokens` (README:66-67).

**How it builds tasks** [code]

- Persona from PersonaHub, then a personal history with `[Fact] Likes`, `[Old Fact]`, `[Updated Fact]`, `[Old Event Date]`, `[Reasons of Change]` (`prompts.py:51-150`).
- Conversations from the history, then a topological sort and concatenation with irrelevant blocks (`prepare_blocks.py:376,592`).
- Multiple choice with three generated distractors: "Make sure each incorrect answer has the same length with the correct one" (`prompts.py:275-280`). One distractor is a stereotype answer (`prepare_qa.py:518`).
- Scoring: extract `(a)` to `(d)` after a final-answer token (`inference.py:54-133`).

**Runtime.** Python 3.9, OpenAI key for generation (`query_llm.py:11-34`), scripts for Claude and Gemini inference. [code]

**License.** MIT for the code. I did not read the dataset license. **Maturity.** 353 commits, research code, hard-coded paths, no tests.

**Fit.** N1 0, N2 0, N3 0, N5 0, N6 0, N7 0. N4 1: the distractor rules and the "state changed over time" question types help us write check questions and test our own state tracker.

**Integration.** (d) Port: 1 day for the distractor rules and a small regression set. **Recommended: (d).** **Best idea.** Test the tracker on updates and reversals, not only on recall. **Main trap.** It tests preferences, so its scores say nothing about knowledge tracing.

## Comparison

|                   | honcho                            | memobase                          | remnic                         | letta-code        | PersonaMem          |
| ----------------- | --------------------------------- | --------------------------------- | ------------------------------ | ----------------- | ------------------- |
| Models            | who a person is                   | who a person is                   | what an agent remembers        | agent self-memory | benchmark           |
| N1                | 1                                 | 0                                 | 1                              | 0                 | 0                   |
| N2                | 1                                 | 0                                 | 1                              | 1                 | 0                   |
| N3                | 0                                 | 1                                 | 1                              | 0                 | 0                   |
| N4                | 1                                 | 1                                 | 2                              | 1                 | 1                   |
| N5                | 1                                 | 1                                 | 1                              | 0                 | 0                   |
| N6                | 0                                 | 0                                 | 0                              | 0                 | 0                   |
| N7                | 2                                 | 1                                 | 2                              | 1                 | 0                   |
| Stack             | Python, Postgres, pgvector, Redis | Python, Postgres, pgvector, Redis | Node, files, SQLite            | Bun or Node, git  | Python              |
| Anthropic LLM     | yes                               | no (OpenAI-compatible only)       | yes                            | yes               | inference only      |
| Embeddings needed | yes (OpenAI or Gemini)            | optional                          | optional                       | no                | no                  |
| License           | AGPL-3.0                          | Apache-2.0                        | MIT                            | Apache-2.0        | MIT                 |
| Activity          | high                              | dormant                           | high, one author               | high              | low                 |
| Recommended       | port ideas                        | port ideas                        | port ideas, copy small modules | port one idea     | port question rules |

## Verdict

**For the learner model (N4)**

1. From remnic: the pure update function. Keep `success` and `fail` counters per learner and topic. Compute `(s + 1) / (s + f + 2)` with a half-life toward 0.5. Pass `now` as an argument.
2. From remnic: `verificationState`. Map it to `self_marked`, `question_checked`, `disputed`. A self-mark sets a prior and a question adds evidence.
3. From memobase and honcho: an append-only evidence log where each row stores its delta. Undo is then one deleted or reversed row.
4. From remnic: the correction classes. Store a misconception as a row with its evidence, not as a lower score.
5. From honcho: the `contradiction` level. Record a conflict and do not resolve it silently.
6. From PersonaMem: distractors with equal length, and tests on state reversals.

**For the topic graph (N1 to N3)**. These projects give two parts only. Use the remnic quote locator for passage links with `charStart` and `charEnd`. Use the memobase normalized key and strict mode so that a second course maps to the same topics. The graph itself needs other sources.

**For the company product (N7)**

- From honcho: `tenant_id` first in each key, row-level security enabled and forced, a startup check that refuses to boot without the policies, scoped tokens, and "scope" as a named group of sources with backfill and removal jobs.
- From remnic: namespaces of kind `project` and `team-project`, and the code symbol graph as a later source.
- From letta-code: the index-then-open pattern for large knowledge sets.

**Not for this product as a running component:** letta-code and PersonaMem. memobase is dormant and has no Anthropic path. honcho is the only one worth a second look as a service, and only for N7, with the AGPL question answered first.
