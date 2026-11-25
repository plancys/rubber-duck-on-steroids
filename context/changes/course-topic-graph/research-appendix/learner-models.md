# Appendix: Tutor MCP, knowledge-graph-mcp, pyBKT, py-fsrs and adaptive-explainer

This file is an appendix to `../research.md`. It is the report of one read-only research worker from 2026-11-25. The worker read the code and ran nothing. Scores and effort numbers are the judgment of that worker.

Tags: [C] = read in code. [D] = read in docs or on the web. [I] = inference.
Anchors are relative to each project folder.

## Recommended actions

1. Build N1, N2 and N3 in our own code. None of the five projects extracts topics from text or links a topic to a passage [C].
2. Port the learner-model ideas of tutor-mcp into the Node worker and Postgres. Do not run tutor-mcp as a service.
3. Port the BKT observation update to TypeScript with fixed parameters. Do not fit parameters now.
4. Port only the FSRS forgetting curve for decay. Add `ts-fsrs` later if the product gets spaced reviews.
5. Write our own adaptive prompts. Do not copy code from adaptive-explainer, because that repository has no license.

## 1. tutor-mcp

**(1) What it is and the data model.** tutor-mcp is a Go MCP server that gives an LLM assistant a persistent learner state [C][D]. The server calls no LLM provider [C]. A domain holds a list of concept labels and a map of prerequisites (`models/domain.go:162-165`) [C]. The prerequisite is the only relation type [C]. Concepts have no link to lessons or passages [C].

One row for each learner, domain and concept holds these fields: `stability, difficulty, elapsed_days, scheduled_days, reps, lapses, card_state, last_review, next_review, p_mastery, p_learn, p_forget, p_slip, p_guess, theta, updated_at` (`models/learner.go:30-54`) [C]. A new row starts at `p_mastery 0.1` with the constants `learn 0.15, forget 0.05, slip 0.10, guess 0.20` (`models/learner.go:64-80`, `models/collective_weights.go:50-52`) [C]. A versioned curriculum snapshot gives each concept a stable ID, an immutable key, a label, outcomes and criteria (`models/curriculum.go:58-69`) [C]. Snapshot operations are `add, rename, update_metadata, split, merge, remove` (`models/curriculum.go:102-113`) [C].

**(2) Algorithms.**

- BKT observation: `P(L|correct) = P(L)(1-S) / (P(L)(1-S) + (1-P(L))G)`, with the mirror formula for a wrong answer (`algorithms/bkt.go:38-65`) [C].
- BKT transition: `P(L) = P(L)(1-F) + (1-P(L))T` (`algorithms/bkt.go:70-74`) [C]. The server applies it only to learning activities (`engine/bkt_policy.go:12-22`) [C]. A diagnostic, a mastery challenge and a transfer probe update by observation only [C].
- A success with hints does not raise the estimate (`tools/bkt_parameter_policy.go:21`) [C].
- FSRS-5 with 19 default weights (`algorithms/fsrs.go:37-57`) [C]. Retrievability: `R = (1 + (19/81) t/S)^-0.5` (`algorithms/fsrs.go:84-95`) [C]. Card states: `new, learning, review, relearning` (`fsrs.go:23-28`) [C].
- The server maps facts to FSRS ratings (`tools/interaction_apply.go:467-483`) [C]. Failure gives Again. Hints or a narrow pass give Hard. Full marks with a calibration of 0.9 or more give Easy. All other passes give Good.

A same-day success leaves the memory state unchanged (`tools/interaction_apply.go:373-383`) [C]. The code keeps IRT but marks it deprecated, because generated tasks have no calibrated item parameters (`algorithms/irt.go:9-13`) [C]. The project does not use SM-2 [C].

**Self-report against tested evidence.** The learner gives a self-assessment on a scale of 1 to 5 before an exercise (`tools/calibration.go:22-79`) [C]. The self-assessment never changes the BKT estimate [C]. The server stores `delta = predicted - actual` and reports a calibration bias (`tools/calibration.go:154-161`) [C]. An estimate without verified success counts at most 0.84 for a prerequisite (`engine/gate.go:85-104`) [C]. Verified means a passed evaluated attempt, or a success one day or more after the last review (`engine/gate.go:91-113`) [C].

