# Appendix: Cognee, Graphiti and LightRAG as the common knowledge store

This file is an appendix to `../research.md`. It is the report of one read-only research worker from 2026-11-25. The worker read the code and ran nothing. Scores and effort numbers are the judgment of that worker.

1. Use Cognee as the candidate for the common knowledge service. Use Graphiti only as a library.
2. Do three checks before you decide:
   - Start Cognee with Neo4j on your Aura tier. Confirm that `CREATE DATABASE` works.
   - Send one extraction call to `claude-haiku-5-5` through the default `litellm_native` path.
   - Measure the memory of the Cognee container. Your worker has 512 Mi.
3. Plan your own topic id registry, approval step and injection filter. Neither project has them.

Tags: `[C]` read-in-code. `[D]` read-in-docs (README, SECURITY file, docstring, comment). `[I]` inference.
Versions: Cognee 1.6.10 (commit `1961133`). Graphiti `graphiti-core` 0.31.2 (commit `ebef986`). LightRAG 1.5.9 (commit `8697eaa`).
Paths are relative to each project folder.

# 1. Service surface

## Cognee

- The FastAPI app mounts 40 routers (`cognee/api/client.py:387-506`). A scan found about 160 route decorators. `[C]`
- Groups: `auth` (login, register, api-keys), `add`, `cognify`, `update`, `delete`, `forget`, `remember`, `recall`, `search`, `improve`, `memify`, `datasets`, `permissions`, `conflicts`, `proposals`, `provenance`, `ontologies`, `schema`, `visualize`, `skills`, `agents`, `sessions`, `activity`, `settings`, `users`, `llm`, `responses`, `sync`, `slack`, `integrations`, `validate`, `health`. `[C]`
- Auth: `X-Api-Key` header, Bearer JWT and a client JWT, in that order (`cognee/modules/users/get_fastapi_users.py:19-21`). `[C]`
- JWT: secret `FASTAPI_USERS_JWT_SECRET`, lifetime `JWT_LIFETIME_SECONDS`, default 3600 (`cognee/modules/users/authentication/get_api_auth_backend.py:19-20`). An unset secret is random for each process (`.../authentication/get_auth_secret.py:47-53`). `[C]`
- API keys: `GET/POST/DELETE /api/v1/auth/api-keys` (`cognee/api/v1/api_keys/routers/get_api_key_management_router.py:23,63,100`). The limit is 10 keys for each user (`cognee/modules/users/api_key/create_api_key.py:19`). `[C]`
- Auth is on by default. It follows `ENABLE_BACKEND_ACCESS_CONTROL` (`cognee/modules/users/methods/get_authenticated_user.py:40-68`). `[C]`
- Add: `POST /api/v1/add` with `datasetId`, `external_metadata`, `node_set` (`cognee/api/v1/add/routers/get_add_router.py:38-124`). Then `POST /api/v1/cognify` (`cognee/api/v1/cognify/routers/get_cognify_router.py:45-121`). One call does both: `POST /api/v1/remember` (`cognee/api/v1/remember/routers/get_remember_router.py:115`). `[C]`
- Update: `PATCH /api/v1/update?data_id=&dataset_id=` (`cognee/api/v1/update/routers/get_update_router.py:29-83`). `[C]`
- Delete: `DELETE /api/v1/datasets/{dataset_id}/data/{data_id}`. It returns a receipt with the deleted node and edge counts (`cognee/api/v1/datasets/routers/get_datasets_router.py:448-513`). `POST /api/v1/forget` deletes an item, a dataset, the memory only, or everything (`cognee/api/v1/forget/routers/get_forget_router.py:22-90`). `[C]`
- Search: `POST /api/v1/search` with `dataset_ids`, `top_k`, `only_context`, `include_references` (`cognee/api/v1/search/routers/get_search_router.py:37-152,250`). `[C]`
- Graph out: `GET /api/v1/datasets/{dataset_id}/graph` returns all nodes and edges of one dataset. An edge has source, target and label only (`cognee/modules/graph/methods/get_formatted_graph_data.py:10-44`). `[C]`
- Graph out with source links: `GET /api/v1/visualize/json` returns a subgraph and a `provenance_index` (`cognee/api/v1/users/routers/get_visualize_router.py:164-244`). `[D]`
- Source links: each node and edge has source-ref keys with the dataset id, the data id and the chunk id (`cognee/infrastructure/databases/provenance/source_refs.py:7-46`, `cognee/api/v1/visualize/memory_provenance.py:494-547`). `[C]`
- Paging: data items have `limit` and `offset` (`get_datasets_router.py:664-675`). The graph route has no paging. The subgraph route has caps: 500 nodes by default, 5000 as JSON, 20000 as a stream (`cognee/modules/visualization/subgraph_data.py:24-26`, `get_visualize_router.py:35-36`). `[C]`
- Subgraph by dataset: yes. Each graph route takes one dataset id. `[C]`
- SDK: `cognee.add`, `cognify`, `update`, `delete`, `search`, `datasets`, `remember`, `recall`, `improve`, `forget`, `run_custom_pipeline` (`cognee/__init__.py:40-91`). `[C]`
- MCP: the folder `cognee-mcp/` is not in this clone. `AGENTS.md:84-102` names stdio, SSE and HTTP transports, and an API mode with `--api-token`. `[D]` I did not read its tools.

