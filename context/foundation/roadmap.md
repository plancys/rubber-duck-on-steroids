---
project: "Rubber Duck on Steroids"
version: 1
status: draft
created: 2026-11-23
updated: 2026-11-27
prd_version: 1
main_goal: market-feedback
top_blocker: time
milestone_id: first-adjusted-course
milestone_seq: 1
milestone_status: open
---

# Roadmap: Rubber Duck on Steroids

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; the next milestone continues this file. Archive only when an independent roadmap replaces it.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-01: First adjusted course** — Status: open

- **Intent:** A learner loads one course, tells the product what they already know, and gets a lesson list and lesson text adjusted to that knowledge. A second material then gets an assessment of its new topics only.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** FR-001 to FR-011 (the must-have requirements) and US-01.

## Vision recap

A working software engineer learns new technologies through online courses. The course material is not adjusted to what the engineer already knows, so the engineer cannot skip the known parts. Nothing lets the engineer put their own knowledge over the content of a course and see the difference.

## North star

**S-04: Learner can get a lesson list for a course adjusted to their knowledge** — it is the first point where the product hides something because of what the learner knows. It gives the earliest answer to the main success criterion: does the learner agree with what the product hides.

> "North star" here means the smallest end-to-end slice that proves the product works. It gets the earliest place that its prerequisites allow, because the other slices only matter if this one works.

## At a glance

| ID   | Change ID                       | Outcome (user can …)                                                                 | Prerequisites | PRD refs              | Status   |
| ---- | ------------------------------- | ------------------------------------------------------------------------------------ | ------------- | --------------------- | -------- |
| F-01 | background-work-path            | (foundation) long work runs outside a page request, and the learner sees its progress | —             | FR-002, FR-003        | in-progress |
| S-01 | load-course-from-url            | load a course from the URL of its web page and see its lessons in order              | F-01          | FR-001, FR-002, US-01 | done |
| S-02 | course-topic-graph              | see a loaded course as a graph of its topics                                         | S-01          | FR-003                | done        |
| S-03 | mark-known-topics               | mark the topics they believe they already know                                       | S-02          | FR-005                | in-progress |
| S-04 | adjusted-lesson-list            | get a lesson list adjusted to their knowledge, with known lessons marked as skipped  | S-03          | FR-008, US-01         | blocked  |
| S-05 | collapsed-known-passages        | read a lesson in which the passages on known topics are collapsed                    | S-04          | FR-009, US-01         | blocked  |
| S-06 | double-check-questions          | answer questions that double-check the knowledge they claimed                        | S-03          | FR-006                | blocked  |
| S-07 | knowledge-on-course-graph       | see how their knowledge fits the course graph, one part at a time                    | S-03          | FR-007                | proposed |
| S-08 | navigate-topic-graph            | navigate the course graph and open any topic in it                                   | S-02          | FR-004                | proposed |
| S-09 | summaries-of-known-passages     | read a short summary in place of a long passage on a known topic                     | S-05          | FR-010                | proposed |
| S-10 | second-material-new-topics-only | add another material and get an assessment of the new topics only                    | S-02, S-06    | FR-011                | blocked  |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                 | Chain                             | Note                                                                    |
| ------ | --------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| A      | Course in, topics out | `F-01` → `S-01` → `S-02` → `S-08` | Every other stream starts from the topic graph of `S-02`.               |
| B      | Adjusted path         | `S-03` → `S-04` → `S-05` → `S-09` | Joins Stream A at `S-02`. It holds the north star and goes first.       |
| C      | Checked knowledge     | `S-06` → `S-10`                   | Joins Stream B at `S-03`. It can run beside the adjusted path.          |
| D      | Knowledge view        | `S-07`                            | Joins Stream B at `S-03`. It is not on the path to the north star.      |

## Baseline