**Decay.** The BKT estimate does not decay with time. The forget probability applies to each transition, not to elapsed time (`algorithms/bkt.go:67-69`) [C]. Time decay comes from FSRS retrievability only [C]. Recall routing starts below a retention of 0.50, and alerts start at 0.40 and 0.30 (`algorithms/thresholds.go:27-44`) [C].

**Mastery thresholds and tiers.** The routing threshold is 0.85, and the maintenance exit threshold is 0.70 (`algorithms/thresholds.go:52-57`, `engine/phase_config.go:70`) [C]. The status holds four separate claims: estimated, retained, demonstrated and transferred (`engine/mastery_status.go:47-59`) [C]. Estimated needs `p_mastery >= 0.85` [C]. Retained needs a retention of 0.50 and an assessment-linked recall after 24 hours (`engine/mastery_status.go:16, 110-111`) [C]. Demonstrated needs a pass on the latest trusted mastery challenge or transfer probe (`engine/mastery_status.go:288-305`) [C]. A later trusted failure revokes that claim [C].

**Uncertainty.** A rule score adds penalties for few observations, stale evidence, a high error rate, an estimate near the threshold and low diversity (`engine/uncertainty.go:78-104`) [C]. The defaults are 3 observations, 21 days and a margin of 0.05 (`engine/uncertainty.go:114-124`) [C]. A score from 0.60 means low confidence (`engine/uncertainty.go:260-269`) [C].

**Misconceptions.** Each interaction can carry `misconception_type` and `misconception_detail` (`models/learner.go:98-99`) [C]. The store groups them for each concept with count, first seen, last seen and status (`models/store_types.go:13-21`) [C]. The store derives active or resolved from the recent interactions (`db/misconceptions.go:19-24`) [C]. An active misconception forces a `DEBUG_MISCONCEPTION` activity before any recall (`engine/action_selector.go:162-173`) [C].

**Next activity.** `get_next_activity` runs phase controller, gate, concept selector and action selector (`engine/orchestrator.go:478-609`) [C]. The phase is diagnostic, instruction or maintenance (`engine/phase_fsm.go:97-178`) [C]. Diagnostic picks the concept with the highest expected information gain (`algorithms/bkt_info_gain.go:44-77`, `engine/concept_selector.go:485-560`) [C]. Instruction scores `relEff x (1 - mastery) x (1 + 1.5 x started)` over the open frontier (`engine/concept_selector.go:247-324`) [C]. Maintenance scores `(1 - retention) x relevance` (`engine/concept_selector.go:437-444`) [C].

The action follows mastery brackets (`engine/action_selector.go:195-242`) [C]. Below 0.30 the action is a new concept. Below 0.85 the action is practice. Above 0.85, after 3 stable interactions, the action rotates: mastery challenge, Feynman prompt, transfer probe. A due recall goes first, with at most one recall for two instruction activities (`engine/orchestrator.go:615, 669-703`) [C].

**Certification.** The `certification` package verifies Ed25519 signatures from configured external authorities (`certification/assessment.go:98-125`) [C]. A claim binds tenant, attempt, review, material hash, score hash and verdict (`certification/assessment.go:33-45`) [C]. A claim lives at most 900 seconds (`certification/assessment.go:120`) [C]. The package certifies an assessment review. It does not issue a learner certificate [I].

**Deterministic code against the LLM host.** Deterministic code owns model updates, phase, gate, selection, thresholds, mastery status and score checks [C]. The LLM host builds the concept graph, sets goal relevance, writes tasks and rubrics, grades answers and names misconceptions [C][D]. The server limits trust in host grading with the 0.84 cap and the demonstrated tier [C].

**(3) Runtime.** The project is one static Go 1.26 binary in a `FROM scratch` image (`go.mod:3`, `Dockerfile:20`) [C]. Storage is SQLite or PostgreSQL through `pgx` (`go.mod:6-22`) [C]. Three profiles exist: local stdio, hobby HTTP with SQLite, and institution with PostgreSQL and separate API, worker and migrator roles [D]. The module name is `tutor-mcp`, so other Go code cannot import it by path (`go.mod:1`) [C][I].

The repository also holds a desktop client in Rust and TypeScript (`client/`) [C]. I did not inspect it. I found no JavaScript port of the engine, and I did not search the web for one.

**(4) License.** MIT, copyright 2026 Arnaud Guiovanna (`LICENSE`) [C]. A fork inside a closed hosted product is legal. Keep the copyright notice and the license text with any copied code [I].