## Graphiti

- REST reference server, 11 routes (`server/graph_service/routers/retrieve.py:17-56`, `ingest.py:51-111`, `main.py:27`). `[C]`
  - Read: `POST /search`, `GET /entity-edge/{uuid}`, `GET /episodes/{group_id}`, `POST /get-memory`.
  - Write: `POST /messages`, `POST /entity-node`, `DELETE /entity-edge/{uuid}`, `DELETE /group/{group_id}`, `DELETE /episode/{uuid}`, `POST /clear`.
  - Health: `GET /healthcheck`.
- The REST server takes an OpenAI key only (`server/graph_service/config.py:10-20`). `POST /messages` stores each item as a chat message and sends no entity types (`ingest.py:56-65`). `[C]`
- MCP server, 13 tools: `add_memory`, `search_nodes`, `search_memory_facts`, `delete_entity_edge`, `delete_episode`, `get_entity_edge`, `get_episodes`, `summarize_saga`, `build_communities`, `add_triplet`, `get_episode_entities`, `clear_graph`, `get_status` (`mcp_server/src/graphiti_mcp_server.py:402-1146`). Transports: stdio, SSE, HTTP (`:1331-1341`). `[C]`
- Auth: none in the two servers. `SECURITY.md:16-19` says: no authentication, no authorization, no isolation of callers, default database credentials. `[D]`
- SDK: `add_episode`, `add_episode_bulk`, `add_triplet`, `search`, `search_`, `remove_episode`, `retrieve_episodes`, `get_nodes_and_edges_by_episode` (`graphiti_core/graphiti.py:1251-2174`). `[C]`
- Add: `add_episode` (`graphiti.py:1334-1351`). Update: no call. Remove the episode, then add it again. Delete: `remove_episode` (`graphiti.py:2174-2251`). Search: `search` with `group_ids` (`graphiti.py:1913-2017`). `[C]`
- Graph out: `EntityNode.get_by_group_ids` and `EntityEdge.get_by_group_ids` with `limit` and `uuid_cursor` (`graphiti_core/nodes.py:675-724`, `graphiti_core/edges.py:486-492`). An edge lists its episode uuids (`edges.py:267-270`). `[C]`
- Paging and subgraph by group are in the library only. No server route reads the graph out. `[C]`

# 2. Permission and tenant model

## Cognee

- Principals are users, roles and tenants (`cognee/modules/users/models/Principal.py:9-22`, `Role.py:8-32`, `Tenant.py:9-32`). One ACL row links a principal, a permission and a dataset (`models/ACL.py:8-22`). `[C]`
- Permissions: read, write, delete, share. Tenant capabilities: `manage_users`, `grant_capabilities`, `revoke_capabilities` (`cognee/modules/users/permissions/permission_types.py:1-25`). `[C]`
- The creator of a dataset gets all four permissions (`cognee/modules/data/methods/create_authorized_dataset.py:14-37`). `[C]`
- A user reads the datasets of its own grants, its agents, its tenants and its roles. A filter keeps the current tenant only (`permissions/methods/get_all_user_permission_datasets.py:24-55`). `[C]`
- Own database: with access control on, each dataset gets its own graph database and vector database (`cognee/context_global_variables.py:267-329`). The handler list is in `cognee/infrastructure/databases/dataset_database_handler/supported_dataset_database_handlers.py:37-85`. `[C]`
- The relational database is always shared (`cognee/infrastructure/databases/__init__.py:9-11`). `[D]`
- Common space: yes. The pipeline user owns the dataset. Grant `read` to a tenant or a role with `POST /api/v1/permissions/datasets/{principal_id}` (`cognee/api/v1/permissions/routers/get_permissions_router.py:38-100`). A principal is a user, a role or a tenant (`permissions/methods/get_principal.py:11-13`). `[C]` `[I]`
- Private spaces: yes. Each user owns its datasets.
- Search over common plus private: send the two dataset ids. The search runs for each dataset and returns one result for each dataset. It does not merge the ranks (`cognee/modules/search/methods/search.py:87-91,145-150`). `[D]`
- A dataset id without the read grant raises `PermissionDeniedError` (`permissions/methods/get_specific_user_permission_datasets.py:30-38`). `[C]`
- Enforcement: an ACL lookup in the application, then separate stores for each dataset.
- Weak points:
  1. `POST /api/v1/auth/register` is always mounted. No switch exists (`cognee/api/client.py:389-393`, `cognee/api/v1/users/routers/get_register_router.py:5-6`). `[C]`
  2. API keys are plain text by default. The hash uses one fixed salt (`cognee/modules/users/api_key/hash_api_key.py:4,21`). A key has no scope field (`models/UserApiKey.py:10-25`). `[C]`
  3. The permission check in the database binding is optional. The caller must check first (`context_global_variables.py:309-317`). `[C]`
  4. With access control off, all datasets share one graph store and one vector store (`context_global_variables.py:15-17`). Search then cannot limit itself to a dataset (`search.py:153-154`). `[D]`
  5. The compose file gives the superuser the password `default_password` (`docker-compose.yml:48`, `cognee/modules/users/methods/create_default_user.py:13-45`). `[C]`
  6. Search stores the query text and the answer in the shared relational database (`search.py:97-98`). `[D]` That is personal data in the common service.