What's already in place in the codebase as of `2026-11-23` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — the web framework, the component layer, the styling and five looks are in place. Pages exist for the landing page, sign-in and the dashboard (`src/pages/`, `src/themes/`). No graph view exists.
- **Backend / API:** partial — request handlers exist for sign-in and for the notes sample (`src/pages/api/`, `src/middleware.ts`). No mechanism for background work exists. No language-model code exists.
- **Data:** partial — the database, the migration tooling and generated types are in place (`supabase/migrations/`, `src/db/database.types.ts`). The only table is `notes`, with access rules for each user. No product tables exist.
- **Auth:** present — email and password sign-in, password reset and OAuth sign-in work (`src/pages/api/auth/`). A signed-out visitor who opens a dashboard page goes to the sign-in page (`src/middleware.ts`).
- **Deploy / infra:** partial — the deploy configuration and a pipeline with lint, type check, build, smoke test and deploy exist (`wrangler.jsonc`, `.github/workflows/ci.yml`). The deploy job needs secrets, and the baseline did not check them. No unit test runner exists.
- **Observability:** partial — a health check page and platform logs are on (`src/pages/healthcheck.ts`, `wrangler.jsonc`). No error tracking exists.

## Foundations

### F-01: Path for background work

- **Outcome:** (foundation) Long work runs outside a page request, and the learner sees its progress and its result.
- **Change ID:** background-work-path
- **PRD refs:** FR-002, FR-003
- **Unlocks:** S-01 (the load of a course runs longer than one page request) and S-02 (the topic graph needs long processing). It also reduces Open Roadmap Question 17, the place where long work runs.
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Where does long work run, with no tight link to one provider and at minimal cost? (Open Roadmap Question 17) — Owner: user. Block: no.
- **Risk:** It goes first because both S-01 and S-02 need work that outlives a page request. The scope is one trivial job from start to result, not a complete job system. The hosting choice can take more effort than the mechanism.
- **Status:** in-progress

## Slices

### S-01: Load a course from its URL

- **Outcome:** Learner can load a course by giving the URL of its web page, and see its lessons in the order of the course.
- **Change ID:** load-course-from-url
- **PRD refs:** FR-001, FR-002, US-01
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Does the example course site accept the requests of the loader? An automated request got a refusal on 2026-11-23. — Owner: user. Block: no.
  - How long do done and failed jobs stay in the `jobs` table? Nothing removes them yet, and course loading adds real volume. — Owner: user. Block: no.
- **Risk:** It is the first user-visible step, and every later slice needs a loaded course. Course sites differ, and one URL is not always one course. If the loader cannot read the example site, the parked manual fallback (FR-013) comes back.
- **Status:** done

### S-02: Course as a topic graph

- **Outcome:** Learner can see a loaded course as a graph of its topics and how they relate.
- **Change ID:** course-topic-graph
- **PRD refs:** FR-003
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Which language-model service does the product use, and what is the spend limit? (Open Roadmap Question 18) — Owner: user. Block: no. Answered: the Anthropic API with `claude-haiku-5-5`, 5 USD each month.
  - Which sub-problems reuse existing open-source projects? (Open Roadmap Question 19) — Owner: user. Block: no. Answered: Cognee for the extraction call.
- **Risk:** It comes directly after S-01 so that the quality of the topics shows early. Every later slice inherits the errors of this graph. This slice also brings the first language-model work into the product.
- **Status:** done

### S-03: Mark known topics

- **Outcome:** Learner can mark the topics they believe they already know.
- **Change ID:** mark-known-topics
- **PRD refs:** FR-005
- **Prerequisites:** S-02
- **Parallel with:** S-08
- **Blockers:** —
- **Unknowns:**
  - Does a claim have two states, known or not known, or more levels? — Owner: user. Block: no.
- **Risk:** It is the smallest way to record knowledge, and the north star needs it. A course can have many topics, so the marking must stay quick.
- **Status:** in-progress

### S-04: Adjusted lesson list

- **Outcome:** Learner can get a lesson list for a course adjusted to their knowledge, reordered if needed, with known lessons marked as skipped.
- **Change ID:** adjusted-lesson-list
- **PRD refs:** FR-008, US-01
- **Prerequisites:** S-03
- **Parallel with:** S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - When does a lesson count as already known, and when does the order change? This is part of the missing domain rule (Open Roadmap Question 1). — Owner: user. Block: yes.
  - Which numbers stand for "nearly all" and "noticeably faster"? (Open Roadmap Question 12) — Owner: user. Block: no.
- **Risk:** It is the north star, so it goes as early as its prerequisites allow. It uses claimed knowledge, and S-06 adds the check later. It cannot be planned before the domain rule exists.
- **Status:** blocked

### S-05: Collapsed known passages

