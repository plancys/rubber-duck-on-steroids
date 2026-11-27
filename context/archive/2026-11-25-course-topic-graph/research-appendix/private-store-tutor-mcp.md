# Appendix: Tutor MCP as the private learner store

This file is an appendix to `../research.md`. It is the report of one read-only research worker from 2026-11-25. The worker read the code and ran nothing. Scores and effort numbers are the judgment of that worker.

Choose option (c): port the engine ideas to TypeScript and Postgres. Do not run Tutor MCP as the private store. Reasons are in section 8.

Tags: [code] = read in code, [docs] = read in docs, [inf] = inference. Paths are relative to `tutor-mcp/`. Commit `2f3e3a5` (v0.7.5 + 2), alpha status (`README.md:8`, `SECURITY.md:5`), one main author, 530 commits. [code]

## 1. Deployment profiles

**Local stdio.** One process for each MCP client, no HTTP (`local.go:36-106`). SQLite and `keys.json` are in `~/.tutor-mcp/local` (`profile_runtime.go:27-36`, `:62-116`). One learner with scope `learner` (`local.go:58-70`). [code]

**Hobby.** One HTTP process with SQLite, an in-process scheduler and in-memory rate limits (`profile_commands.go:105-112`). A file lock permits one server (`profile_commands.go:139-154`). Accounts use a name and a password through OAuth (`main.go:471-484`, `docs/profiles.md:46-87`). It needs a persistent disk, thus it is not stateless. [code]

**Institution.** `--profile institution` forces `DEPLOYMENT_PROFILE=production`, `TUTOR_NATIVE_IDENTITY=on`, `OAUTH_GRANULAR_SCOPES=on`, `DB_DRIVER=postgres` and DCR disabled (`profile_commands.go:19-39`). [code]

- Processes: migrator (exits after DDL, `main.go:241-244`), API (stateless), worker (cron jobs, no HTTP listener, `main.go:310-313`, `:650-667`, `engine/scheduler.go:889-962`). Compose adds Caddy (`deploy/compose.institution.yml:14-56`). [code]
- Configuration: `deploy/institution.env.example:1-21`. Boot checks are in `startup_config.go:256-307`: HTTPS `BASE_URL`, `sslmode=verify-full` with `sslrootcert` (`:349-365`), `RATELIMIT_BACKEND=postgres`, Ed25519 JWT keys, secret keyring, `TRUSTED_PROXY_CIDRS`. [code]
- Database roles (`deploy/postgres-roles.sql`): three NOLOGIN groups `tutor_api`, `tutor_worker`, `tutor_restore` (`:9-20`). `tutor_api` gets full DML on all tables (`:27-28`). `tutor_worker` gets column-level grants and the DELETE grants for erasure (`:33-128`). `tutor_restore` gets SELECT and INSERT (`:136-137`). A separate owner login runs migrations. One superuser grant is necessary only for tenant restore (`deploy/postgres-roles-superuser.sql:13`). The API refuses a role that is superuser, BYPASSRLS, table owner, or has CREATE (`db/runtime_roles.go:14-33`, `main.go:182-187`). [code]
- Extensions: none. No `CREATE EXTENSION` exists in the repository. The schema uses plpgsql triggers and advisory locks (`db/postgres.go:1729-1733`). CI uses PostgreSQL 17 (`.github/workflows/ci.yml:114-120`). [code]
- Resources: no CPU or RAM numbers are in the docs that I read. Defaults: 10 connections for each instance, 128 concurrent MCP calls, 8 for each learner, 1 MiB body, 30 s tool timeout (`startup_config.go:23-28`, `:163-167`, `main.go:168`). The image is a static binary on `scratch` (`Dockerfile:11`, `:20`). [code]

**Cloud Run.** The API fits a Cloud Run service. [inf] The MCP handler is stateless (`mcp_http.go:39-40`). Set `LISTEN_ADDR=0.0.0.0:$PORT` because the default is loopback (`profile_commands.go:132-137`). Health routes are `/live`, `/ready`, `/health` (`main.go:402-405`). Conditions:

- The worker has no HTTP port. Use a Cloud Run worker pool, not a service. [inf, Cloud Run docs]
- The migrator fits a Cloud Run job. A person or CI must then apply `postgres-roles.sql` after each migration (`deploy/postgres-roles.sql:3`). [docs]
- The API starts a repair loop each 30 s and rotates secrets at start (`main.go:259-274`, `:306-309`). Use instance-based billing. [inf]
- The `Host` header must be equal to the `BASE_URL` host (`auth/native.go:428`). [code]