## Graphiti

- `group_id` is a string on each node and edge. The allowed characters are letters, digits, `_` and `-` (`graphiti_core/helpers.py:145-168`). `[C]`
- Neo4j, Kuzu, Neptune: one database and a filter `group_id IN $group_ids` (`graphiti_core/search/search_utils.py:228-229,593-594`, `graphiti_core/driver/driver.py:131-133`). `[C]`
- FalkorDB: one graph for each group id (`graphiti_core/driver/falkordb_driver.py:334-347`, `graphiti_core/graphiti.py:1322-1332`). A search over several ids runs for each graph and joins the lists (`graphiti_core/decorators.py:71-116`). `[C]`
- No identity exists. No code checks who reads or writes a group. `[C]` `SECURITY.md:18`: any caller can read, change or delete data in any group. `[D]`
- Common plus private: possible only as a rule in your back end, with `group_ids=["common", "user_<id>"]`. `[I]`
- Weak points:
  1. An empty `group_ids` removes the filter. The search then reads all groups (`graphiti_core/search/search.py:155-156`). `[C]`
  2. The REST server reads and deletes by uuid with no group check (`server/graph_service/zep_graphiti.py:39-78`). `[C]`
  3. FalkorDB graphs share one connection and one credential. `[I]`
  4. Comments record two old routing defects: episodes in the wrong graph, and empty results (`graphiti.py:1309-1315`, `decorators.py:35-37`). `[D]`

# 3. Custom graph model

## Cognee

- Node types: subclass `DataPoint` (`cognee/infrastructure/engine/models/DataPoint.py:30-95`). The SDK takes the class as `graph_model`. The HTTP route takes a JSON schema (`get_cognify_router.py:69-77`, `cognee/shared/graph_model_utils.py:80-162`). `[C]`
- Prompt: `custom_prompt` (`get_cognify_router.py:78-86`). Ontology: `POST /api/v1/ontologies`, then `ontology_key` (`cognee/api/v1/ontologies/routers/get_ontology_router.py:43-63`, `get_cognify_router.py:96-103`). `[C]`
- A dataset can keep its schema and prompt: `PUT /api/v1/datasets/{dataset_id}/schema` (`get_datasets_router.py:196-198,1304`). `[C]`
- Outside metadata: for each document only. `external_metadata` goes to the data record and, as JSON text, to each chunk (`get_add_router.py:83-94`, `cognee/modules/chunking/models/DocumentChunk.py:57-61`). `[C]`
- A chunk has no character offsets (`DocumentChunk.py:35-61`). `[C]`
- Nodes and edges return the data id and the chunk id through the source refs. `[C]`
- Path for passages: add each passage as one data item. Put `passage_id`, `heading_path` and the offsets in `external_metadata`. `[I]`
- Limit: the chunk-level update refuses a custom graph model or a custom prompt. It rebuilds the full document (`cognee/api/v1/update/update.py:453-457`). `[C]`

## Graphiti