- **Outcome:** Learner can read a lesson in which the passages on topics they already know are collapsed into an expandable block labelled "already known".
- **Change ID:** collapsed-known-passages
- **PRD refs:** FR-009, US-01
- **Prerequisites:** S-04
- **Parallel with:** S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - Which passages count as known? This is part of the missing domain rule (Open Roadmap Question 1). — Owner: user. Block: yes.
  - How does a learner undo a wrong "already known" mark? (Open Roadmap Question 13) — Owner: user. Block: no.
- **Risk:** It directly follows the north star, because the learner said that whole lessons are rarely known. A wrong mark hides text that the learner needs, so the original text must stay one step away.
- **Status:** blocked

### S-06: Double-check questions

- **Outcome:** Learner can answer questions that double-check the knowledge they claimed.
- **Change ID:** double-check-questions
- **PRD refs:** FR-006
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-05, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - What does a wrong answer do to the recorded knowledge? This is part of the missing domain rule (Open Roadmap Question 1). — Owner: user. Block: yes.
- **Risk:** It comes after the north star, because the adjusted list can start from claimed knowledge. A bad question gives a wrong verdict, and a wrong verdict hides needed text.
- **Status:** blocked

### S-07: Knowledge on the course graph

- **Outcome:** Learner can see how their current knowledge fits the course graph, one part of the course at a time.
- **Change ID:** knowledge-on-course-graph
- **PRD refs:** FR-007
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-05, S-06, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** It is not on the path to the north star, so it comes late while time is the main risk. A large course is hard to show, and the PRD limits the view to one part at a time.
- **Status:** proposed

### S-08: Navigate the topic graph

- **Outcome:** Learner can navigate the course graph and open any topic in it.
- **Change ID:** navigate-topic-graph
- **PRD refs:** FR-004
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-07, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The adjusted list does not need it, so it comes late while time is the main risk. It depends only on S-02, so a separate agent run can do it at any time after S-02.
- **Status:** proposed

### S-09: Summaries of known passages

- **Outcome:** Learner can read a short summary in place of a long passage on a topic they already know.
- **Change ID:** summaries-of-known-passages
- **PRD refs:** FR-010
- **Prerequisites:** S-05
- **Parallel with:** S-06, S-07, S-08, S-10
- **Blockers:** —
- **Unknowns:**
  - How long must a passage be before a summary replaces it? — Owner: user. Block: no.
- **Risk:** It builds on the collapsed passages of S-05. A summary can distort the original text, so the original text must stay one step away.
- **Status:** proposed

### S-10: Second material, new topics only

- **Outcome:** Learner can add another material and get an assessment of only the topics that are new compared with what they already know.
- **Change ID:** second-material-new-topics-only
- **PRD refs:** FR-011
- **Prerequisites:** S-02, S-06
- **Parallel with:** S-04, S-05, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Does a finished lesson change what the product records as known? (Open Roadmap Question 14) — Owner: user. Block: yes.
  - How does a new analysis undo a wrong `sameAs` join? In S-02 a `sameAs` answer of the model joins two topics of a course for good, and joins chain. A wrong join stays when the lesson is analysed again. S-10 changes the identity check, so it decides this rule too. Source: finding F4 of `context/changes/course-topic-graph/reviews/impl-review.md`. — Owner: user. Block: no.
- **Risk:** It comes last because one course is enough for the north star. Two materials name the same topic in different ways, and a wrong match skips an assessment that the learner needs.
- **Status:** blocked

## Backlog Handoff

