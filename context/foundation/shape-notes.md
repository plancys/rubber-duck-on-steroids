---
project: "Rubber Duck on Steroids"
context_type: greenfield
created: 2026-11-23
updated: 2026-11-23
timeline_budget:
  mvp_weeks: 6
checkpoint:
  current_phase: 5
  phases_completed: [1, 2, 3, 4]
  gray_areas_resolved:
    - topic: "context type"
      decision: "greenfield — git history holds only workflow scaffolding, no product code"
    - topic: "project name"
      decision: "Rubber Duck on Steroids (the repository's name)"
    - topic: "primary persona scope"
      decision: "the author first — a single named user for v1; a working software engineer learning new tech"
    - topic: "primary pain moment"
      decision: "starting a course in a half-known domain; judging a course upfront and hitting a gap mid-course stay secondary"
    - topic: "pain category"
      decision: "missing capability, workflow friction and decision paralysis all apply"
    - topic: "insight"
      decision: "gap between well-organized but fixed human-made courses and flexible but less organized LLM learning; three supporting beliefs confirmed"
    - topic: "auth strategy"
      decision: "login with an account; open sign-up; one flat role; each learner sees only their own data"
    - topic: "knowledge elicitation"
      decision: "self-assessment, double-checked by questions; answering questions is the most important input"
    - topic: "path granularity"
      decision: "lesson list with skips plus passage-level collapsing and summaries; lesson-level only is not granular enough"
    - topic: "MVP scope"
      decision: "full flow kept in v1; user committed to a longer timeline instead of scoping down; nothing moved to v2"
    - topic: "timeline"
      decision: "4 to 6 weeks of after-hours work; recorded as mvp_weeks 6 (upper bound)"
    - topic: "example source format"
      decision: "text articles, open without an account (user's statement)"
    - topic: "success criteria"
      decision: "primary: learner agrees with what is hidden, and finishes noticeably faster; guardrails: hidden content never lost, knowledge stays private; secondary left open"
    - topic: "URL loading fallback"
      decision: "URL loading stays must-have; manual download fallback added as FR-013, nice-to-have"
    - topic: "self-assessment vs quiz"
      decision: "both stay must-have; marking narrows which topics the questions check"
    - topic: "knowledge overlay on large courses"
      decision: "shown one part of the course at a time"
    - topic: "progress tracking"
      decision: "added as FR-014, nice-to-have; kept separate from the knowledge record"
  frs_drafted: 14
  quality_check_status: pending
---

# Shape Notes

## Seed idea

Captured verbatim on 2026-11-23:

> I want to build project which will improve learning process for learners.
> I want to have ability to load knowledge to it - for start it can be some course webpage like https://learn.clickhouse.com/real-time-analytics-with-clickhouse
> I would like to have visualisation of this knowledge (preferably as a graph) and option to navigate on it. For MVP only website digest is enough. For next phases epub, mobi, md, pdf files would be nice as well.
> Key feature would be to have an option to see how my current knowledge fits this knowledge graph.
> And here is killer feature: having "topic's knowledge graph" and "my personal knowledge graph" (graph or other structure) we can prepare learning path adjusted to my current knowledge - learner can speed-up skipping parts which he already know.

## Vision & Problem Statement

Captured in Phase 1 from the user's answers.

- **Pain:** Course material is not adjusted to what the learner already knows, so the learner cannot skip the parts they already know. Nothing lets them lay their own knowledge over a course's content and see the difference.
- **Person:** A working software engineer picking up new technologies through online courses alongside the job. For v1 this is the project author.
- **Moment (primary):** Starting a course in a half-known domain, and having to wade through basics to reach the new material.
- **Moments (secondary):**
  - Judging a course upfront: before committing time, the learner cannot tell from the syllabus how much of it is new to them.
  - Hitting a gap mid-course: a lesson assumes something the learner does not know, and they cannot see where that prerequisite is covered.
- **Cost today:** The learner goes through everything linearly and spends hours re-covering material they already know, or loses momentum in the known parts and drops the course before reaching the new parts.
- **Pain category:** Missing capability, workflow friction and decision paralysis (the learner cannot decide what to skip, what to study next, or whether a course is worth starting).

**Insight, in the user's words:**

> I belve there is a gap between well-organized human made courses with fixed, linear same-for-everyone path and learning using LLM which is very flexible but sometimes not so well-organised

