# Appendix: Cognee, GraphRAG, LightRAG and three more graph builders

This file is an appendix to `../research.md`. It is the report of one read-only research worker from 2026-11-25. The worker read the code and ran nothing. Scores and effort numbers are the judgment of that worker.

## Recommended action

1. Build the topic graph in our TypeScript worker and in Supabase Postgres. Do not adopt one of these projects as the base today.
2. Port these ideas: the Cognee identity and update design, the neo4j-graphrag schema and pattern pruning, the LightRAG extraction prompt and delete-rebuild cache, the GraphRAG gleaning loop and community reports.
3. Keep Cognee as the candidate second service for N7. Decide when N7 becomes a real requirement.
4. Design these parts yourself. No project supplies them: prerequisite edges, passage spans, cross-course topic resolution with an audit trail, the learner state (N4 to N6).

## Evidence classes

- (S) = read in source. I made shallow clones on 2026-11-25. Links use `https://github.com/<repo>/blob/<sha>/<path>#L<n>`.
- (D) = read in official docs only. (I) = my inference. (E) = my estimate.
- Commits: cognee `1961133` (main, 2026-11-20), graphrag `bc7c828` (2026-11-25), LightRAG `8697eaa` (2026-11-25), neo4j-graphrag-python `eaa0131` (2026-11-24), llama_index `99d7433` (2026-11-13), itext2kg `840aba2` (2026-09-04).
- Stars, releases and licenses come from the GitHub API on 2026-11-25.
- Price basis for cost: claude-haiku-5-5 at 0.10 USD input and 0.50 USD output per million tokens (Anthropic model table, cached 2026-11-03).
- Corpus assumption (E): 150 lessons x 4,000 characters = 150k to 210k tokens.

## 1. Cognee (topoteretes/cognee)

1. **What it is.** A memory platform for agents: `add` -> `cognify` -> `search`. Version 1.6.10 (2026-11-18). Data model (S):
   - `DataPoint`: id, created_at, updated_at, ontology_valid, ontology_uri, version, metadata {index_fields, identity_fields}, type, belongs_to_set, source_pipeline, source_task, source_content_hash, feedback_weight, importance_weight. `cognee/infrastructure/engine/models/DataPoint.py#L95-L120`.
   - `DocumentChunk`: text, chunk_index, cut_type, content_hash, chunker_id, is_part_of (Document), contains (entities), document_id. `cognee/modules/chunking/models/DocumentChunk.py#L35-L66`.
   - `Entity`: name, is_a (EntityType), description, relations. `EntityType`: name, description. `cognee/modules/engine/models/Entity.py`.
   - No communities in the default pipeline.
2. **Pipeline** (S, `cognee/api/v1/cognify/cognify.py#L695-L752`):
   - Classify documents. Chunk by paragraph (`TextChunker`). Chunk size = min(embedding limit, half of the LLM context). `cognee/infrastructure/llm/utils.py#L13-L41`.
   - One structured-output LLM call for each chunk. `cognee/tasks/graph/extract_graph_from_data.py#L265-L277`. Prompt: "You are a top-tier algorithm designed for extracting information in structured formats to build a knowledge graph." and "Ensure you use basic or elementary types for node labels." (`cognee/infrastructure/llm/prompts/generate_graph_prompt.txt`).
   - No gleaning. The chunk summary comes from the extraction result, with no LLM call (default `summary_method = "from_extraction"`, `cognee/modules/cognify/config.py#L22`).
   - Merge: entity id = `uuid5(NAMESPACE_OID, "Entity:" + normalized name)`. `DataPoint.py#L219-L247`, `cognee/modules/graph/utils/expand_with_nodes_and_edges.py#L128`. Dedup is by id only. No LLM merge of descriptions (I: the upsert overwrites).
   - Schema, option A: a custom `graph_model` made of Pydantic `DataPoint` subclasses. The LLM fills the classes. `cognify.py#L141`.
   - Schema, option B: an OWL or RDF ontology. RDFLib resolver, fuzzy match with difflib cutoff 0.8 (`cognee/modules/ontology/matching_strategies.py#L21-L50`). Mode `annotate` (default) or `strict` (drops unmatched entities) (`cognee/modules/ontology/ontology_env_config.py#L12`).
   - (D) The two options do not stack in one call. https://docs.cognee.ai/core-concepts/further-concepts/ontologies
   - Provenance: an edge chunk -`contains`-> entity with text (`expand_with_nodes_and_edges.py#L155-L174`). Graph rows also carry `source_ref_keys`, `source_dataset_ids`, `source_run_ids` (`cognee/infrastructure/databases/graph/postgres_demo/tables.py`).