**(5) Maturity.** The repository holds about 87,000 lines of Go source and 83,000 lines of tests in 363 test files [C]. It holds 530 commits from 2026-04-05 to 2026-11-12, with tags up to v0.7.5 and one main author [C]. GitHub shows 112 stars [D]. `algorithms/` is 1,006 lines of pure functions with one import of `models` [C]. That folder is easy to extract. `engine/` is hard to extract, because it imports `models`, `store` and `db` in more than 100 places [C].

**(6) Fit.**

| Need | Score | Reason                                                                                       |
| ---- | ----- | -------------------------------------------------------------------------------------------- |
| N1   | 1     | A prerequisite graph of labels. No passages and no other relation types.                     |
| N2   | 2     | Stable concept IDs and versioned snapshots. No rebuild from changed text.                    |
| N3   | 0     | The code scopes concept state to one domain on purpose (`models/learner.go:60-64`).          |
| N4   | 2     | Evidence tiers, deterministic updates and audit snapshots. No self-mark and no undo.         |
| N5   | 1     | It selects an activity. It does not reorder lessons or collapse passages.                    |
| N6   | 1     | A JSON learner-model snapshot (`engine/olm.go:122-163`). A search found no graph library.    |
| N7   | 2     | Tenants, row-level security, cohorts and enrollments [C][D]. No ingestion from many sources. |

**(7) Integration.**

- (a) Service: 10 to 15 days, high risk. It needs its own database, its own identity model, an MCP client and about 60 tools [C][I].
- (b) Library: not possible from Node [I].
- (c) Fork: more than 20 days, high risk [I].
- (d) Port ideas: 5 to 7 days, low risk [I]. BKT, information gain and frontier take 1 day. Tiers, cap and uncertainty take 2 days. The snapshot schema takes 2 to 3 days.

I recommend (d).

**(8) Best idea and trap.** The best idea is to separate the estimate from the proof. A model estimate is not a demonstration, and unverified success has a cap [C]. The second idea is the identity model: stable ID, immutable key, retired concepts with `replaced_by`, and invalid evidence after a definition change (`db/curriculum_reconciliation.go:57-108`) [C]. The trap is the set of hand-tuned constants, as the code states (`algorithms/individual_bkt.go:14-19`) [C]. The design assumes a tutoring conversation, not a course reader [I].

## 2. knowledge-graph-mcp

**(1) What it is and the data model.** It is a small Python MCP server with one SQLite file and seven tools (`knowledge_graph_mcp/server.py:32-452`) [C]. A node row holds the concept and the learner state together: `id, concept, description, domain, mastery_level, mastery_recall, mastery_application, mastery_explanation, difficulty, ease_factor, interval_days, repetitions, last_reviewed_at, next_review_at, review_count, tags, misconceptions` (`knowledge_graph_mcp/database/schema.py:4-30`) [C]. No learner ID exists, so one database serves one learner [C]. An edge row holds `source_id, target_id, relation_type, strength, reasoning` (`database/schema.py:34-44`) [C]. Relation types are `prerequisite, builds_on, related_to, contradicts, applies_to, parent_of` (`models/enums.py:9-14`) [C]. Nodes have no link to content [C].

**(2) Algorithms.** SM-2: `EF = EF + 0.1 - (5-q)(0.08 + (5-q) 0.02)` with a floor of 1.3 (`services/spaced_repetition.py:50-53`) [C]. Intervals are 1 day, 6 days, then `interval x EF`, and a quality below 3 resets them (`spaced_repetition.py:55-67`) [C]. Difficulty shortens the interval by up to 30 percent (`spaced_repetition.py:70-71`) [C]. A fixed table maps quality and repetitions to a mastery value (`spaced_repetition.py:100-112`) [C]. Overall mastery is `0.3 recall + 0.4 application + 0.3 explanation` (`spaced_repetition.py:134-136`) [C].

The host LLM can also write `mastery_level` directly (`services/graph_service.py:142-144`) [C]. Self-report and tested evidence have the same weight, because the server has no evidence model [C][I]. Mastery does not decay. Only `next_review_at` shows that a review is due [C]. A misconception is a string in a JSON list on the node, with no resolved state (`graph_service.py:187-192`) [C].