- `add_episode` takes `entity_types`, `edge_types`, `edge_type_map`, `excluded_entity_types`, `custom_extraction_instructions` (`graphiti_core/graphiti.py:1344-1349`). The constructor takes `prompt_library` (`graphiti.py:223`). `[C]`
- The MCP server reads the types from YAML (`mcp_server/src/config/schema.py:217-266`). The REST server has no types. `[C]`
- No ontology file support. A name search found the word in prompts and type maps only. `[C]`
- Outside metadata: `name` and `source_description` are free text. The field `episode_metadata` is on the model, but no code saves or reads it (`graphiti_core/nodes.py:329-351`). `[C]`
- Trap: `add_episode(uuid=...)` loads an episode that exists. It does not create one with that uuid (`graphiti.py:1447-1461`). `[C]`
- Link back: keep your own table from episode uuid to passage id. `[I]`

# 4. Ids for outside references

## Cognee

- Node id: `uuid5(NAMESPACE_OID, "<ClassName>:<identity values>")`. Values are lower case, with `_` for spaces and no apostrophes (`DataPoint.py:217-247`). `Entity` uses `name` (`cognee/modules/engine/models/Entity.py:24`). `[C]`
- A class without `identity_fields` gets a random `uuid4` (`DataPoint.py:89-95`). `[C]`
- Edge id: none. An edge is `(source_id, target_id, relationship_name)` (`cognee/infrastructure/databases/graph/graph_db_interface.py:143-149`). `[D]`
- Chunk id: `uuid5` of document id, content hash and occurrence (`cognee/modules/chunking/chunk_id.py:20-22`). `[C]`
- Update: the document keeps its `data_id` (`cognee/api/v1/update/result.py:56-57`). `[D]` A node keeps its id while the extracted name stays the same. A new name is a new id. `[I]`
- Delete: hard delete. A node goes with its edges (`graph_db_interface.py:150-151`). `[D]` The graph keeps no tombstone.
- Merge: `consolidate_entities` moves the edges to one node and deletes the duplicates. The `merged_from` list is a logged report (`cognee/tasks/memify/consolidate_entities.py:8-12,462`). `[D]` I found no stored redirect.
- Full re-ingest: the same class and name give the same id. A different name from the LLM gives a different id. `[I]`
- Change feed: none for nodes. The nearest thing is the audit ledger. It is off by default (`PROVENANCE_TRACKING`). It has one row for each data item, with versions and delete tombstones (`cognee/tasks/provenance/record_provenance.py:10-26`). `[D]` `GET /api/v1/provenance/export` streams it as JSON lines (`cognee/api/v1/provenance/routers/get_provenance_router.py:130-156`). `[C]`
- A WebSocket reports the status of a pipeline run (`get_cognify_router.py:304`). I found webhook code for integrations only, such as Slack and Linear, and none for graph changes (name search). `[C]`
- Pointer for years: safe only if you control the identity field and keep your own redirect table. `[I]`

## Graphiti

- Node uuid and edge uuid: random `uuid4` (`graphiti_core/nodes.py:94`, `graphiti_core/edges.py:50`). `[C]`
- Dedup: a new mention takes the uuid of the node that exists (`graphiti_core/utils/maintenance/node_operations.py:811`, `dedup_helpers.py:289,341,375`). `[C]`
- Update: no update call. A contradicted edge gets `invalid_at` and `expired_at`, and it stays (`graphiti_core/utils/maintenance/edge_operations.py:748-783`). `[C]`
- Delete: `remove_episode` deletes the episode, the edges that only this episode supports, and the nodes that only this episode mentions (`graphiti.py:2178-2213`). A new add then creates new uuids. `[C]` `[I]`
- No tombstone, no redirect, no event, no webhook. A name search found zero hits. `[C]`
- Pointer for years: not safe without your own registry. `[I]`

# 5. Review and integrity

## Cognee