3. **Update and delete** (S). This is the strongest part.
   - `update(data_id, data, dataset_id, chunk_level_diff=True)` keeps the `data_id`. It diffs the new text against the stored text and extracts only the changed chunks. `cognee/api/v1/update/update.py#L42-L133`, `cognee/api/v1/update/incremental.py#L1-L45`.
   - Delete uses reference counts of source refs. An entity without a remaining owner is removed. `cognee/infrastructure/databases/unified/provenance_delete_planner.py#L1-L24`.
   - The chunk-level path falls back to a full rebuild for an "unverified graph adapter". I did not find the list of verified adapters.
   - Entity ids are stable while the LLM gives the same name.
4. **Storage and LLM** (S). Defaults: SQLite, LanceDB, Ladybug (Kuzu). Also Postgres, pgvector, Neo4j, Neptune, Turso. A Postgres graph adapter exists, but the file says "DEMO ... not production-ready" (`graph/postgres_demo/adapter.py#L1-L9`). Anthropic adapter exists. (D) "Anthropic is an LLM provider, not an embedding provider. Pair it with ... OpenAI, Gemini, or Fastembed." Fastembed runs locally.
5. **License and maturity.** Apache-2.0. 33,600 stars. About one release each week (v1.6.6 on 2026-10-29 to v1.6.10 on 2026-11-18). About 1,640 test files and 69 CI workflows (S). 1,764 non-test Python files, about 272k lines. To extract only the graph builder is hard: it depends on the pipeline engine, the user model and three stores.
6. **Cost** (E). 150 to 450 LLM calls (one for each chunk). 0.4M to 1.0M input tokens, 0.15M to 0.5M output tokens. About 0.10 to 0.35 USD. Cognee has a dry-run estimator: `cognee/modules/cognify/estimator.py#L1-L16`.
7. **Fit.** N1: 2 (typed nodes and named edges, chunk provenance, no spans). N2: 3 (chunk-level diff, stable ids, ref-count delete). N3: 2 (same name gives same id, ontology fuzzy match, no embedding or LLM resolution). N4: 0. N5: 1 (chunk summaries only). N6: 1 (generic graph view). N7: 3 (tenants, roles, dataset permissions, many loaders, code graph).
8. **Integration.**
   - (a) Service: 5 to 10 days. Risk high: three stores, memory above 512 Mi (I), its permission model duplicates Supabase RLS, the Postgres graph adapter is a demo.
   - (b) Library: Python only, so it equals (a).
   - (c) Fork: 15 days or more. Risk very high (272k lines, weekly releases).
   - (d) Port ideas: 5 to 8 days. Risk low.
   - Recommended: (d) now. Use (a) if N7 starts.
9. **Best idea:** deterministic ids from identity fields, plus chunk-level diff, plus ref-counted provenance. **Trap:** the name is the identity. "Repeatable read" and "REPEATABLE READ isolation" become two topics.

## 2. Microsoft GraphRAG (microsoft/graphrag)

1. **What it is.** A batch indexer that writes tables for global and local search. Version 3.3.0 (2026-10-08). Columns (S, `packages/graphrag/graphrag/data_model/schemas.py#L70-L158`):
   - documents: id, title, text, text_unit_ids, creation_date.
   - text_units: id (sha512 of the text), text, n_tokens, document_id, entity_ids, relationship_ids.
   - entities: id (uuid4), human_readable_id, title, type, description, text_unit_ids, frequency, degree.
   - relationships: id, source, target, description, weight, combined_degree, text_unit_ids.
   - communities: community, level, parent, children, entity_ids, relationship_ids, text_unit_ids, period, size.
   - community_reports: title, summary, full_content, rank, rating_explanation, findings.