**Supabase.** A separate schema is possible with a small edit. [inf] The DDL has no schema names, and the runtime uses `current_schema()` (`db/runtime_roles.go:20-23`). `postgres-roles.sql` contains `public` in 12 lines (`:22-28`, `:128`, `:136-148`). Set `search_path` on the logins and edit that script. Do not use `public`: the Data API and `service_role` reach it. Use the direct connection or the session pooler: the migrator holds a session advisory lock, and pgx uses prepared statements. [inf, Supabase docs] Skip the superuser script, because Supabase gives no superuser. A second Supabase project gives a separate database and separate credentials. That is the better separation. [inf]

## 2. Identity and auth

- Token: JWT, EdDSA or HS256, 30 minutes (`auth/jwt.go:42`). Claims: `sub` = user id, `tid`, `membership_id`, `learner_id`, `roles`, `scope`, `azp`, `token_version` (`auth/jwt.go:127-136`, `:178-194`). `aud` = `<BASE_URL>/mcp` (`:123-125`). Each request checks the membership row again (`db/identity.go:120-183`). [code]
- OAuth (legacy and hobby modes only): authorization code with PKCE S256, refresh rotation, DCR at `POST /register`, CIMD (`auth/oauth.go:286-316`, `main.go:472-478`, `:731`). [code]
- Scopes: `learner`, `learner:read`, `learner:write`, `formation:contribute`, `formation:read`, `formation:write`, `progress:read` (`models/oauth.go:16-23`). Each tool has a scope policy (`tools/tools.go:189-226`). [code]
- Institution identity: each member has a secp256k1 key pair. The client signs a Nostr NIP-98 event, kind 27235 (`auth/native_nostr.go:22`). Flow: challenge (120 s), then session (30 minutes, no refresh) (`auth/native.go:29`, `:250-377`). OAuth routes are not mounted (`main.go:469-479`). The bearer must come from a native session (`auth/native.go:542-576`). [code]
- Tenants: one token selects one tenant membership (`models/principal.go:66-76`). The operator creates tenants and members with `tutor-control-plane` (`cmd/tutor-control-plane/main.go:31`, `:76-89`). One institution API process serves one tenant (`auth/native.go:255`, `:425`). [code]
- Cohorts: a cohort binds learners to one published formation version, with capacity and trainers (`models/catalog.go:53-84`). Statistics need 5 learners (`docs/institution-phase-6.md:12-18`). [code, docs]

**Trusted back end for many users: no supported path.** [code]

- `client_credentials` exists (`auth/oauth.go:921-966`). A service account has no learner id (`db/service_accounts.go:137`), cannot hold the learner role (`:34-37`), and has no permissions (`models/rbac.go:83`). Only tests call `CreateServiceAccount`. The institution profile rejects such tokens.
- Each learner tool takes the learner from the token (`tools/tools.go:525-531`) and requires `learning:self` (`tools/tools.go:913-927`). No tool or route accepts a learner id parameter (`clientapi/README.md:14-17`).
- No token exchange and no impersonation exist. [code, by search]
- Workaround: the back end keeps one key pair for each learner and signs a challenge each 30 minutes. A hard limit of 30 ceremonies each minute for each IP applies (`main.go:424`). The discovery document states `agent_delegation: false` (`auth/native.go:180`). [inf]

**clientapi routes** [code]

- `GET /api/client/v1/overview` (`clientapi/overview.go:27`)
- `POST /api/client/v1/institution/actions` (`clientapi/institution.go:19`). Actions: `overview`, `list_members`, `get_erasure_status`, `invite_member`, `set_member_roles`, `remove_member`, `transfer_ownership`, `request_erasure` (`models/institution_actions.go:45-56`)
- `POST /api/client/v1/training/{action}`, 22 actions (`clientapi/training.go:17`, `tools/training.go:15-38`)
- `POST /api/client/v1/me/learning` (`clientapi/learning.go:16`)
- `POST /api/client/v1/identity/{challenge,session,rotate,recover,logout}` and `GET /.well-known/tutor-institution` (`native_profile.go:18-26`)

**adminapi routes** (33) [code]