**Selection.** `next_recommended` lists due reviews first, then gaps that block other concepts, then ready concepts (`services/query_engine.py:449-479`) [C]. Ready means mastery below 0.8 with all prerequisites at 0.8 or more (`query_engine.py:256-279`) [C]. The server rejects a prerequisite edge that closes a cycle (`graph_service.py:246-251`) [C].

**(3) Runtime.** Python 3.10 or later with `fastmcp` and `pydantic` (`pyproject.toml`) [C]. Transport is stdio, or HTTP through `uvicorn` when `PORT` exists (`server.py:494-511`) [C]. I found no authentication code [C]. The server calls no LLM [C]. I found no JavaScript port in the repository and did not search the web for one.

**(4) License.** MIT, copyright 2024 zcsabbagh (`LICENSE`) [C]. A fork in a hosted product is legal with the notice kept [I].

**(5) Maturity.** About 2,200 lines of Python, 8 commits on one day (2025-12-29), no tests, 2 stars [C][D]. The code is simple and has low coupling. Extraction of one part is easy.

**(6) Fit.**

| Need | Score | Reason                                                                                                       |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------ |
| N1   | 1     | Typed edges with strength and reasoning. No passages and no provenance.                                      |
| N2   | 0     | The node ID is a slug of the name (`graph_service.py:441-447`). A rename breaks identity.                    |
| N3   | 1     | Lookup by concept name gives a naive match only (`graph_service.py:449-467`).                                |
| N4   | 1     | A scalar mastery plus SM-2. No uncertainty and no undo.                                                      |
| N5   | 1     | Ready-to-learn and learning-path queries.                                                                    |
| N6   | 2     | Mermaid output with mastery colors and a subgraph by depth (`services/mermaid_generator.py:39-44, 106-112`). |
| N7   | 0     | One learner, one SQLite file, no access control.                                                             |

**(7) Integration.**

- (a) Service: 1 to 2 days to start it, high risk. One database serves one learner, and no authentication exists [C].
- (b) Library: not possible from Node [I].
- (c) Fork: 4 to 6 days to add learners and Postgres. The result has less value than a port [I].
- (d) Port ideas: 1 to 2 days, low risk [I].

I recommend (d).

**(8) Best idea and trap.** The best idea is the edge row with `relation_type`, `strength` and `reasoning`, plus the `contradicts` type for a misconception [C]. The named query set is also useful: ready, gaps, stalled, struggling (`models/enums.py:31-39`) [C]. The trap is the fusion of graph and learner state in one row. A second learner or a second course breaks that model [I].

## 3. pyBKT

**(1) What it is and the data model.** pyBKT is a Python library that fits BKT models to response logs [C][D]. It has no concept graph, no prerequisites and no content links [C]. The input is a table with `user_id, skill_name, correct, order_id` (`source-py/pyBKT/models/Model.py:37-40`) [C]. Each skill gets a parameter set: `prior, learns, guesses, slips, forgets` (`Model.py:46`) [C]. The `Roster` class holds one state for each student and skill: `correct_prediction` and `state_prediction` (`source-py/pyBKT/models/Roster.py:500-528`) [C]. The default mastery threshold is 0.95 (`Roster.py:11`) [C].

**(2) Algorithms.** The fit is expectation maximisation on a two-state hidden Markov model [C]. The E step runs the forward and backward passes over each student sequence (`source-py/pyBKT/fit/EM_fit.py:163-239`) [C]. The M step normalises soft counts into the parameters (`source-py/pyBKT/fit/M_step.py:21-62`) [C]. The fit stops at a log-likelihood change of 0.005 or after 100 iterations (`EM_fit.py:19`) [C]. The model keeps the best of 5 random starts (`Model.py:28, 401-427`) [C].

Prediction: `P(correct) = guess x P(not known) + (1 - slip) x P(known)` (`source-py/pyBKT/fit/predict_onestep.py:36`) [C]. Random starts keep learn and guess below 0.40 and slip below 0.30 (`source-py/pyBKT/generate/random_model_uni.py:26-36`) [C]. Forget stays at 0 unless the caller passes `forgets=True` (`Model.py:34, 408-409`) [C]. Variants are `multilearn, multiprior, multipair, multigs` (`Model.py:23`) [C]. `multigs` gives each item class its own guess and slip [D]. The caller can pin any parameter with `fixed` (`M_step.py:24-58`) [C].