2. **Pipeline** (S, `index/workflows/factory.py#L52-L61`):
   - Chunk: 1,200 tokens, overlap 100 (`config/defaults.py#L61-L62`).
   - Extract: 1 call for each chunk, plus 1 gleaning call (`max_gleanings = 1`, `defaults.py#L137`, `index/operations/extract_graph/graph_extractor.py#L101-L116`). Prompts: "identify all entities of those types from the text and all relationships among the identified entities" and "MANY entities and relationships were missed in the last extraction." (`prompts/index/extract_graph.py#L8`, `#L128`).
   - Merge: group by (title, type). Names are upper-cased. `extract_graph.py#L104-L126`, `graph_extractor.py#L146-L147`.
   - Summary: 1 call for each entity or relationship with more than one description. "Please concatenate all of these into a single, comprehensive description." (`prompts/index/summarize_descriptions.py#L9`).
   - Communities: hierarchical Leiden, `max_cluster_size = 10` (`index/operations/cluster_graph.py#L11-L87`). One report call for each community, JSON with title, summary, rating, findings (`prompts/index/community_report.py#L9-L37`).
   - Schema: `entity_types` is a prompt list (default organization, person, geo, event). Relations have no type, only a description and a strength.
   - Provenance: `text_unit_ids` on entities and relationships.
3. **Update and delete** (S). The update pipeline finds new documents by title only. It computes `deleted_inputs` but no other code reads it. `index/update/incremental_index.py#L48-L58`. A changed lesson with the same title is ignored. A deleted lesson stays in the graph. On merge, an old entity keeps its id by title (`index/update/entities.py#L33-L59`). A full re-index gives new uuid4 ids (`index/operations/finalize_entities.py#L49`).
4. **Storage and LLM** (S). Files, memory, Azure Blob, Cosmos DB. Vectors: LanceDB, Azure AI Search, Cosmos DB. No Postgres. LLM through LiteLLM, so Anthropic works by configuration (D, `docs/config/yaml.md#L47`). (D) "most thoroughly tested with the gpt-4 series". Embeddings need a second provider.
5. **License and maturity.** MIT. 36,753 stars. About one release each month (v3.1.2 on 2026-08-21, v3.2.0 on 2026-09-24, v3.3.0 on 2026-10-08). 128 test files. 8 packages, about 37.7k Python lines. The extractor is small (about 190 lines) but the pipeline uses pandas and parquet.
6. **Cost** (E). 900 to 1,900 calls: 300 to 600 extraction, 400 to 900 summary, 200 to 400 community reports. 3M to 6M input tokens, 0.8M to 1.5M output tokens. About 0.70 to 1.40 USD for each full index.
7. **Fit.** N1: 1 (untyped relations). N2: 1 (adds new documents only, unstable ids). N3: 1 (exact title). N4: 0. N5: 1 (community reports are ready summaries). N6: 1 (the community hierarchy gives "one part at a time", no user interface for it). N7: 1 (no tenants, no access control, no Postgres).
8. **Integration.**
   - (a) Batch service plus import of parquet into Postgres: 5 to 8 days. Risk high (no real update, ids change).
   - (b) Library: Python only.
   - (c) Fork: 10 days or more. Risk high.
   - (d) Port ideas: 2 to 4 days. Risk low.
   - Recommended: (d).
9. **Best idea:** the gleaning loop, and community reports as the unit for display and summary. **Trap:** it is a batch system. One changed lesson means a rebuild, and all entity ids change.

## 3. LightRAG (HKUDS/LightRAG)

1. **What it is.** A graph plus vector retrieval library with an API server. Release 1.5.8 (2026-11-23). Data model (S):
   - Document: id = md5 of the file path, or of the content (`lightrag/pipeline.py#L1091-L1093`).
   - Chunk: id = md5 of the content (`lightrag/lightrag.py#L5528`), with content, file_path, parent headings (`lightrag/chunk_schema.py#L63`).
   - Entity node: the key is the entity name. Fields: entity_type, description, source_id (list of chunk ids), file_path. `lightrag/operate.py#L2820-L2921`.
   - Edge: src, tgt, weight, keywords, description, source_id. Edges are stored in canonical order min/max (`lightrag/kg/pgtable_impl.py#L11-L16`).
   - Vector ids: `ent-` + md5(name), `rel-` + md5(src+tgt) (`operate.py#L2158`, `#L2682`). No communities.