Supporting beliefs the user confirmed:

- Course platforms only see their own course. They track progress inside their own content and do not know what the learner already knows coming in, so they cannot personalize.
- The structure is locked in linear pages. The concepts and their dependencies exist in the material, but only as a sequence of lessons, and nobody exposes them as a map the learner can navigate.
- Mapping was too costly by hand. Adaptive learning used to need a hand-authored concept map per course; deriving the map from the content itself is what has become feasible.

## User & Persona

**Primary persona:** the project author, as the single named user of v1.

- **Role:** A working software engineer learning new technologies.
- **Context:** Learns through online courses alongside the job. The example source named in the seed is the ClickHouse course "Real-time analytics with ClickHouse".
- **Moment they reach for the product:** When starting a course in a domain they partly know.

No secondary persona has been named.

## MVP flow (locked in Phase 3)

The user's answers on 2026-11-23, verbatim:

> How do you tell the app what you already know? -> could be mixed but most important is evaluation of knowledge by answering questions / quizz. I belive that user can assess his knowledge by himself and service should challenge / double-check that. Also when we add another course / book with some topics overlaping previous one we should evaluate user's knowledge only from new ideas/topics. Basically representation of "user brain" should be somehow shareable between new materials.

> What does the adjusted path look like when you get it? -> Reordered (if needed) list of lesson could be fine, some of them can be marked as skipped and some of topics can only summariezed by LLM if it's too descriptive and we know this topic. For example is user understand what ACID means in DB numenclature and we understands isolation levels very well and we have one huge paragraph about Repetable read then we can for example hide it with expandable view and somehow mark it as "Repeadable reads explanation [already known]" or samething like this. Ordering and hiding whole articles can be not enough granular IMO

The flow of the first version. The user chose to keep the full flow in v1 and moved nothing to v2:

1. The learner signs in.
2. The learner pastes the URL of a course page.
3. The learner sees the course as a graph of topics and moves around it.
4. The learner marks which topics they believe they know (self-assessment).
5. The learner answers questions that double-check those claims.
6. The learner sees their knowledge laid over the course graph.
7. The learner gets the adjusted path: a list of lessons, reordered if needed, with some marked as skipped.
8. The learner opens a lesson in which passages on topics they already know are collapsed or summarized and labelled "already known".

Later sessions: the learner adds a second material, and only the topics that are new compared with what they already know are assessed.