- Catalog (`adminapi/catalog.go:66-75`): `GET|POST /admin/catalog/formations`, `POST .../formation-versions/{id}/modules`, `.../concepts`, `.../publish`, `GET|POST /admin/catalog/cohorts`, `GET|POST .../cohorts/{id}/enrollments`, `GET .../cohorts/{id}/report`
- Versions (`adminapi/catalog_versions.go:29-143`): `GET .../formation-versions/{id}`, `POST .../clone`, `PUT .../content`, `DELETE .../formations/{id}`, `PUT .../formations/{id}/enrollment-policy`, `PUT .../formations/{id}/trainers/{membershipID}`, `PUT /admin/catalog/learning-policy`, `POST /admin/catalog/enrollments/{id}/migrate`
- Publication and admissions (`adminapi/catalog_publication.go:23-51`, `adminapi/formation_admissions.go:13-34`): `GET .../formations/{id}/versions`, `GET .../formation-versions/{id}/review`, `POST .../publish-to-catalog`, `GET|POST .../cohorts/{id}/admissions`
- Assessment review, 7 routes (`adminapi/assessment_review.go:56-63`)
- Curriculum review, 3 routes (`adminapi/curriculum_review.go:35-37`)
- In the institution profile only `/admin/catalog/` is open, with `formation:*` or `progress:read` scopes (`native_profile.go:32-55`). [code]

## 3. Isolation

- RLS: 90 of 121 tables have ENABLE and FORCE row-level security (my count from the DDL). The policy is `tenant_id = current_setting('app.current_tenant', true)` (`db/postgres.go:930-975`). A trigger and a composite foreign key bind each row to the tenant of the learner (`:943-954`). [code]
- Each tool call runs in one transaction that sets `app.current_tenant` locally (`db/store.go:397-407`, `tools/tools.go:901-976`). [code]
- Role split: see section 1.
- One-tenant backup: `cmd/tutor-tenant-archive -mode export|restore` writes a JSON archive, and a script encrypts it (`deploy/tenant-logical-backup.sh:33-36`, `db/tenant_archive.go:30-40`). Restore uses `tutor_restore` in an empty database (`deploy/tenant-logical-restore-exercise.sh:35-41`). [code]
- Erasure: `mcp_erasure_test.go:15-92` proves one thing. After the first erasure step, the session and a fresh token of the learner get HTTP 401, and a second learner still writes. [code]
- Erasure phases (`db/saas_governance.go:502-514`): revoke access first, then delete credentials, estimates, badges, webhook rows, narrative objects, snapshots, transfer records, interactions, learning events, reviews, attempts, decisions, affect, intentions, sessions, both concept-state tables, calibration, idempotency rows, alerts and availability. The last phase scrubs the learner row and the domains (`:639-686`). The worker runs the job. A legal hold blocks it (`:593-607`). [code]
- Kept after erasure (`db/erasure_coverage_test.go:17-52`): scrubbed learner, membership, domain and enrollment rows, the request, the audit rows, `curriculum_versions` (immutable by trigger), `users`, `native_identities` with the display name and public keys. [code]
- Audit: `audit_events` is append-only (`db/migrations_checksum.go:1436-1439`). It records membership, catalog, enrollment, service-account and DSAR actions. It does not record learner tool calls. [code]

Weak points:

1. RLS separates tenants only. No policy uses a learner id. Application `WHERE learner_id = ?` filters separate learners. [code]
2. `tutor_api` can set any tenant and has DML on all tables, with 31 global tables outside RLS. RLS protects against a missing filter, not against a compromised API. [inf]
3. Curriculum text that a learner typed stays after erasure (`docs/institution-phase-8.md:34-35`). [docs]
4. Only narrative memory is encrypted in the database. Answers, task text and notes are plain text. [code]
5. Erasure stops if the worker does not run. [inf]

## 4. API for a back end

Tool count: 90 names in code. 49 core, 22 training, 19 institution-only. `docs/mcp-tools.md:5` says 46. Groups: learning loop, domain and curriculum, assessment attempts, metacognition, audit and replay, transfer, memory and session, availability, training library, formation authoring, cohort progress, badges. [code]

**a. Import a graph.**