`Roster.update_state` takes the current state as the prior and applies one new response (`Roster.py:577-585`) [C]. The library has no self-report input, no time decay, no misconception record and no question selection [C].

**(3) Runtime.** Python 3.10 or later with `numpy`, `pandas` and `requests` (`setup.py:105-106`) [C]. A C++ extension with OpenMP and a vendored Eigen speeds the fit, and a pure Python path exists (`setup.py:34-72`) [C][D]. It is a library, not a server. It calls no LLM [C]. Three npm registry searches found no JavaScript port of BKT [D].

**(4) License.** MIT, copyright 2021 CAHL Research (`LICENSE`) [C]. The vendored Eigen folder carries MPL2, LGPL and BSD license files (`source-cpp/pyBKT/Eigen/COPYING.*`) [C]. Those matter only if we distribute the compiled extension [I].

**(5) Maturity.** 427 commits from 2017, 57 in the last 12 months, version 1.5.0 [C]. CI tests Python 3.10 to 3.15, and `tests/` holds 11 test files [C]. GitHub shows 294 stars and 47 open issues [D]. The online update is a few lines, so extraction by port is easy [I].

**(6) Fit.**

| Need | Score | Reason                                                                                |
| ---- | ----- | ------------------------------------------------------------------------------------- |
| N1   | 0     | No graph.                                                                             |
| N2   | 0     | No content model.                                                                     |
| N3   | 0     | A skill is a name string.                                                             |
| N4   | 1     | The standard update. No decay, no misconceptions, and a fit that needs many learners. |
| N5   | 0     | No use of state.                                                                      |
| N6   | 0     | No view.                                                                              |
| N7   | 1     | An offline fit becomes possible with many employees for each topic [I].               |

**(7) Integration.**

- (a) Service: not useful online. An offline fit job takes 2 to 3 days later, low risk [I].
- (b) Library: Python only, not possible from Node [I].
- (c) Fork: no reason [I].
- (d) Port ideas: half a day for the observation update, low risk [I].

I recommend (d) now, and the offline job when response logs exist.

**(8) Best idea and trap.** The best idea is fixed parameters with a guess and a slip for each item class [C][D]. A multiple-choice question and a free-text question then carry different weight. The trap is the fit. BKT fits four or five parameters for each skill from many learner sequences [C]. One learner with three answers on a topic cannot identify them [I].

## 4. py-fsrs

**(1) What it is and the data model.** py-fsrs is the Python reference scheduler for FSRS-6, version 6.3.3 [C]. It models the memory of one flashcard [C][D]. A card holds `card_id, state, step, stability, difficulty, due, last_review` (`fsrs/card.py:54-60`) [C]. A review log holds `card_id, rating, review_datetime, review_duration` (`fsrs/review_log.py:47-50`) [C]. It has no concepts, no prerequisites and no content links [C].

**(2) Algorithms.** States are `Learning, Review, Relearning` (`fsrs/state.py:9-11`) [C]. Ratings are `Again 1, Hard 2, Good 3, Easy 4` (`fsrs/rating.py:9-12`) [C]. The 21 default parameters sit in `fsrs/scheduler.py:31-54` [C]. Scheduler defaults: retention 0.9, learning steps of 1 and 10 minutes, a maximum interval of 36,500 days, fuzzing on (`scheduler.py:166-176`) [C].

- Retrievability: `R = (1 + FACTOR t/S)^DECAY`, with `DECAY = -w20` and `FACTOR = 0.9^(1/DECAY) - 1` (`scheduler.py:187-188, 234`) [C].
- First rating: `S0 = w[G-1]` and `D0 = w4 - e^(w5 (G-1)) + 1` (`scheduler.py:662-671`) [C]. The defaults give `S0 = 0.212, 1.2931, 2.3065, 8.2956` days [C].
- Difficulty: `D' = D - w6 (G-3) (10-D)/9`, then `D'' = w7 D0(Easy) + (1-w7) D'` (`scheduler.py:716-730`) [C].
- Recall: `S' = S (1 + e^w8 (11-D) S^-w9 (e^(w10 (1-R)) - 1) x hard x easy)` (`scheduler.py:785-801`) [C].
- Lapse: `S' = w11 D^-w12 ((S+1)^w13 - 1) e^(w14 (1-R))`, with a cap below the old stability (`scheduler.py:766-777`) [C].