- `conflicts`: an LLM step in `improve` reads the facts of each entity and writes `FactConflict` nodes (`cognee/memify_pipelines/review_conflicts_pipeline.py:61-80`). `[C]`
- `GET /api/v1/conflicts` lists them. `POST /api/v1/conflicts/{id}/resolve` lets a user with write permission select one fact. The other facts stay as superseded (`cognee/api/v1/conflicts/routers/get_conflicts_router.py:27-78`, `cognee/modules/conflicts/methods.py:185-218`). `[C]`
- The review can resolve a conflict before a person does (`resolution_source`, `cognee/modules/conflicts/models.py:30`). This is a correction after the write. `[C]`
- `proposals`: a read-only view of a skill change. The apply step is `POST /api/v1/remember/entry`. It is for agent skills, not for graph facts (`cognee/api/v1/proposals/routers/get_proposals_router.py:1-7,66`). `[D]`
- `provenance`: a read-only audit ledger with a hash chain. Off by default (`get_provenance_router.py:1-16`). `[D]`
- `improve`: nine automatic stages. Seven need session ids. They move session content and feedback into the graph (`cognee/api/v1/improve/routers/get_improve_router.py:60-69`). `[D]`
- Feedback weights: each node and edge has `feedback_weight` 0.5 (`DataPoint.py:119`). A rating from 1 to 5 moves the weights of the graph elements that an answer used. A rating that the system infers moves them at half rate (`cognee/tasks/memify/feedback_weights_constants.py:15-40`). `[C]` `[D]`
- `forget`: hard delete (`get_forget_router.py:22-59`). `[C]`
- Human approval before a change reaches the graph: no. `[C]`
- Poisoned source: a name search found no filter. The Anthropic adapter puts the source text and the system prompt in one user message (`cognee/infrastructure/llm/structured_output_framework/litellm_instructor/llm/anthropic/adapter.py:118-124`). `[C]`

## Graphiti

- Contradictions: automatic, as in point 4. `SECURITY.md:23`: all episodes of a group have the same trust. A newer episode can change or invalidate older facts. `[D]`
- No approval step. `[C]` No injection defense. `SECURITY.md:17,28-29` puts such reports out of scope. `[D]`

# 6. Stores and hosting

## Cognee

- Graph: `ladybug` or `kuzu` (default, a local file), `neo4j`, `neptune`, `neptune_analytics`, `turso`, `postgres_demo` (`cognee/infrastructure/databases/graph/get_graph_engine.py:356-553`). Vector: `lancedb` (default), `pgvector`, `neptune_analytics`, `turso` (`cognee/infrastructure/databases/vector/create_vector_engine.py:187-314`). Relational: SQLite or Postgres (`cognee/infrastructure/databases/relational/config.py:22`). `[C]`
- FalkorDB is not in the tree. `[C]`
- Production words: Postgres as a graph store is "a demo feature" and "not production-ready" (`README.md:282`, `cognee/infrastructure/databases/graph/postgres_demo/adapter.py:3-8`). The Aura handler is a "development PoC" (`cognee/infrastructure/databases/graph/neo4j_driver/Neo4jAuraDevDatasetDatabaseHandler.py:19-24`). I found no list of production-ready combinations. `[D]`
- Chunk-level update list: the flag `supports_incremental_chunk_updates = True` is on three graph adapters. Ladybug (`graph/ladybug/adapter.py:351`), Neo4j (`graph/neo4j_driver/adapter.py:156`), Postgres demo (`graph/postgres_demo/adapter.py:225`). The default is false (`graph_db_interface.py:195`). `[C]`
- The vector store must have `supports_payload_update`: LanceDB, PGVector, Turso (`LanceDBAdapter.py:1659`, `PGVectorAdapter.py:1246`, `TursoVectorAdapter.py:425`). The graph must keep its provenance in the graph (`cognee/api/v1/update/incremental.py:785-800`). `[C]`
- Smallest deployment: one container with one worker process (`entrypoint.sh:62`). The compose limits are 4 CPU and 8 GB (`docker-compose.yml:65-66`). Two volumes hold the system and data files (`docker-compose.yml:19-20`). File storage can be S3 (`cognee/infrastructure/files/storage/get_file_storage.py:16`). `[C]`
- Cloud Run with managed stores: possible in principle, not at 1 CPU and 512 Mi. `[I]`
- Graph options with access control on:
  - Neo4j with one database for each dataset. The code says this needs Enterprise or AuraDB (`Neo4jDatasetDatabaseHandler.py:31-46`). `[D]`
  - One Aura instance for each dataset, the PoC handler. `[D]`
  - The Postgres demo graph with one schema for each dataset (`PostgresGraphSharedDatasetDatabaseHandler.py:17-31`). `[D]`
  - Access control off, with one shared Neo4j database. `[I]`