- Personal domain: `init_domain` with `name`, `concepts[]`, `prerequisites{concept: [prerequisites]}`, `details{concept: {label, description, level, outcomes, criteria}}` (`tools/domain.go:239-248`). Output: `domain_id`, `curriculum_version`, `concept_count`, `graph_quality_report` (`:409-418`). `add_concepts` needs `expected_version` (`:448-457`). [code]
- Shared catalog (institution): `PUT /admin/catalog/formation-versions/{id}/content` with `modules[]` and `concepts[]`. Each concept has `stable_key`, `label`, `prerequisites[]`, `module_stable_key`, `position`, `metadata_json` (`models/catalog.go:33-51`). [code]
- Key: the caller sets it. In a personal domain the key is the string in `concepts[]`. In a formation it is `stable_key`. Both accept 200 characters, thus a topic id fits. The concept state uses this key. [code]
- Id: the server sets it. Personal: random `concept_<128 bits>` (`models/curriculum.go:152-177`). Formation: a hash of domain and key (`db/formation_learning.go:29`). [code]
- Limits: 500 concepts for each domain or formation version, 20 prerequisites for each node (`tools/domain.go:31-32`, `db/formation_versions.go:244`). The graph is copied for each learner (`db/curriculum.go:268-271`). [code]
- Operations of `publish_curriculum_revision` (`tools/curriculum.go:115-127`), all with `expected_version` compare-and-swap:
  - `baseline_import`: automatic first snapshot of an old domain (`db/curriculum.go:22-59`).
  - `add`: new concepts with fresh states (`tools/domain.go:584-588`).
  - `rename`: label only, one concept, state kept (`tools/curriculum.go:306-320`).
  - `update_metadata`: changes description, level, outcomes or criteria. The state resets.
  - `split`: one source, two or more targets. The source retires with `replaced_by`. Targets inherit the edges (`:335-347`, `:580-600`).
  - `merge`: two or more sources, one target (`:348-359`).
  - `remove`: only when no active concept depends on it (`:360-372`).
  - `repair_prerequisites`: full replacement of the prerequisites of the named concepts (`:274-305`).

**b. Record a graded answer.** `record_interaction` (`tools/interaction.go:23-50`). Input: `concept`, `activity_type` (9 values), `success`, `response_time_seconds`, `confidence`, `hints_requested`, `error_type`, `misconception_type`, `misconception_detail`, `rubric_json`, `rubric_score_json`, `domain_id`, `session_id`, `attempt_id`, `evaluator_id`, `evaluation_method`, `idempotency_key`. Output: `new_mastery_estimate`, `next_review_in_hours`, `evidence_verification`, `session_id`, signals (`:385-395`). No question-format field exists. `activity_type` is the nearest. For trusted evidence use `prepare_assessment_attempt`, `submit_assessment_attempt`, then `record_interaction` with `attempt_id` (`tools/assessment.go:25-39`, `:78-83`). The score then comes from the frozen rubric (`tools/interaction.go:257-278`). Hashes can replace the task and answer text. [code]

**c. Self-assessment.** `calibration_check` with `concept`, `predicted_mastery` 1 to 5, returns `prediction_id`. `record_calibration_result` takes `prediction_id` and `actual_score` (`tools/calibration.go:18-24`, `:113-117`). Confirmed: these tools write only `calibration_records` (`:94`, `:156`). The only writer of `p_mastery` from an answer is `tools/interaction_apply.go:402-418`. One side effect: a prediction of 0.9 or more makes a later full-marks attempt an FSRS "Easy" rating (`tools/interaction_apply.go:478-480`). [code]

**d. Read many concepts.** `get_dashboard_state` with optional `domain_id` returns all active domains (`tools/get_dashboard_state.go:20-53`, `:348-364`):
`{domains: [{domain_id, name, total_concepts, concepts: [{concept, mastery, retention, status, mastery_status, routing_status, card_state}], retention_alerts}], total_concepts, alerts, calibration_bias, ...}`.
`get_olm_snapshot` covers one domain (`engine/olm.go:122-164`): `{domain_id, domain_name, estimated, retained, demonstrated, transferred, in_progress, fragile, not_started, mastery_stages: {<concept key>: {stage, estimated, retained, demonstrated, transferred, mastery_estimate, retention_estimate, retention_evidence, evidence_quality, confidence, transfer_readiness}}, focus_concept, focus_reason, evidence_progress, next_step_concept}` (`engine/mastery_status.go:47-59`). `GET /api/client/v1/overview` gives `conceptStates[{domainId, concept, stability, cardState, lastReview, pMastery}]` (`clientapi/overview.go:85-92`). [code]

**e. Next activity.** `get_next_activity` with `domain_id`, `intent` (`auto` or `review`) (`tools/activity.go:23-28`). Output: `activity{type, concept, difficulty_target, format, estimated_minutes, rationale, prompt_for_llm}`, `pedagogical_contract`, `decision_id`, `mastery_uncertainty`, `active_misconceptions` (`:552-573`, `models/domain.go:89-97`). It also opens a session. [code]