Same-day review: `S' = S e^(w17 (G-3+w18)) S^-w19` (`scheduler.py:697-710`) [C]. Interval: `I = (S/FACTOR)(r^(1/DECAY) - 1)` (`scheduler.py:679-681`) [C]. `reschedule_card` rebuilds a card from its review logs (`scheduler.py:519`) [C]. The optimizer trains the parameters with PyTorch, Adam and a binary cross-entropy loss (`fsrs/optimizer.py:42-44, 258-262`) [C]. The optimizer returns the defaults below 512 reviews (`optimizer.py:250-251`) [C]. The library has no self-report weight, no misconceptions and no question selection [C].

**(3) Runtime.** Pure Python 3.10 or later with one dependency, `typing-extensions` (`pyproject.toml`) [C]. The optimizer needs `torch`, `numpy`, `pandas` and `tqdm` [C]. It is a library with no database and no LLM [C].

JavaScript and TypeScript ports [D]:

- `ts-fsrs` 6.0.1, MIT, from the same organisation, last release 2026-11-22, Node 24 or later. It supports FSRS-3 to FSRS-7.
- `@open-spaced-repetition/binding` 0.6.3, MIT. It is the optimizer, Rust compiled to WASI. Its docs say edge runtimes do not work by default.
- `fsrs-browser` 6.6.0, BSD-3-Clause, scheduler and optimizer in WASM.
- `femto-fsrs` 2.0.0, MIT, a minimal FSRS-5.
- `supermemo` 2.0.23, MIT, for SM-2.

**(4) License.** MIT, copyright 2022 Open Spaced Repetition (`LICENSE`) [C]. Use in a hosted product is legal with the notice kept [I].

**(5) Maturity.** 123 commits from 2022, 5 in the last 12 months, last commit 2026-11-13 [C]. Tests hold about 1,580 lines plus a real review log (`tests/`) [C]. GitHub shows 535 stars and 0 open issues [D]. `scheduler.py` is 862 lines in one file, so extraction is easy [C].

**(6) Fit.**

| Need | Score | Reason                                          |
| ---- | ----- | ----------------------------------------------- |
| N1   | 0     | No graph.                                       |
| N2   | 0     | No content model.                               |
| N3   | 0     | A card ID is a number.                          |
| N4   | 1     | A sound decay curve. The card is not a concept. |
| N5   | 0     | It gives a due date only.                       |
| N6   | 0     | No view.                                        |
| N7   | 0     | No tenants.                                     |

**(7) Integration.**

- (a) Service: no reason for a Python service [I].
- (b) Library: use `ts-fsrs` in the Node worker, half a day to 1 day, low risk [D][I].
- (c) Fork: no reason [I].
- (d) Port ideas: 2 hours for the forgetting curve, low risk [I].

I recommend (d) for N4 now, and (b) with `ts-fsrs` when spaced reviews arrive.

**(8) Best idea and trap.** The best idea is state as a pure function of the review log, as `reschedule_card` shows [C]. That gives a cheap undo: remove one log row and fold the log again [I]. The second idea is stability as the number of days to a retention of 0.90 [C]. The trap is the default parameter set. It describes new flashcards, where a first Good gives a stability of 2.3 days [C]. A topic that the learner marks as known is old knowledge, so those defaults make it decay too fast [I].

## 5. adaptive-explainer

**(1) What it is and the data model.** It is a Next.js 14 demo app that explains one topic in five steps [C]. The learner model is `level, confidence, knownConcepts, gapConcepts, vocabularyLevel, reasoning` (`src/lib/types.ts:14-21`) [C]. Level is beginner, intermediate or advanced. Vocabulary is everyday, technical or expert (`types.ts:1-3`) [C]. The default is beginner with a confidence of 0.3 (`types.ts:53-60`) [C]. Concepts are free-text strings with no ID [C]. A step holds `id, title, complexity, prerequisites` (`types.ts:5-12`) [C].

**(2) Algorithms and prompts.** The LLM returns a full model update after each learner question (`src/lib/prompts.ts:73-109`) [C]. The code treats that update as untrusted: it checks enums, clamps numbers, removes duplicates and caps lists at 50 (`src/lib/userModel.ts:42-68`) [C]. Known concepts accumulate. Each update replaces the gap list (`userModel.ts:53-59`) [C]. "Simpler" lowers the level by one, sets everyday vocabulary and subtracts 0.1 from confidence (`userModel.ts:76-84`) [C]. "Advance" adds 0.1 to confidence (`src/app/page.tsx:207-208`) [C].