Observation: on 2026-11-23 an automated request to the example course page (https://learn.clickhouse.com/real-time-analytics-with-clickhouse) was refused with HTTP 403 by the site's CDN, so the page's structure and format could not be inspected. The user states that the course's lessons are text articles that anyone can open without an account.

## Success Criteria

Captured in Phase 3 from the user's answers.

### Primary

The full first-session flow above works end to end on a real course, and:

- The learner agrees with what the product hides. When they check the lessons and passages marked "already known", they agree with nearly all of them, and nothing they needed was hidden.
- The learner finishes noticeably faster. They get through the example course in clearly less time than going through it linearly.

### Secondary

- Not decided. The user answered "Not sure yet". See Open Questions.

### Guardrails

- Hidden content is never lost. Anything collapsed, summarized or skipped stays one step away in its original form, and a wrong "already known" mark is cheap to undo.
- The learner's knowledge stays private. No other learner can see their courses, their answers or their knowledge map.

## Timeline budget

- `mvp_weeks`: 6. The user's answer was "4 to 6 weeks" of after-hours work; the upper bound is recorded.
- `hard_deadline` and `after_hours_only`: asked in Phase 6.

## Timeline acknowledgment

Acknowledged on 2026-11-23: 6-week MVP requires sustained dedication; user accepted.

## User Stories

Draft assembled from the locked MVP flow, the success criteria and the requirements. Awaiting the user's confirmation.

### US-01: Learner gets a course adjusted to what they already know

- **Given** a signed-in learner who has loaded a course from its URL, marked the topics they believe they know, and answered the questions that double-check those claims
- **When** they open the adjusted path for that course
- **Then** they see the list of lessons, reordered if needed, with lessons they already know marked as skipped, and inside each lesson the passages on topics they already know are collapsed and labelled "already known"

#### Acceptance Criteria

- Every collapsed, summarized or skipped piece can be opened in its original form in one step.
- A long passage on a topic the learner already knows shows a short summary in place of the full text.
- When the learner checks what was marked "already known", they agree with nearly all of it, and nothing they needed was hidden.
- No other learner can see this learner's courses, answers or knowledge map.

## Functional Requirements

Drafted in Phase 4 from the locked MVP flow, the seed and the user's answers. Each line traces to something the user said. The challenge round is complete: every requirement carries the counter-arguments considered and the user's resolution. FR-013 and FR-014 were added during that round.

### Access

- FR-001: Learner can create an account and sign in. Priority: must-have
  > Socrates: Counter-arguments considered: "I'm the only user at first, so accounts
  > delay any learning value" and "open sign-up invites strangers whose courses cost
  > processing money". Resolution: none accepted; it stands as written.

### Loading materials

- FR-002: Learner can load a course by giving the URL of its web page. Priority: must-have
  > Socrates: Counter-arguments considered: "sites differ too much and some refuse
  > automated requests", "one URL is not one course" and "pasting text would prove it
  > sooner". Resolution, in the user's words: "User can shomehow manually download it
  > as a fallback if it does not work." Kept as written; the fallback became FR-013.
- FR-013: Learner can provide a course's content they downloaded themselves when loading from its URL does not work. Priority: nice-to-have
  > Socrates: Added during the challenge on FR-002. Counter-argument accepted: "a manual
  > route is a second loader to build and test, and v1 only needs the example course to
  > load". Resolution: kept, as nice-to-have.
- FR-012: Learner can load knowledge from epub, mobi, md and pdf files. Priority: nice-to-have
  > Socrates: Counter-arguments considered: "even as nice-to-have it invites designing
  > for file formats early, so make it a non-goal" and "books are not courses, so the
  > lesson-based path may not carry over". Resolution: none accepted; it stands as
  > nice-to-have.

### Course map

- FR-003: Learner can see a loaded course as a graph of its topics and how they relate. Priority: must-have
  > Socrates: Counter-arguments considered: "the graph can be wrong, and assessment and
  > the path inherit every error" and "a graph may be the wrong picture for hundreds of
  > topics; an outline could be more legible". Resolution: none accepted; it stands as
  > written.
- FR-004: Learner can navigate the course graph and open any topic in it. Priority: must-have
  > Socrates: Counter-arguments considered: "it is not on the critical path to the
  > adjusted path" and "it mainly serves the secondary moment, judging a course
  > upfront". Resolution: none accepted; it stands as written.

### Knowledge assessment

- FR-005: Learner can mark the topics they believe they already know. Priority: must-have
  > Socrates: Counter-argument accepted: "self-assessment is unreliable". Resolution:
  > kept as must-have because marking narrows the quiz. Questions are asked only about
  > what the learner claims to know.
- FR-006: Learner can answer questions that double-check the knowledge they claimed. Priority: must-have
  > Socrates: Counter-arguments considered: "bad questions are worse than none", "the
  > quiz can eat the time it saves" and "recognizing an answer is not knowing the
  > topic". Resolution: none accepted; it stands as written.
- FR-007: Learner can see how their current knowledge fits the course graph, one part of the course at a time. Priority: must-have
  > Socrates: Counter-argument raised by the user: "Huge topic can be hard to
  > visualize". Resolution: kept as must-have, and the requirement now says the learner
  > sees it one part of the course at a time instead of the whole graph at once.
- FR-011: Learner can add another material and be assessed only on the topics that are new compared with what they already know. Priority: must-have
  > Socrates: Counter-arguments considered: "one course is enough to prove v1",
  > "matching topics across materials is error-prone" and "knowledge fades, so old
  > knowledge needs re-checking". Resolution: none accepted; it stands as written.

### Adjusted path

- FR-008: Learner can get a learning path for a course adjusted to their current knowledge: a list of lessons, reordered if needed, with lessons they already know marked as skipped. Priority: must-have
  > Socrates: Counter-argument accepted: "whole lessons are rarely fully known, so
  > lesson-level skipping seldom triggers". Resolution: kept as written. The lesson list
  > frames the path, and passage-level collapsing (FR-009) does the fine-grained work.
- FR-009: Learner can read a lesson in which passages on topics they already know are collapsed into an expandable block labelled "already known". Priority: must-have
  > Socrates: Counter-argument accepted: "a passage on a known topic can still carry
  > new details". Resolution: kept as written. The guardrail that hidden content stays
  > one step from its original form makes a missed detail recoverable.
- FR-010: Learner can read a short summary in place of a long passage on a topic they already know. Priority: must-have
  > Socrates: Counter-arguments considered: "a generated summary can distort the
  > original" and "it overlaps with collapsing and could be folded into FR-009".
  > Resolution: none accepted; it stands as a separate must-have.
- FR-014: Learner can mark lessons as done and see how far along the adjusted path they are. Priority: nice-to-have
  > Socrates: Added by the user in the completeness check. Counter-argument accepted:
  > "it is bookkeeping, and neither primary success outcome depends on it". Resolution:
  > kept, as nice-to-have. The alternative "completed lessons count as known" was
  > offered and not chosen.

## Access Control

Captured in Phase 2 from the user's answers.

- **How the learner gets in:** Login with an account.
- **Who can have an account:** Anyone can sign up. The project author is the first user.
- **Roles:** One flat role. There is no admin and no role separation.
- **Data separation:** Every learner sees only their own courses and their own knowledge map.

## Open Questions

1. **Which sign-in methods does login offer?** The user chose "login" without picking a method (email and password, a third-party sign-in, or a passwordless link). Owner: user.
2. **What does a visitor who is not signed in see when they open a page that needs an account?** Not discussed. Owner: user.
3. **What are the secondary success outcomes?** The user answered "Not sure yet". Candidates that were offered and not picked: a second material reuses the learner's knowledge; the graph helps judge a course upfront; the graph shows where a missing prerequisite is covered. Owner: user.
4. **What are the measurable targets for the two primary outcomes?** "Nearly all" (agreement with what is hidden) and "noticeably faster" (time to finish) have no numbers yet. Owner: user.
5. **How does a learner undo a wrong "already known" mark?** The guardrail says a wrong mark must be cheap to undo. The capability "Learner can correct what the product thinks they know" was offered in the completeness check and not added, so no requirement provides it. Owner: user.
6. **Does finishing a lesson change what the product records as known?** Progress tracking (FR-014) was kept as nice-to-have bookkeeping, and the option that completed lessons count as known was not chosen. FR-011 assesses a new material only on topics that are new to the learner, so whether topics learned from an earlier course count as known is undecided. Owner: user.
7. **What form does manually downloaded course content take for FR-013?** The user said "somehow manually download"; a saved page, pasted text or a file are all possible. Owner: user. Low urgency, because FR-013 is nice-to-have.

## Forward: tech-stack

Informational only. Not part of the PRD schema; picked up by the tech-stack-selection step after `/10x-prd`.

Volunteered by the user on 2026-11-23:

> I've created before https://github.com/plancys/mvp-starter-deployable-on-edge-computing-crud-with-authorization which is hostable template with possibility to adopt it to new project needs. IT has implemented build and deployment pipeline so it can speed up new project creation.

> Also regarding technicalites I would like to utilize some well-know open-sources projects which covers similiar topics or similiar sub-problems which we have here.

What the template is (read from the repository on 2026-11-23; private GitHub template repo, last pushed 2026-11-13):

- Astro with React and Tailwind, TypeScript, deployed to Cloudflare Workers.
- Supabase for the database and auth: email and password sign-in, with OAuth login documented as an option.
- A protected sample resource (CRUD) meant to be removed or replaced per project.
- CI on GitHub Actions with a deploy job and a documented rollback, plus smoke-test and phone-check scripts.
- Its own adoption flow: create a new repository from the template, run `npm run adapt`, then paste `docs/adapt-prompt.md` into an agent.

Notes for the downstream step:

- The template's adoption flow starts from "Use this template" (a new repository). This repository already exists and was not created from it, so how the template gets applied here needs deciding at bootstrap time.
- The open-source preference is a build-vs-buy stance. Which sub-problems to reuse existing projects for is a tech-stack-selection question; whether "we do not build our own X" becomes a scope non-goal is revisited in Phase 6.
- The user expects summaries of known passages to be produced by a language model (their words: "summariezed by LLM"). The requirements state the capability only; the means is chosen downstream.

## Forward: technical-roadmap

Informational only. Not part of the PRD schema.

- The example source is open text in a browser (user's statement), but it refused a plain automated request with HTTP 403 on 2026-11-23. Loading a course from a URL has to work for sources that behave like this.