Linear project: [Rubber-duck-on-steroids](https://linear.app/rubber-duck-on-steroids/project/rubber-duck-on-steroids-21899553635e), milestone `M-01: First adjusted course`. The decision issues RUB-5 (Question 1) and RUB-6 (Question 14) block the slices that wait for them.

| Roadmap ID | Linear | Change ID                       | Suggested issue title                                   | Ready for `/10x-plan` | Notes                                                    |
| ---------- | ------ | ------------------------------- | ------------------------------------------------------- | --------------------- | -------------------------------------------------------- |
| F-01       | RUB-7  | background-work-path            | Run long work outside a page request and show progress  | yes                   | Run `/10x-plan background-work-path`                     |
| S-01       | RUB-8  | load-course-from-url            | Load a course from its URL and list its lessons         | no                    | Waits for F-01                                           |
| S-02       | RUB-9  | course-topic-graph              | Show a loaded course as a graph of topics               | no                    | Waits for S-01                                           |
| S-03       | RUB-10 | mark-known-topics               | Let the learner mark known topics                       | no                    | Waits for S-02                                           |
| S-04       | RUB-11 | adjusted-lesson-list            | Give a lesson list adjusted to the learner's knowledge  | no                    | Blocked: the domain rule is missing (Question 1)         |
| S-05       | RUB-12 | collapsed-known-passages        | Collapse the passages on known topics in a lesson       | no                    | Blocked: the domain rule is missing (Question 1)         |
| S-06       | RUB-13 | double-check-questions          | Ask questions that double-check claimed knowledge       | no                    | Blocked: the domain rule is missing (Question 1)         |
| S-07       | RUB-14 | knowledge-on-course-graph       | Show the learner's knowledge on the course graph        | no                    | Waits for S-03                                           |
| S-08       | RUB-15 | navigate-topic-graph            | Navigate the topic graph and open a topic               | no                    | Waits for S-02                                           |
| S-09       | RUB-16 | summaries-of-known-passages     | Replace long known passages with short summaries        | no                    | Waits for S-05                                           |
| S-10       | RUB-17 | second-material-new-topics-only | Assess only the new topics of a second material         | no                    | Blocked: Question 14 is open                             |

## Open Roadmap Questions

Questions 1 to 16 are a copy of the open questions of the PRD. Questions 17 to 19 came from the stack selection and the baseline.

1. **What is the one-sentence business rule?** — TBD by user. Block: yes (PRD is hollow until resolved). — Owner: user. Block: S-04, S-05, S-06.
2. **What are the non-functional requirements?** None were captured; shaping stopped before they were asked. — Owner: user. Block: none.
3. **What is the first version explicitly not doing?** No non-goals were captured. The nice-to-have requirements FR-012, FR-013 and FR-014 sit outside the first version by their priority, and whether to list them as explicit non-goals is part of this question. So is whether "we do not build our own X" becomes a scope non-goal, which the user's preference for reusing existing open-source projects raised. — Owner: user. Block: none.
4. **What kind of product is this (`product_type`)?** Not captured. — Owner: user. Block: none. The user answered "a web app" in the stack selection session. The PRD does not hold this answer.
5. **Roughly how many people will use it (`target_scale`)?** Not captured. — Owner: user. Block: none. The user answered "initially only me, later on up to hundred" in the stack selection session. The PRD does not hold this answer.
6. **Is there a hard deadline (`timeline_budget.hard_deadline`)?** Not captured. — Owner: user. Block: none.
7. **Is this after-hours work only (`timeline_budget.after_hours_only`)?** Not asked directly. The 6-week budget was stated in weeks of after-hours work. — Owner: user. Block: none.
8. **Is US-01 correct?** The story was assembled from the first-session flow, the success criteria and the requirements, and the user has not confirmed it. — Owner: user. Block: none.
9. **Which sign-in methods does login offer?** The user chose "login" without picking a method (email and password, a third-party sign-in, or a passwordless link). — Owner: user. Block: none. The baseline has email and password sign-in and OAuth sign-in. The user must confirm that this is the answer.
10. **What does a visitor who is not signed in see when they open a page that needs an account?** Not discussed. — Owner: user. Block: none. In the baseline, the visitor goes to the sign-in page. The user must confirm that this is the answer.
11. **What are the secondary success outcomes?** The user answered "Not sure yet". Candidates that were offered and not picked: a second material reuses the learner's knowledge; the graph helps judge a course upfront; the graph shows where a missing prerequisite is covered. — Owner: user. Block: none.
12. **What are the measurable targets for the two primary outcomes?** "Nearly all" (agreement with what is hidden) and "noticeably faster" (time to finish) have no numbers yet. — Owner: user. Block: none.
13. **How does a learner undo a wrong "already known" mark?** The guardrail says a wrong mark must be cheap to undo. The capability "Learner can correct what the product thinks they know" was offered in the completeness check and not added, so no requirement provides it. — Owner: user. Block: none.
14. **Does finishing a lesson change what the product records as known?** Progress tracking (FR-014) was kept as nice-to-have bookkeeping, and the option that completed lessons count as known was not chosen. FR-011 assesses a new material only on topics that are new to the learner, so whether topics learned from an earlier course count as known is undecided. — Owner: user. Block: S-10.
15. **What form does manually downloaded course content take for FR-013?** The user said "somehow manually download"; a saved page, pasted text or a file are all possible. Low urgency, because FR-013 is nice-to-have. — Owner: user. Block: none.
16. **Has the shaping quality cross-check been run?** No. Shaping stopped after its fourth phase, so business logic, non-functional requirements, product framing and non-goals were never asked, and the closing cross-check is still pending. — Owner: user. Block: none.
17. **Where does long work run?** The user wants no tight link to one provider and a minimal cost, zero if possible. The hosting of long work is not decided. — Owner: user. Block: none. The plan of F-01 must settle it.
18. **Which language-model service does the product use, and what is the spend limit?** Calls to a language model cost money for each use, and the user wants a minimal cost. — Owner: user. Block: none. The plan of S-02 must settle it. The user answered in the plan of S-02 (`course-topic-graph`): the Anthropic API with the model `claude-haiku-5-5`. The spend limit is 5 USD each month in the Claude Console. The GitHub variable `TOPIC_MODEL` holds the model of the topic engine. The user can select another model after the comparison with Sonnet 5.5.
19. **Which sub-problems reuse existing open-source projects?** The user prefers well-known open-source projects for sub-problems. No project is selected. — Owner: user. Block: none. It applies first to the plan of S-02. The user answered in the plan of S-02 (`course-topic-graph`): the topic engine uses Cognee for the extraction call (`extract_content_graph`). It uses our own graph model and prompt. The parked phase D lists the parts of Cognee that S-02 does not use.

## Parked

- **Load knowledge from epub, mobi, md and pdf files (FR-012)** — Why parked: the PRD gives it the priority nice-to-have, and the seed idea names it for the next phases.
- **Manual download fallback when a URL does not load (FR-013)** — Why parked: the PRD gives it the priority nice-to-have. It comes back if the loader of S-01 cannot read the example course site.
- **Mark lessons as done and see progress on the path (FR-014)** — Why parked: the PRD gives it the priority nice-to-have, and neither primary success outcome depends on it.

The four entries below are the later phases from the research of the change `course-topic-graph` (`research.md`, sections R.9 and P.11). No FR covers them yet. A new milestone must pick them up.

- **Phase B: a deeper learner model** — Why parked: milestone M-01 uses four learner states and no decay. Content: a probability for each topic, decay with `ts-fsrs`, misconception records, and the choice of the next question. Start it when: the owner uses the product on a second course and wants re-checks. Source: `research.md` R.9 and F.6.
- **Phase C: the shared store** — Why parked: milestone M-01 has one named user and no shared store. Content: spaces, two schemas with separate grants, one role for each job kind of the worker, the promotion gate, and the list of topic events. Start it when: a second person must read the same map. Source: `research.md` R.9, H.5 and H.6.
- **Phase D: the company scale with the full Cognee pipeline** — Why parked: S-02 uses Cognee only for the extraction call (`extract_content_graph`) with our own graph model and prompt. The Cognee chunker, the loaders for PDF and EPUB (FR-012), and the Cognee stores are not in use. Content: Cognee as the engine for shared sources with `add` and `cognify`, a second database, connectors, access lists for groups, and end dates on relations. Start it when: many sources of many kinds exist, and groups need access lists. Source: `research.md` R.9 and W.6 to W.11.
- **Phase E: the private brain as a service** — Why parked: it is outside milestone M-01 and outside phases B to D. Content: claims of more kinds, consent with scopes, an audit, the sharing gateway, and share views with labels on claims. Start it when: a second app outside this product needs the data of a person. It needs phase B and a separate private store. Source: `research.md` P.11, G.6 to G.10 and M.4 to M.13.

## Milestone History

(Append-only. Empty on the first milestone.)

## Done

(Empty on first generation. `/10x-archive` appends an entry here when it archives a change whose `Change ID` matches an item.)

- **S-01: Learner can load a course by giving the URL of its web page, and see its lessons in the order of the course.** — Archived 2026-11-25 → `context/archive/2026-11-24-load-course-from-url/`. Lesson: —.
- **S-02: Learner can see a loaded course as a graph of its topics and how they relate.** — Archived 2026-11-27 → `context/archive/2026-11-25-course-topic-graph/`. Lesson: —.