The explanation prompt injects a model snapshot: level, confidence, vocabulary, known concepts, gaps and reasoning (`prompts.ts:5-13, 52-71`) [C]. Its rules: match the vocabulary, use a known concept as an analogy, address gaps, and skip covered steps (`prompts.ts:48-50, 70`) [C]. The path prompt asks for five steps with fixed complexity levels in strict JSON (`prompts.ts:19-46`) [C]. The app has no test questions, no decay and no misconception record [C].

**(3) Runtime.** Next.js 14 and React 18 with `@anthropic-ai/sdk` and `openai` (`package.json`) [C]. The session lives in browser `localStorage`, and no database exists (`src/app/page.tsx:48-70`) [C]. Each explanation and each question costs one LLM call with `max_tokens 4096` (`src/lib/llm.ts:40`) [C]. The README names Vercel as the host [D]. The code is TypeScript already, so no port question exists.

**(4) License.** The repository has no license file, and `package.json` has no license field [C]. The GitHub API also reports no license [D]. Default copyright then applies. We have no right to copy, change or host the code [I]. We can use the ideas, and we can ask the author for a license [I]. This is not legal advice.

**(5) Maturity.** About 2,400 lines in `src/`, 7 commits from 2026-05-08 to 2026-07-03, one author, 0 stars [C][D]. Four unit test files cover the parser, the rate limiter, validation and the model merge (`src/lib/__tests__/`) [C]. The prompt file is 129 lines and stands alone [C].

**(6) Fit.**

| Need | Score | Reason                                                                       |
| ---- | ----- | ---------------------------------------------------------------------------- |
| N1   | 0     | Five linear steps. No graph.                                                 |
| N2   | 0     | No stored content.                                                           |
| N3   | 0     | Concepts are free text.                                                      |
| N4   | 1     | A coarse model that the LLM infers. Not deterministic.                       |
| N5   | 2     | Prompts that adapt an explanation to known concepts, gaps and vocabulary.    |
| N6   | 1     | A side panel shows the learner model (`src/app/page.tsx:502-542`). No graph. |
| N7   | 0     | No tenants and no storage.                                                   |

**(7) Integration.**

- (a) Service: no. It is an end-user app [I].
- (b) Library: no. It exports no package [C].
- (c) Fork: the license status prevents it [I].
- (d) Port ideas: 1 day for our own prompts, low risk [I].

I recommend (d), with prompts that we write new.

**(8) Best idea and trap.** The best idea is the prompt contract: a compact learner snapshot goes into each explanation prompt [C]. The second idea is the strict validation of each LLM model update [C]. The trap is an LLM-set confidence over free-text concepts. That model has no identity, no evidence and no repeatable update [I].

## Comparison

| Project             | N1  | N2  | N3  | N4  | N5  | N6  | N7  |
| ------------------- | --- | --- | --- | --- | --- | --- | --- |
| tutor-mcp           | 1   | 2   | 0   | 2   | 1   | 1   | 2   |
| knowledge-graph-mcp | 1   | 0   | 1   | 1   | 1   | 2   | 0   |
| pyBKT               | 0   | 0   | 0   | 1   | 0   | 0   | 1   |
| py-fsrs             | 0   | 0   | 0   | 1   | 0   | 0   | 0   |
| adaptive-explainer  | 0   | 0   | 0   | 1   | 2   | 1   | 0   |

| Project             | Shape             | License | Recommended option  | Effort      | Risk |
| ------------------- | ----------------- | ------- | ------------------- | ----------- | ---- |
| tutor-mcp           | Go MCP server     | MIT     | (d) port ideas      | 5 to 7 days | Low  |
| knowledge-graph-mcp | Python MCP server | MIT     | (d) port ideas      | 1 to 2 days | Low  |
| pyBKT               | Python library    | MIT     | (d) port the update | Half a day  | Low  |
| py-fsrs             | Python library    | MIT     | (d) port the curve  | 2 hours     | Low  |
| adaptive-explainer  | Next.js app       | None    | (d) own prompts     | 1 day       | Low  |