2. **Pipeline** (S):
   - Chunk: 1,200 tokens by default. A paragraph-and-heading chunker exists.
   - Extract: 1 call for each chunk, plus 1 gleaning call (`DEFAULT_MAX_GLEANING = 1`, `lightrag/constants.py#L24`). Limit of 100 rows and 40 entities for each response (`constants.py#L33-L34`).
   - Prompts (`lightrag/prompt.py`): "You are a Knowledge Graph Specialist responsible for extracting entities and relationships" (L57). "Treat all relationships as **undirected** unless explicitly stated otherwise" (L100). Gleaning: "identify and extract any missed or incorrectly formatted entities and relationships" (L146).
   - The prompt receives the section heading path of the chunk (`prompt.py#L51-L52`).
   - Merge: exact entity name. The LLM summary runs only at 8 or more descriptions, or above the token limit (`constants.py#L37`, `operate.py#L416-L481`). No automatic entity resolution. `amerge_entities` is a manual API (`lightrag.py#L9774`).
   - Schema: entity types are prompt guidance only (`prompt.py#L20-L34`). The code only cleans the type string (`operate.py#L714-L760`). Relation types are free keywords. A `kg_extraction_validator` hook can filter records (`operate.py#L4335-L4379`).
   - Provenance: `source_id` lists up to 200 chunk ids for each entity and relation (`constants.py#L78-L79`).
3. **Update and delete** (S). A second insert of the same file path is a duplicate. LightRAG does not index it again (`pipeline.py#L1087-L1099`, `#L1432-L1447`). To change a document: `adelete_by_doc_id`, then insert. Delete rebuilds shared entities from the cached extraction results of the other chunks (`lightrag.py#L8140-L8148`, `operate.py#L1169`). Entity ids are stable by name.
4. **Storage and LLM** (S). Postgres alone works: `PGKVStorage`, `PGVectorStorage`, `PGDocStatusStorage`, and for the graph `PGGraphStorage` (Apache AGE) or `PGTableGraphStorage` (plain tables, no extension) (`lightrag/kg/__init__.py`, `kg/pgtable_impl.py#L1-L20`). Supabase has no AGE (I, not checked today), so the plain-table store is the one to use. Other stores: JSON, NetworkX, Neo4j, Memgraph, MongoDB, Redis, Milvus, Qdrant, Faiss, OpenSearch. `NoopVectorDBStorage` allows graph-only ingestion without embeddings (`kg/noop_vector_db_impl.py#L1-L22`). An Anthropic binding exists (`lightrag/llm/anthropic.py#L70`). Embeddings need Voyage, OpenAI, Ollama, Gemini or Jina.
5. **License and maturity.** MIT. 40,863 stars. Stable releases: v1.5.7 on 2026-09-02, v1.5.8 on 2026-11-23, with release candidates between them. Commits arrive daily. 819 test files. About 189k Python lines in `lightrag/`. Four files have 8,000 to 9,900 lines each. To extract code is hard. To port ideas is easy (`prompt.py` has 900 lines).
6. **Cost** (E). 320 to 680 calls. 1.4M to 2.7M input tokens, 0.2M to 0.45M output tokens. About 0.25 to 0.50 USD.
7. **Fit.** N1: 1 (undirected edges, free relation keywords). N2: 2 (delete with rebuild from cache, document level only). N3: 1 (exact name, manual merge). N4: 0. N5: 0. N6: 1 (the web user interface shows a bounded subgraph). N7: 2 (workspace separation, Postgres only, no access control for each user).
8. **Integration.**
   - (a) Service on Supabase Postgres with the plain-table graph store: 3 to 5 days. Risk medium: tables without RLS, and the graph has no types or direction.
   - (b) Library: Python only.
   - (c) Fork: 10 to 15 days. Risk high (fast change, very large files).
   - (d) Port ideas: 3 to 5 days. Risk low.
   - Recommended: (d). Use (a) only for a fast prototype of retrieval.
9. **Best idea:** the extraction cache for each chunk, so a delete rebuilds entities without new LLM calls. Also the heading path in the prompt. **Trap:** edges have no direction. A "prerequisite-of" relation cannot survive the storage layer.