**f. Undo.** None. No tool retracts an interaction. [code, by search] `cancel_assessment_attempt` works only before evaluation (`tools/assessment.go:314-339`). `update_metadata` resets one full concept.

**g. Export and delete.** No learner export exists. The DSAR `export` kind writes row counts only and no route calls it (`db/saas_governance.go:357-371`). Delete: `POST /api/client/v1/institution/actions` with `request_erasure`, only for the caller, only in the institution profile (`db/institution_actions.go:373-394`). [code]

## 5. Data about a person

- `learners`: email, password hash, objective, `profile_json`, `webhook_url` (`db/schema_pg.sql:10-19`). `users`, `native_identities` (display name, public keys).
- `domains`: name, personal goal, graph (`:37-54`). `concept_states`: FSRS and BKT values for each learner, domain and concept (`:56-77`). `learner_concept_states` for each enrollment (`db/enrollment_learning_state.go:129-147`).
- `interactions`: success, time, confidence, error type, notes, hints, misconception, rubric scores (`db/schema_pg.sql:79-101`).
- `assessment_attempts`: `task_text`, `response_text` or hashes, rubric, score (`db/postgres.go:197`). `learning_events`, `learning_sessions`, `pedagogical_snapshots`, `pedagogical_decisions`.
- `affect_states` (energy, confidence, satisfaction), `calibration_records`, `transfer_records`, `implementation_intentions`, `availability` (time zone, windows), webhook logs (`db/schema_pg.sql:103-240`). [code]

`memory/` is narrative memory. The host LLM writes Markdown through `update_learner_memory`. Scopes: `memory`, `memory_pending`, `session`, `concept`, `archive` (`memory/store.go:21-29`). Session memory is a session summary. Its template asks for 2 or 3 verbatim exchanges (`memory/prompts.go:27-28`). Full chat text is not stored. Storage: table `narrative_objects` with AES-GCM ciphertext (`db/narrative_store.go:29`, `:271`), or Markdown files in the old local mode. No embeddings exist. The session index is a B-tree on a domain digest and a sort key (`db/session_narrative_index.go:19-34`). `TUTOR_MCP_MEMORY_ENABLED=off` disables it (`docs/configuration.md:65`). [code, docs]

Outbound calls: SMTP when configured (`auth/email.go:162-185`), fetch of OAuth client metadata (`auth/cimd.go:340-346`), OTLP only when an endpoint is set (`observability/observability.go:66-71`), webhooks to Discord or an allowed host (`engine/scheduler.go:153-165`, `engine/saas_worker.go:168-179`). No LLM call, no telemetry and no update check exist in the server. [code] I did not read `client/`.

## 6. Seam to an outside graph

- `reconcileCurriculumLearning` compares each concept by id (`db/curriculum_reconciliation.go:57-108`). The key cannot change (`:74-76`). [code]
- An equal definition keeps the state. The definition is description, level, outcomes and criteria. The label is not part of it (`models/curriculum_semantics.go:10-33`). [code]
- A changed or retired definition resets the concept state (`:91`). It marks rows in `interactions`, `assessment_attempts`, `transfer_records` and `learning_events` with `curriculum_invalidated_version` (`:95-104`). A trigger makes that mark permanent (`db/curriculum_reconciliation_schema.go:64-69`). [code]
- `replaced_by` is lineage data only. No code moves evidence to a successor. New concepts start at the default (`tools/curriculum.go:181-185`, `:567-578`). [code]
- New evidence for a retired key fails (`db/curriculum_reconciliation.go:54`). [code]
- Formation path: publish a new version, then call `POST /admin/catalog/enrollments/{id}/migrate` for each enrollment. Matching is by `stable_key` (`db/formation_migration.go:99-121`). Output lists `invalidated_concept_keys` (`:180`). [code]

A regular sync is practical only with stable keys and an unchanged definition text. [inf] Cost: one curriculum write for each learner, or one migration for each enrollment. If the outside graph changes a topic id, the old concept retires and its history stops counting. The new id starts at 0.1. A changed description has the same effect. Thus send only the id and the label, and keep descriptions empty.

## 7. Gaps

| Gap                                | Finding                                                                                                                                                                                  | Fix                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Self-mark "known" as a start value | No input sets `p_mastery`. New states start at 0.1 (`db/schema_pg.sql:69`, `tools/domain.go:239-248`). A diagnostic success is evidence, not a prior. [code]                             | Small fork                                                     |
| "Read a passage" evidence          | `record_learning_event` with `kind: instruction` records an exposure with no model change (`tools/learning_event.go:14-39`). No passage field. Put the passage id in `event_key`. [code] | Configuration. Small fork for a real field or a mastery effect |
| Undo                               | Absent. Records are append-only, and the mastery update is not replayed. [code]                                                                                                          | Redesign                                                       |
| State belongs to one domain        | Unique key `(learner_id, domain_id, concept)` (`db/postgres.go:49`). One topic in two domains has two states. One domain for all topics hits the 500 limit. [code]                       | Redesign                                                       |