- Vector on Supabase: `pgvector_shared` uses one schema for each dataset (`PGVectorSharedDatasetDatabaseHandler.py:17-36`). The default `pgvector` handler runs `CREATE DATABASE` for each dataset (`PGVectorDatasetDatabaseHandler.py:32-54`). `[C]`
- The Neo4j adapter calls APOC and GDS procedures (`graph/neo4j_driver/adapter.py:329-395,1245,2228-2312`). Check them on your Aura tier. `[C]`
- Embeddings: `fastembed` (local CPU), `ollama`, `embedding_worker`, `openai_compatible`, and LiteLLM for other providers (`cognee/infrastructure/databases/vector/embeddings/get_embedding_engine.py:126-181`). With no key, the local model `BAAI/bge-small-en-v1.5` runs (`embeddings/config.py:20-30`). `[C]`
- Embeddings off: no switch found. `MOCK_EMBEDDING` is a test aid (`LiteLLMEmbeddingEngine.py:199`). `[C]`
- Anthropic: the default framework is `litellm_native` (`cognee/infrastructure/llm/config.py:107`). It calls `litellm.acompletion` with `response_format` (`.../litellm_native/native_adapter.py:302-315`). LiteLLM builds the request. I did not read LiteLLM. `[C]`
- Cognee sends `temperature` only if you set `LLM_TEMPERATURE` (`llm/config.py:269-298`). A value other than 1 fails on `claude-haiku-5-5`. `[C]` `[D]`
- The optional instructor path uses the mode `anthropic_tools` (`.../instructor_modes.py:13`). That mode forces a tool. `[I]` No thinking budget in the Cognee code (name search). `[C]`

## Graphiti

- Stores: Neo4j 5.26, FalkorDB 1.1.2, Amazon Neptune with OpenSearch, Kuzu (deprecated) (`README.md:165-166,215-216`). `[D]`
- The graph database also holds the embeddings and the full-text index. Supabase pgvector has no role. `[C]` `[I]`
- Production words: the two servers "are not production deployments" (`README.md:316-319`). The README points to the library in your own service, or to Zep (`README.md:336-341`). `[D]`
- Smallest deployment: one Python container and one graph database (`docker-compose.yml:30,51`). `[C]`
- Cloud Run with managed stores: yes, with Neo4j Aura or FalkorDB Cloud. `[I]`
- `FalkorDriver` takes a user and a password, but no TLS flag. Pass a ready client in `falkor_db` (`graphiti_core/driver/falkordb_driver.py:133-163`). The REST server sends no FalkorDB credentials (`server/graph_service/zep_graphiti.py:86-90`). `[C]`
- Embeddings: OpenAI, Azure OpenAI, Gemini, Voyage (`graphiti_core/embedder/`). The default is OpenAI (`graphiti.py:356-362`). No local embedder is in the tree. No off switch. `[C]` A second vendor is necessary. `[I]`
- Anthropic client: the default model is `claude-haiku-5-5` (`graphiti_core/llm_client/anthropic_client.py:56`). Each call sends `temperature`, default 1 (`graphiti_core/llm_client/config.py:20`), and a forced `tool_choice` (`anthropic_client.py:178,259-267`). No thinking budget. `[C]`
- Effect, from the Claude API reference (cached 2026-11-03): `[D]`
  - `claude-haiku-5-5` accepts a forced tool choice.
  - It accepts `temperature` only with the value 1 on API version `2023-06-01`.
  - API version `2026-10-21` rejects each temperature value with a 400.
  - Opus 5.5, Sonnet 5.5 and Fable 5.1 or later reject a forced tool choice.
- The pin is `anthropic>=0.49.0` with no upper limit (`pyproject.toml:29`). The result depends on the installed SDK. `[I]`
- The client reads content blocks by type, so thinking blocks do not break it (`anthropic_client.py:277-292`). `[C]`

# 7. Data that leaves the service

## Cognee

- Product telemetry goes to `https://test.prometh.ai` (`cognee/shared/utils.py:23,381-383`). `[C]`
- The payload has a machine id, the user id, the tenant id and an id derived from the LLM API key (`utils.py:604-631`). Events add ids such as the dataset id and the data id (`get_datasets_router.py:502-511`). `[C]`
- Stop it: set `TELEMETRY_DISABLED` to any value (`utils.py:575`). `ENV=test` or `ENV=dev` also stops it (`utils.py:578-580`). The API default is `ENV=prod` (`cognee/api/client.py:92`). `[C]`
- API errors use the same function, without the error message (`cognee/api/exception_telemetry.py:14,60-94`). The same switch stops them. `[C]`
- Traces and metrics leave only if you set `OTEL_EXPORTER_OTLP_ENDPOINT` (`cognee/modules/observability/tracing.py:432`). `[D]`
- No update check and no Sentry (name search). `[C]`
- Cloud sync runs only on a call to `POST /api/v1/sync` (`cognee/api/v1/sync/sync.py:571-586`). `[C]`
- The local embedder and LiteLLM can download or call out by themselves. I did not read them. `[I]`

## Graphiti