## 4. Other projects that add an option

### neo4j-graphrag-python (neo4j/neo4j-graphrag-python, 1.24.0, 2026-11-10, Apache-2.0, 1,340 stars)

- (S) The best schema model. `GraphSchema` has node_types, relationship_types, patterns (source, relationship, target), constraints, and `additional_*` flags. `src/neo4j_graphrag/components/schema.py#L151-L504`.
- (S) Prompt: "Use only the following node and relationship types" and "Do respect the source and target node types for relationship and the relationship direction." `src/neo4j_graphrag/generation/prompts.py#L174-L179`.
- (S) `GraphPruning` removes each item that breaks the schema: NOT_IN_SCHEMA, INVALID_PATTERN, MISSING_REQUIRED_PROPERTY. `components/graph_pruning.py#L40-L46`.
- (S) Lexical graph: Document, Chunk, `FROM_DOCUMENT`, `NEXT_CHUNK`, and entity -`FROM_CHUNK`-> chunk. `components/types.py#L236-L240`.
- (S) Entity resolution after the write: exact name, fuzzy (rapidfuzz), semantic (spaCy). It uses APOC in Neo4j. `components/resolver.py#L73-L434`.
- (S) Node ids are uuid4 for each run. I found no update or delete flow in the builder guide (I: none exists).
- Needs Neo4j. Anthropic LLM class exists. About 26k lines, 132 test files.
- Fit: N1 2, N2 1, N3 2, N4 0, N5 0, N6 1, N7 1. Option: port the schema, the patterns and the pruning (2 to 3 days).

### LlamaIndex PropertyGraphIndex with SchemaLLMPathExtractor (run-llama/llama_index, v0.14.26, 2026-11-13, MIT, 53,002 stars)

- (S) `possible_entities` and `possible_relations` are `Literal` types. `kg_validation_schema` lists valid triples. `strict=True`, `max_triplets_per_chunk=10`. `llama-index-core/llama_index/core/indices/property_graph/transformations/schema_llm.py#L144-L158`.
- (S) Entity id = entity name (`graph_stores/types.py#L71-L73`). Provenance = one `triplet_source_id` property (`property_graph/base.py#L228-L230`). The last chunk wins (I).
- (S) `ref_doc_info` raises `NotImplementedError` (`base.py#L405-L409`). No refresh for a changed document.
- (S) Graph stores: memory, Neo4j, Memgraph, FalkorDB, Nebula, Neptune, TiDB, ApertureDB. No Postgres property graph store.
- Fit: N1 2, N2 1, N3 1, N4 0, N5 0, N6 0, N7 1. Option: port the strict triple validation (1 day).

### iText2KG (AuvaLab/itext2kg, v1.1.0, 2026-09-04, Apache-2.0, 980 stars)

- (S) An incremental builder of about 5.2k lines. It matches new entities and relations to the existing graph with cosine similarity of embeddings, threshold 0.8. The same name and label is the same entity. `itext2kg/itext2kg_star/graph_matching/matcher.py#L17-L51`, `#L105-L125`.
- (S) Only a Neo4j writer. I did not find schema enforcement or chunk provenance in the files that I read.
- Fit: N1 1, N2 1, N3 2, N4 0, N5 0, N6 0, N7 0. Option: port the matcher idea for N3 (1 to 2 days). It needs embeddings.

### Not selected

- R2R: last release v3.6.5 on 2025-06-06, last push 2025-11-07. Not maintained now.
- KGGen: v0.4.0, last push 2026-03-24, 1,298 stars. Slow maintenance.
- Neo4j LLM Knowledge Graph Builder: an application on Neo4j (v0.8.7, 2026-07-23). Same ideas as neo4j-graphrag.
- Graphiti (getzep/graphiti, not in your list, 33,086 stars, Apache-2.0): `add_episode` accepts `entity_types`, `edge_types`, `edge_type_map`, `group_id` (S, `graphiti_core/graphiti.py`). It has dedupe prompts and an Anthropic client. I did not evaluate it in depth. Examine it for N3 if you want a fourth option.

## 5. Comparison