## 8. Options

Effort and risk are estimates. [inf]

**(a) Run unchanged behind the back end: 11 to 17 days, high risk.** Three processes, key custody for each learner, catalog sync, evidence mapping. Blockers: no machine identity for learner writes, the 30-each-minute limit, 500 concepts, no undo, no start value, tenant-only RLS, alpha code.

**(b) Fork and trim: 15 to 25 days, medium to high risk.**

- Keep: `algorithms` (1,006 lines), `assessment` (637), `models` (4,030), `engine` (10,896), `store` (995), the core `db` files (about 9,200 of 36,361), about 12 tool handlers (about 5,900 of 14,708).
- Remove: `auth` (8,769), `adminapi` (1,103), `clientapi` (540), `memory` (2,753), `certification` (134), `cmd` (1,585), and the `db` parts for identity (6,236), SaaS (5,483), formations (5,944), webhooks (1,844), narrative (1,788), retention (1,100).
- Problem: `engine` and `db` import `memory`, `tools` imports `auth`, and one `Store` type holds all tables. The fork loses upstream updates.

**(c) Port to TypeScript and Postgres: 8 to 15 days for the core, plus 3 to 5 for activity selection. Low to medium risk.** Port BKT, FSRS-5, the frontier and the thresholds from `algorithms` (1,006 lines, 1,864 test lines to reuse). Port the mastery ladder (`engine/mastery_status.go:68-127`), the update rule (`tools/interaction_apply.go:140-420`) and the reconciliation rule (108 lines). MIT permits this.

Recommendation: (c). The private store needs one state for each learner and topic id, learner-level RLS, undo and a start value. Tutor MCP needs a redesign for each of these. Put the store in a second Supabase project. Take these ideas: the evidence ladder, observation versus learning opportunity, the hint rule, idempotency keys, versioned graph with "invalidate, do not transfer", and erasure that revokes access first.

## 9. knowledge-graph-mcp

One file for each learner does not work with this code as it is. [code]

- The database path is one process-wide variable from `KNOWLEDGE_GRAPH_DB_PATH` (`knowledge_graph_mcp/database/connection.py:13-24`, `server.py:486-488`).
- No authentication exists. HTTP mode permits all origins (`server.py:501-511`).
- The graph and the mastery are in the same `nodes` row (`database/schema.py:3-31`). Each file thus holds a full copy of the graph.

It needs: a path for each request from an authenticated learner id, a safe id check, table creation for each new file, a durable disk, and a graph copy job for each file. Cloud Run has no durable local disk. The pattern gives simple export and erasure (one file). It is a poor fit for the Supabase and Cloud Run stack. [inf]

## Read and not read

Read: `auth/` (middleware, jwt, scopes, native, the token and metadata parts of oauth, ratelimit), `clientapi/` (all), `adminapi/catalog.go` and `catalog_versions.go` (all), route lists of the other adminapi files, `mcp_http.go`, `institution_config.go`, `main.go:48-760`, `startup_config.go:1-390`, profile files, `deploy/` (roles, compose, env, units, tenant scripts), `db/` (schema, RLS, store transaction, identity, service accounts, curriculum, reconciliation, formation learning and migration, governance and erasure, institution actions, parts of narrative and archive), `memory/` (types, prompts, loader header), the tool files for section 4, `OPERATIONS.md` (lines 1-100, 220-330, 494-514), `SECURITY.md`, the listed docs, and all of knowledge-graph-mcp except the query and Mermaid services.

Not read: most of `auth/oauth.go`, console and account pages, CIMD internals, `db/training.go`, webhook queue, billing, retention jobs, `engine/` beyond `olm.go` and `mastery_status.go`, `client/`, `ui/`, most tests, `docs/backlog-multitenant-saas.md` beyond the sections for IAM, RLS, runtime and operations. I ran nothing from the two repositories. Nothing here is tested on Cloud Run or Supabase.

`institution_config.go` reads `INSTITUTION_SIGNUP`, but the branch at `main.go:336` cannot run with `--profile institution`, because that profile forces native identity. [inf from code]