## Verdict for the learner model of N4

All of this section is [I], with sources in the sections above.

**Where BKT does not match.** BKT fits its parameters for each skill from many learner sequences. One learner with a self-mark and three answers cannot support a fit. Use the observation formula with fixed parameters instead. BKT forget applies to each practice step, so it gives no decay over calendar time. BKT also has no input for a self-mark.

**Where FSRS does not match.** FSRS models the recall of one fixed card, with a rating from each review. A topic gets a different question each time, so no single card exists. The defaults describe new flashcards, and the optimizer needs 512 reviews. Take the curve shape only. Do not use IRT, because generated questions have no calibrated item parameters.

**State fields for each learner and topic.**

- `self_mark` and `self_mark_at`.
- `p_known`, `n_checks`, `n_correct`, `last_evidence_at`.
- `stability_days`. Compute retention when you read the row.
- `status`, one of `unknown, claimed, checked, stale, misconception`.
- `policy_version` and `folded_through_event_id`.

Keep an append-only event table as the source of truth: self-mark, answer and retraction events. Keep a separate misconception table with `key, detail, first_seen, last_seen, count, status` and the evidence event IDs.

**Update rules.**

1. Start each topic at `p_known = 0.15`.
2. On a self-mark "known", set `p_known = max(p_known, 0.70)` and the status `claimed`.
3. Cap `p_known` at 0.84 until one check passes.
4. On a check answer, apply the BKT observation only, with guess and slip for the question format.
5. Apply no learn transition for a check question.

Proposed constants: guess 0.25 and slip 0.10 for a four-option question, guess 0.05 and slip 0.15 for free text. Worked example: a claimed topic at 0.70 moves to 0.89 after one correct answer, and to 0.24 after one wrong answer. A cold topic at 0.15 needs three correct answers: 0.39, 0.70, 0.89. So a self-mark plus one check equals three cold checks.

**Decay.** Keep `p_known` without decay. Compute `retention = (1 + (19/81) t / stability_days)^-0.5` and `effective = p_known x retention`. Proposed stability: 30 days after a self-mark, 60 days after the first passed check, double after each later pass, 7 days after a failure. Below an effective value of 0.70, set the status `stale` and ask one check question. Do not switch the topic to unknown without a question.

**Uncertainty and question choice.** Show the binary entropy of `p_known` together with `n_checks`. Mark low confidence with fewer than 2 checks, with stale evidence, or within 0.05 of the threshold. Ask the question with the highest expected information gain, weighted by the passages that it can collapse.

**Misconceptions and undo.** A wrong answer that matches a named distractor opens an active misconception. An active misconception blocks the collapse of passages. Close it after two later correct answers on the topic. For undo, mark the event as retracted and fold the event log again.

**Use of the state.** Collapse passages for `claimed` and `checked` topics with no active misconception. Skip a topic in a second course only when it is `checked`, at 0.85 or more, with an effective value of 0.70 or more.

**Why.** Every rule is one formula with fixed constants, so each update is deterministic and easy to inspect. The self-mark gives a fast start, and the cap stops it from counting as proof. The event log gives a cheap undo and lets us change constants later through `policy_version`.

## What I inspected

- tutor-mcp: all of `algorithms/`, and the decision files of `engine/` (orchestrator pipeline, phase, selectors, mastery status, uncertainty, evidence). Also `models/learner.go`, `models/curriculum.go`, parts of `tools/`, `certification/`, two `db/` files and three docs.
- knowledge-graph-mcp: models, schema, SM-2, and the key parts of the query engine, graph service and Mermaid generator.
- pyBKT: the pure Python fit, the M step, prediction, random starts, and the key lines of `Model.py` and `Roster.py`.
- py-fsrs: the scheduler constants and formulas, card, state, rating, review log, and the optimizer outline.
- adaptive-explainer: types, user model, prompts, and the key lines of `llm.ts`, the routes and `page.tsx`.

On the web I read the GitHub repository API, the npm registry and the `ts-fsrs` docs through Context7.

I did not inspect these parts of tutor-mcp: `auth/`, most of `db/`, `memory/`, the scheduler, the `ui/` site and the `client/` desktop app. I did not read the pyBKT C++ code, the Eigen folder, or the cost simulation in the py-fsrs optimizer. I did not read the body of any test. I ran no code and no tests from the five repositories.
