# Course as a Topic Graph — Plan Brief

> Full plan: `context/changes/course-topic-graph/plan.md`
> Research: `context/changes/course-topic-graph/research.md`

## What & Why

A learner sees a loaded course as a map of its topics and their relations (roadmap S-02, FR-003). Each later slice of milestone M-01 builds on this map: the marks, the adjusted lesson list and the collapsed passages. The map is the core of the product, so its quality has priority.

## Starting Point

S-01 stores each lesson as Markdown, and F-01 runs jobs in a worker with one job in progress for each learner. No topic exists, no model call ran on course text, and the web app has no graph library.

## Desired End State

A crawl course gets its topic map by itself after the load, and an extension course gets a button. The map page shows an overview of the lessons and, for one open lesson, its topics with parent boxes, prerequisite arrows and quotes. A changed course marks its map as older, and an update analyses only the changed lessons.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Engine | Cognee as the extraction engine now (form K1), in a separate Python service, with the call `extract_content_graph` only and no Cognee store | The owner wants Cognee in the MVP, and a run with no store needs no embeddings and no database setup. | Research W.9 / Plan |
| Local model source | A bridge at the model address answers through Claude Code | Local runs use the subscription of the owner on the same path as production. | Plan |
| Model and limit | Haiku 5.5, one comparison with Sonnet 5.5 on 3 lessons, 5 USD each month | It has the lowest cost, and a model change needs evidence. | Research / Plan |
| CI path | The real engine with a fake model | Each pull request proves the contract between the worker and the engine. | Plan |
| Topic and passage | A topic is a named concept, and a passage is one heading section with an exact quote on each link | It matches the example in the shape notes, and S-05 can collapse the quoted paragraph. | Plan |
| Home lesson | The first lesson that explains the topic, else the first mention | The topic sits where the learner learns it. | Plan |
| Relations | `prerequisite` and `part_of` | S-04 needs an order, and a parent lets S-03 mark its children in one step. | Plan |
| Identity | A name rule, then the model selects a known topic, inside one course | In doubt two topics stay apart, because a wrong join hides text that the learner needs. | Plan |
| Start and change | Automatic after a crawl, a button for an extension course, and a mark with an update for a changed course | A crawl course needs no extra click, and each topic keeps its id in an update. | Research R.10 / Plan |
| View and click | Two levels and an outline with React Flow and dagre, and a panel with quotes | Each level holds about 15 nodes, and the owner can check each link against the text. | Research R.6 / Plan |
| Failure | A partial map, with a mark and a new try for each failed lesson | It is the rule of S-01, and no paid result is lost. | Plan |
| Quality | A stored report, and a review of two real courses by the owner | Numbers show a regression, and the review judges the meaning. | Plan |
| System of record | Our own tables, with the six rules of R.6 | Later slices add tables and change none. | Research |
| Job safety and rules | Each lesson result is stored at once, and the database holds the owner check and a quota of 5 runs in one hour | A job can start two times with the same result, and a learner can insert a job row directly. | Plan |
| Phone check | One exception for the map canvas | A canvas that pans reaches past the screen edge by design. | Plan |
| Later phases | Phases B to E are in the `## Parked` section of the roadmap | They stay in view after S-02 goes to the archive. | Plan |

## Scope

**In scope:**

- The engine service with the Cognee call, the Claude Code bridge, the fake model and the passage splitter
- The knowledge tables, the job type with its rules, and the topic job with its checks and its report
- The course page section, the map page, the CI path, the engine deploy job and the documents

**Out of scope:**

- The full Cognee pipeline, its stores, embeddings and loaders (phase D)
- Learner state and the overlay (S-03, S-07), the topic page (S-08), the lesson reader (S-05), identity across two courses (S-10)
- Claude Code calls in CI or in production

## Architecture / Approach

The worker keeps the database key, and the engine holds the model key. The worker sends the passages of one lesson to the engine and checks the answer in code. One setting, the model address, selects the model source.

```text
Web app -> Postgres <-> Worker -> Engine (Cognee call) -> model address
model address: Anthropic API (production) | bridge to Claude Code (local) | fake model (CI)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Engine proof | The engine, the bridge, the fake model, the splitter, and the output of 3 real lessons | Haiku 5.5 gives no valid structured answer through Cognee and LiteLLM |
| 2. Knowledge tables and job rules | 8 tables, the functions, the job type, the quota, the start after a crawl | The start after a crawl blocks a reload until the topic job ends |
| 3. Topic job in the worker | A done topic job with a map in the tables, safe to run two times | The identity check joins or splits topics wrongly on real text |
| 4. Topic map in the web app | The course page section, the map page, the outline and the panel | The canvas and the 44 px rule on a phone |
| 5. CI path | The full path in the smoke job with the fake model | The fake model must follow the request form of LiteLLM |
| 6. Production and quality review | The engine in production, and the quality accepted by the owner | The production rows wait for the Google setup |

**Prerequisites:** `uv` and Python 3.12 on the machine. A Claude Code login with a subscription. An Anthropic API key for one proof call and for production. The Google setup of the human for the production rows, which the open rows of F-01 and S-01 also need.

**Estimated effort:** 50 to 60 likely hours in 6 phases. This is an estimate. Its base is the 60.5 hours of `research.md` W.10 for K1 with the full pipeline. With K1, 10 working days hold S-02, S-03, S-04 and S-07.

## Open Risks & Assumptions

- No run proved the request form that LiteLLM sends for `claude-haiku-5-5`. Phase 1 has a stop rule for this.
- The quality of the topics on real text is the largest risk. Each prompt change costs review hours of the owner.
- A call through Claude Code differs in details from a call through the API. Nobody measured the memory of the engine.
- The bridge is a local tool. The Claude Code rules permit scripted use with the own subscription, and they can change.
- A course of 150 lessons can need more than one job start, because the job reads the lessons one at a time.

## Success Criteria (Summary)

- The owner opens the map of a real course, opens a lesson and a topic, and reads a quote that is in the original text.
- The owner accepts the graph of two real courses after a review against the text.
- A changed lesson costs one engine call, and each topic keeps its id.