|                               | Cognee                  | GraphRAG       | LightRAG              | neo4j-graphrag         | LlamaIndex PGI | iText2KG       |
| ----------------------------- | ----------------------- | -------------- | --------------------- | ---------------------- | -------------- | -------------- |
| Entity types fixed by schema  | yes (model or ontology) | prompt list    | prompt guidance       | yes, pruned            | yes, strict    | no             |
| Relation types fixed          | yes (model)             | no             | no, undirected        | yes, with direction    | yes            | no             |
| Link to source chunk          | yes                     | yes            | yes (max 200)         | yes                    | one only       | not found      |
| Entity id                     | uuid5 of name           | uuid4 each run | md5 of name           | uuid4 each run         | name           | name and label |
| Entity resolution             | name, ontology fuzzy    | exact title    | exact name            | exact, fuzzy, semantic | none           | embeddings 0.8 |
| Changed document              | chunk-level diff        | ignored        | delete and insert     | none                   | none           | add only       |
| Postgres only                 | partly (graph is demo)  | no             | yes                   | no                     | no             | no             |
| Anthropic LLM                 | yes                     | by LiteLLM     | yes                   | yes                    | yes            | by LangChain   |
| Embeddings necessary          | yes                     | yes            | optional (noop store) | yes                    | optional       | yes            |
| License                       | Apache-2.0              | MIT            | MIT                   | Apache-2.0             | MIT            | Apache-2.0     |
| LLM calls for 150 lessons (E) | 150-450                 | 900-1,900      | 320-680               | 150-600                | 150-300        | 300-600        |
| Cost, Haiku 5.5 (E)           | 0.10-0.35 USD           | 0.70-1.40 USD  | 0.25-0.50 USD         | below 0.50 USD         | below 0.30 USD | below 0.50 USD |
| N1 N2 N3 N4 N5 N6 N7          | 2 3 2 0 1 1 3           | 1 1 1 0 1 1 1  | 1 2 1 0 0 1 2         | 2 1 2 0 0 1 1          | 2 1 1 0 0 0 1  | 1 1 2 0 0 0 0  |

LLM cost is not the constraint. All options stay far below 5 USD for each month. The constraints are the runtime (a Python service beside a 512 Mi Node worker), the embedding provider, and the data model.

## 6. Verdict

- **Best base for N1 to N3:** the Cognee design, ported. Add the neo4j-graphrag schema with patterns and pruning for N1. Add an alias table and an embedding or LLM match step (iText2KG, neo4j-graphrag resolvers) for N3.
- **Best base for N7:** Cognee as a service. It is the only project with tenants, roles, dataset permissions, many loaders and a chunk-level update.
- **Fastest runnable prototype on our Postgres:** LightRAG with `PGTableGraphStorage`. Its graph has no types and no direction.
- **Parts that no project covers:**
  - Prerequisite edges with direction, evidence and a cycle check.
  - Passage spans (offsets or heading anchors). All projects stop at the chunk id.
  - Control of topic granularity ("finer than a lesson").
  - Cross-course topic identity with aliases and an inspectable merge record.
  - The learner state: uncertainty, decay, deterministic updates (N4). Also N5 and the overlay in N6.
  - Separation of tenants through Supabase RLS.
- **JavaScript or TypeScript:** I found no maintained port of GraphRAG, LightRAG or Cognee.
  - LlamaIndexTS is archived (last push 2026-03-11). A code search found no `PropertyGraphIndex` in it.
  - LangChain.js `LLMGraphTransformer` (allowed nodes and relationships as enum values) is in `langchain-ai/langchainjs-community`, which GitHub shows as archived (last push 2026-05-27). Its maintenance status is not clear (I).
  - Mastra `GraphRAG` is a chunk-similarity graph with only `semantic` edges. It is not an entity graph (S, `packages/rag/src/graph-rag/index.ts#L8-L63`).
  - Small projects, not read in source: `sadofriod/graphrag-ts` (10 stars, Postgres and pgvector), `nicia-ai/typegraph` (94 stars, a typed graph store on Postgres with Zod schemas, not an extractor).

## 7. Limits of this research

- I did not run a project. All costs are estimates from prompt sizes and defaults.
- I did not verify which Cognee graph adapters permit the chunk-level update.
- I did not verify memory use of a service on Cloud Run.
