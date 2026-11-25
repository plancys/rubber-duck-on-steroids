# Appendix: Graphiti and Mem0

This file is an appendix to `../research.md`. It is a short form of the report of one read-only research worker from 2026-11-25. The worker read the code and ran nothing. Scores and effort numbers are the judgment of that worker. The researcher checked the lines marked "checked" again.

Paths are relative to each project folder. Graphiti: commit `ebef986` (2026-11-11), version 0.31.2. Mem0: commit `f1791daa` (2026-11-06), Python 2.2.1, TypeScript 3.3.1.

## Graphiti

### Data model

- `EntityNode`: `uuid`, `name`, `group_id`, `labels`, `name_embedding`, `summary`, `attributes` (`graphiti_core/nodes.py:93-98,499-504`).
- `EpisodicNode`: one input text. Fields: `source`, `source_description`, `content`, `valid_at`, `entity_edges` (`graphiti_core/nodes.py:54-77,318-332`).
- `EntityEdge`: `name`, `fact`, `fact_embedding`, `episodes`, `valid_at`, `invalid_at`, `expired_at`, `reference_time`, `attributes` (`graphiti_core/edges.py:263-290`, checked).
- Other edges: `MENTIONS` from an episode to an entity, community edges, and an ordered chain of episodes.

### The `add_episode` path and its model calls

Source: `graphiti_core/graphiti.py:1334-1586`.

1. Load the last 10 episodes of the group as context. No model call.
2. Extract nodes: 1 call (`utils/maintenance/node_operations.py:299-329`).
3. Resolve nodes: 0 or 1 call for all names that the rules did not resolve.
4. Extract edges: 1 call. The call also returns `valid_at` and `invalid_at`.
5. Resolve nodes again for names that the edge call invented: 0 or 1 call.
6. For each edge: 0 or 1 call that finds duplicates and contradictions.
7. For each edge and each node with custom fields: 0 or 1 attribute call.
8. Summaries: 1 call for each 30 nodes, when the summary text passes 2,000 characters.

The worker counts 2 calls as the minimum, and 3 calls plus 1 for each edge as the typical case. The worker estimates about 10 calls for each passage, and about 1.3 USD for a course of 160 passages on `claude-haiku-5-5`.

### The identity check (node resolution)

Source: `utils/maintenance/node_operations.py:816-910`, `utils/maintenance/dedup_helpers.py:259-380`.

1. Candidates for each name: a lookup by identity property, a lookup by exact name, and a cosine search with a limit of 15 and a minimum of 0.6.
2. Rule pass: a match on identity properties, then one exact match on the normalized name, then MinHash with a Jaccard value of 0.9 or more.
3. Model pass for the rest, in one batch call. The model returns a `duplicate_candidate_id`, or -1 for no duplicate (`prompts/dedupe_nodes.py:146-159`).
4. Guard code ignores invalid or repeated ids. A map rewrites the edge pointers.
5. The search stays inside one `group_id`.

### Relations over time

- One call returns `duplicate_facts` and `contradicted_facts` (`prompts/dedupe_edges.py:25-33`).
- Code applies the time rules. It sets `invalid_at` of the old edge to `valid_at` of the new edge, and it sets `expired_at` to now. It keeps the old edge (`utils/maintenance/edge_operations.py:715-783`).

### Schema

- `entity_types` and `edge_types` are dictionaries of Pydantic models. `edge_type_map` maps a pair of node types to the allowed edge names (`graphiti_core/graphiti.py:921-926`, checked).
- `strict_edge_types` exists on the bulk path only. Without it, an unknown relation gets a free name.
- `LLMPromptOverrides` replaces a prompt without a fork (`llm_client/prompt_config.py:32`, checked).

### Limits for this product

- A graph database is mandatory. The driver folder holds Neo4j, FalkorDB, Kuzu and Neptune, and no Postgres driver (`graphiti_core/driver/`, checked).
- Embeddings are mandatory. The shipped embedders are OpenAI, Azure OpenAI, Gemini and Voyage.
- The default prompts target the memory of an agent. One line says: "NEVER extract abstract concepts, feelings, or generic words." (`prompts/extract_nodes.py:87`, checked). A course topic is an abstract concept, so the prompts need a replacement.
- The link to the source is a list of episode ids on each edge. No field holds an offset or a quote. A fact points to a passage only when one episode is one passage.
- `remove_episode` deletes a node that only this episode mentions (`graphiti_core/graphiti.py:2181-2213`). The topic identity is then lost.
- `group_id` is a partition, not access control.
- The FastAPI server takes chat messages only, and the worker found no auth code in it.
- Telemetry goes to PostHog by default. `GRAPHITI_TELEMETRY_ENABLED=false` stops it.

### Fit and options

| Need | Score | Reason                                                              |
| ---- | ----- | ------------------------------------------------------------------- |
| N1   | 2     | Typed nodes and edges. No passage spans and no prerequisite logic.  |
| N2   | 2     | Incremental adds are the core design. A removal can delete a topic. |
| N3   | 2     | A strong identity check, inside one group only. No alias table.     |
| N4   | 0     | No learner model.                                                   |
| N5   | 1     | Node summaries help. No path logic.                                 |
| N6   | 1     | Subgraphs from search and communities. No user interface.           |
| N7   | 2     | Many sources and group partitions. No access control.               |

| Option                              | Effort        | Risk                                                               |
| ----------------------------------- | ------------- | ------------------------------------------------------------------ |
| Service beside the worker           | 6 to 10 days  | High. A graph database outside RLS, an embedding provider, a sync. |
| Library in a Python job             | 5 to 8 days   | High. The same needs.                                              |
| Fork with a Postgres driver         | 15 to 25 days | High. About 11 operation classes for each driver.                  |
| Port the ideas to Node and Postgres | 5 to 8 days   | Medium. The prompts need our own evaluation set.                   |

The worker recommends the port. Best idea: the identity check in three steps, where the model only selects a candidate id from a short list. Main trap: the design targets conversations, and its provenance stops at the episode.

## Mem0

- The open-source version stores short text facts in a vector store. It has no graph memory. The folder `mem0/` holds no graph module, and the docs list Graph Memory as a Platform feature (`docs/platform/platform-vs-oss.mdx:70,106`, checked).
- `add` makes one model call that only adds facts (`mem0/memory/main.py:881-1220`, `mem0/configs/prompts.py:468-944`). The older prompts for update and delete have no caller.
- Entities come from spaCy and rules, with no model call. An entity links to an existing entity on exact text or on a cosine value of 0.95 or more.
- A SQLite `history` table records each change: old value, new value and event (`mem0/memory/storage.py:108-119`).
- The Anthropic providers send `temperature` 0.1. The worker infers that `claude-haiku-5-5` rejects this value. Nobody ran it.
- The TypeScript version has the same pipeline. It can run in Node with pgvector and Anthropic after four setting changes.
- Fit: N1 0, N2 1, N3 1, N4 1, N5 1, N6 0, N7 1.
- Two ideas to take: show the model small integer ids in place of UUIDs and map them back in code (`mem0/memory/main.py:936-940`), and keep a history table.

## What the worker did not inspect

- Graphiti: the Cypher of the drivers, the search internals, the examples and the test bodies.
- Mem0: the platform client, most vector stores, the rerankers, the CLI and the integrations.