- One PostHog event, `graphiti_initialized`, with the provider names. Host `https://us.i.posthog.com` (`graphiti_core/telemetry/telemetry.py:18-19,92-114`, `graphiti.py:389-407`). `[C]`
- The REST server builds one client for each request, so each request sends the event (`server/graph_service/zep_graphiti.py:106-118`). `[C]` `[I]`
- Stop it: `GRAPHITI_TELEMETRY_ENABLED=false` (`telemetry.py:22,29-37`). `[C]`
- OpenTelemetry is off without a tracer (`OTEL_TRACING.md:3`). `[D]` No update check (name search). `[C]`

# 8. Effort and risks

All numbers are estimates. `[I]`

## Cognee: 22 to 34 working days

- Hosting and stores: 3 to 5.
- Identities, registration lock, key hash, telemetry off: 1 to 2.
- Topic model, prompt, ontology, quality tests: 4 to 6.
- Passage map, update flow, delete flow: 3 to 4.
- Export to the Postgres mirror, with an id registry: 4 to 6.
- Review step: 4 to 6.
- Hardening and tests: 3 to 5.

Top risks:

1. A custom Topic model stops the chunk-level update. Each edit rebuilds the document.
2. One database for each dataset limits the managed graph options. The Postgres-only path is a demo.
3. Memory. The compose limit is 8 GB.
4. A topic id depends on the name that the LLM extracts.
5. Open registration, plain-text keys and telemetry with ids are the defaults.
6. The code base is large and changes fast.
7. The Anthropic request format is in LiteLLM. It is not verified.

## Graphiti: 23 to 36 working days

- Your own service with auth, routes and paging: 5 to 7.
- Types, prompts, quality tests: 3 to 5.
- Embedding vendor and Anthropic client change: 1 to 3.
- Passage map: 2 to 3.
- Update flow and delete flow, with an id registry: 4 to 6.
- Export to the mirror: 2 to 3.
- Review step: 4 to 6.
- Hosting: 2 to 3.

Top risks:

1. The model is for conversation memory. A newer episode invalidates older facts with no review.
2. The uuids are random. A delete and a new add change them.
3. No service layer exists. You write and secure all of it.
4. A second vendor for embeddings is necessary.
5. The Anthropic client sends parameters that newer models or the newer API version reject.
6. An empty `group_ids` reads all groups.
7. The vendor sends production users to Zep.

# 9. Verdict

Cognee fits better as the shared common knowledge store. `[I]`

- It has datasets with an ACL, so one identity writes and many read.
- It links each node and edge to a document and a chunk.
- It has a graph read-out route, a custom model, an ontology and a delete receipt.

Graphiti fits only as a library in a service that you write. Its fact model with automatic invalidation does not match a curated topic graph. `[I]`

Neither project gives stable ids with redirects, an approval step or an injection defense. If these three are the core of the product, keep the source of truth in your own Postgres tables. `[I]`

You build these parts with Cognee:

1. A topic id registry in Postgres: your id, the Cognee node id, aliases, redirects, tombstones.
2. An export job from the graph route and the provenance index to the mirror tables. It compares snapshots, because no change feed exists.
3. A staging dataset, a diff view and a promote step for approval.
4. An injection filter for source text before the add call.
5. A passage splitter and the map from passage to `data_id`.
6. The Topic model, the prompt, the ontology and a test set.
7. Hardening: a block on registration, hashed keys, telemetry off, secrets.
8. A cost plan for the full rebuild on each edit.

You build these parts with Graphiti:

1. Items 1 to 6 of the Cognee list.
2. The full service: REST routes, auth, queue, limits, health.
3. Read-out routes with paging.
4. A group rule in each call.
5. An update routine: remove the episode, add it again, map the ids again.
6. An embedding client and a changed Anthropic client.
7. A control on the automatic invalidation of curated facts.

# LightRAG, points 1, 2, 4, 6

1. Service surface. `[C]`
   - Documents: upload, text, texts, scan, paginated, delete_document, pipeline_status, track_status (`lightrag/api/routers/document_routes.py:4636-7640`).
   - Query: `/query`, `/query/stream`, `/query/data` (`lightrag/api/routers/query_routes.py:379-1120`).
   - Graph: `/graphs`, `/graph/label/*`, and create, edit, delete, merge for entities and relations (`lightrag/api/routers/graph_routes.py:229-931`).
   - Auth: `X-API-Key` (`LIGHTRAG_API_KEY`), or a JWT login from `AUTH_ACCOUNTS` with `TOKEN_SECRET` (`lightrag/api/auth.py:50-62`, `lightrag/api/utils_api.py:402-436`).
   - Add: `POST /documents/text` or `/documents/upload`. The text request has no id field. The SDK call `ainsert` takes `ids` (`lightrag/lightrag.py:3213-3219`).
   - Update: no route. Delete the document, then insert it again. Delete: `DELETE /documents/delete_document`. Search: `POST /query`.
   - Graph out: `GET /graphs?label=&max_depth=&max_nodes=` (`graph_routes.py:291-296`). Paging is for documents only.
   - No MCP server code is in `lightrag/` (name search, zero hits).
2. Permissions. `[C]`
   - No rights for each user. The JWT roles are `user` and `guest` (`auth.py:43-46`).
   - Isolation is the `WORKSPACE` setting, one workspace for each server process (`lightrag/api/config.py:504-507`).
   - The header `LIGHTRAG-WORKSPACE` is read for `/health` only (`lightrag/api/lightrag_server.py:1917-1932,3046`).
   - Common plus private needs two server processes and a merge in your back end. `[I]`
3. Ids. `[C]`
   - A node id is the entity name (`lightrag/base.py:1243`). An edge is the pair of names (`base.py:1339`).
   - Vector ids: `ent-<md5(name)>`, `rel-<md5(src+tgt)>` (`lightrag/operate.py:2158,2682`). Chunk: `chunk-<md5(content)>` (`lightrag.py:5528`). Document: `doc-<md5(text)>` (`lightrag.py:3354`).
   - A document delete rebuilds the affected entities from the other chunks (`lightrag.py:8137-8148`). `[D]`
   - A merge deletes the source names and returns them as `deleted_entities`. No redirect (`graph_routes.py:791-826`). `[D]`
   - No change feed found. A rename breaks a pointer, because the name is the id. `[I]`
4. Stores and hosting.
   - KV: Json, Redis, PG, Mongo, OpenSearch. Graph: NetworkX, Neo4j, PG with AGE, PG plain tables, Mongo, Memgraph, OpenSearch. Vector: Noop, NanoVectorDB, Milvus, PGVector, Faiss, Qdrant, Mongo, OpenSearch (`lightrag/kg/__init__.py:1`). `[C]`
   - `README.md:394-396`: the defaults are in-memory and not for production. PostgreSQL is the recommended production backend for all four store types. `[D]`
   - `PGTableGraphStorage` uses two plain tables and no AGE extension (`lightrag/kg/pgtable_impl.py:267-275`). `[D]` One container and Supabase Postgres look sufficient. `[I]`
   - Embedding bindings: lollms, ollama, openai, azure_openai, bedrock, jina, gemini, voyageai (`config.py:560-573`). `[C]`
   - Embeddings off: `NoopVectorDBStorage` builds the graph and KV stores only (`lightrag/kg/noop_vector_db_impl.py:12-21`). `[D]`
   - The server has no `anthropic` LLM binding (`config.py:547-556`). `[C]`
   - The library function for Anthropic sends the model, the messages, the system prompt and `max_tokens` 8192. It sends no temperature and no tool choice (`lightrag/llm/anthropic.py:149,201-209`). `[C]`
   - No telemetry found. Langfuse runs only with its keys (`lightrag/llm/openai.py:57-71`). `[C]`

# Read and not read

Read:

- Cognee: `api/client.py` and the routers of `add`, `cognify`, `update`, `delete`, `forget`, `search`, `datasets`, `permissions`, `conflicts`, `proposals`, `provenance`, `improve`. Parts of `update.py`, `incremental.py` and `search.py`. Also the `users` module, `context_global_variables.py`, the dataset database handlers, the adapter flags, the embedding and LLM config, the Anthropic adapter, `shared/utils.py`, the Dockerfile, the compose file.
- Graphiti: `server/`, the MCP server file and its config, `graphiti.py`, `decorators.py`, `helpers.py`, the driver base and the FalkorDB driver, the node and edge models, the Anthropic client, the telemetry module, `SECURITY.md`, `README.md`.
- LightRAG: the route decorators, `auth.py`, `utils_api.py`, `config.py`, the storage list, the Anthropic function, the id calls.

Not read:

- `cognee-mcp/` and the Cognee `docs/` folder. They are not in this clone.
- LiteLLM and instructor. They are dependencies.
- The Cognee bodies of `recall`, `sessions`, `agents`, `skills`, `integrations`, and the WebSocket handlers.
- The Graphiti drivers for Kuzu and Neptune, and the search rerank code.
- The LightRAG parser, the web UI, and the bodies of merge and delete.

Limits:

- I ran no code from the three projects.
- Each "none found" result comes from a name search, not from a full read.
- Statements about Aura, FalkorDB Cloud and Supabase limits are inference. I did not check the vendors.
