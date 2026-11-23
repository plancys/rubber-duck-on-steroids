---
project: "Rubber Duck on Steroids"
version: 1
status: draft
created: 2026-11-23
context_type: greenfield
product_type: "# TODO: product_type — see Open Questions"
target_scale: "# TODO: target_scale — see Open Questions"
timeline_budget:
  mvp_weeks: 6  # the user's answer was "4 to 6 weeks" of after-hours work; sustained-effort cost acknowledged on 2026-11-23
  hard_deadline: "# TODO: timeline_budget.hard_deadline — see Open Questions"
  after_hours_only: "# TODO: timeline_budget.after_hours_only — see Open Questions"
---

## Vision & Problem Statement

A working software engineer who picks up new technologies through online courses alongside the job gets course material that is not adjusted to what they already know, so they cannot skip the parts they already know. Nothing lets them lay their own knowledge over a course's content and see the difference. The pain is sharpest when starting a course in a half-known domain and having to wade through basics to reach the new material. It also shows up when judging a course upfront, because before committing time the learner cannot tell from the syllabus how much of it is new to them, and when hitting a gap mid-course, because a lesson assumes something the learner does not know and they cannot see where that prerequisite is covered. Today the learner goes through everything linearly and spends hours re-covering material they already know, or loses momentum in the known parts and drops the course before reaching the new parts. The pain is a missing capability, workflow friction and decision paralysis at once: the learner cannot decide what to skip, what to study next, or whether a course is worth starting.

The insight, in the user's words: "I belve there is a gap between well-organized human made courses with fixed, linear same-for-everyone path and learning using LLM which is very flexible but sometimes not so well-organised". Three beliefs support it. Course platforms only see their own course: they track progress inside their own content and do not know what the learner already knows coming in, so they cannot personalize. The structure is locked in linear pages: the concepts and their dependencies exist in the material, but only as a sequence of lessons, and nobody exposes them as a map the learner can navigate. Mapping was too costly by hand: adaptive learning used to need a hand-authored concept map per course, and deriving the map from the content itself is what has become feasible.

## User & Persona

**Primary persona:** the project author, as the single named user of v1.

- **Role:** A working software engineer learning new technologies.
- **Context:** Learns through online courses alongside the job. The example source named in the seed is the ClickHouse course "Real-time analytics with ClickHouse".
- **Moment they reach for the product:** When starting a course in a domain they partly know.

No secondary persona has been named.

## Success Criteria

### Primary

The full first-session flow works end to end on a real course:

1. The learner signs in.
2. The learner pastes the URL of a course page.
3. The learner sees the course as a graph of topics and moves around it.
4. The learner marks which topics they believe they know (self-assessment).
5. The learner answers questions that double-check those claims.
6. The learner sees their knowledge laid over the course graph.
7. The learner gets the adjusted path: a list of lessons, reordered if needed, with some marked as skipped.
8. The learner opens a lesson in which passages on topics they already know are collapsed or summarized and labelled "already known".

In later sessions the learner adds a second material, and only the topics that are new compared with what they already know are assessed.

With that flow working:

- The learner agrees with what the product hides. When they check the lessons and passages marked "already known", they agree with nearly all of them, and nothing they needed was hidden.
- The learner finishes noticeably faster. They get through the example course in clearly less time than going through it linearly.

# TODO: measurable targets for the two primary outcomes — see Open Questions

### Secondary

- Not decided. The user answered "Not sure yet".

# TODO: secondary success outcomes — see Open Questions

### Guardrails

- Hidden content is never lost. Anything collapsed, summarized or skipped stays one step away in its original form, and a wrong "already known" mark is cheap to undo.
- The learner's knowledge stays private. No other learner can see their courses, their answers or their knowledge map.

## User Stories

US-01 is a draft assembled from the first-session flow, the success criteria and the requirements. The user has not confirmed it.

### US-01: Learner gets a course adjusted to what they already know

- **Given** a signed-in learner who has loaded a course from its URL, marked the topics they believe they know, and answered the questions that double-check those claims
- **When** they open the adjusted path for that course
- **Then** they see the list of lessons, reordered if needed, with lessons they already know marked as skipped, and inside each lesson the passages on topics they already know are collapsed and labelled "already known"

#### Acceptance Criteria

- Every collapsed, summarized or skipped piece can be opened in its original form in one step.
- A long passage on a topic the learner already knows shows a short summary in place of the full text.
- When the learner checks what was marked "already known", they agree with nearly all of it, and nothing they needed was hidden.
- No other learner can see this learner's courses, answers or knowledge map.

# TODO: user confirmation of US-01 — see Open Questions

## Functional Requirements

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

## Non-Functional Requirements

# TODO: Non-Functional Requirements — see Open Questions

## Business Logic

# TODO: domain rule — see Open Questions

## Access Control

- **How the learner gets in:** Login with an account.
- **Who can have an account:** Anyone can sign up. The project author is the first user.
- **Roles:** One flat role. There is no admin and no role separation.
- **Data separation:** Every learner sees only their own courses and their own knowledge map.

# TODO: sign-in methods and what a signed-out visitor sees — see Open Questions

## Non-Goals

# TODO: Non-Goals — see Open Questions

## Open Questions

1. **What is the one-sentence business rule?** — TBD by user. Block: yes (PRD is hollow until resolved).
2. **What are the non-functional requirements?** None were captured; shaping stopped before they were asked. Owner: user.
3. **What is the first version explicitly not doing?** No non-goals were captured. The nice-to-have requirements FR-012, FR-013 and FR-014 sit outside the first version by their priority, and whether to list them as explicit non-goals is part of this question. So is whether "we do not build our own X" becomes a scope non-goal, which the user's preference for reusing existing open-source projects raised. Owner: user.
4. **What kind of product is this (`product_type`)?** Not captured. Owner: user.
5. **Roughly how many people will use it (`target_scale`)?** Not captured. Owner: user.
6. **Is there a hard deadline (`timeline_budget.hard_deadline`)?** Not captured. Owner: user.
7. **Is this after-hours work only (`timeline_budget.after_hours_only`)?** Not asked directly. The 6-week budget was stated in weeks of after-hours work. Owner: user.
8. **Is US-01 correct?** The story was assembled from the first-session flow, the success criteria and the requirements, and the user has not confirmed it. Owner: user.
9. **Which sign-in methods does login offer?** The user chose "login" without picking a method (email and password, a third-party sign-in, or a passwordless link). Owner: user.
10. **What does a visitor who is not signed in see when they open a page that needs an account?** Not discussed. Owner: user.
11. **What are the secondary success outcomes?** The user answered "Not sure yet". Candidates that were offered and not picked: a second material reuses the learner's knowledge; the graph helps judge a course upfront; the graph shows where a missing prerequisite is covered. Owner: user.
12. **What are the measurable targets for the two primary outcomes?** "Nearly all" (agreement with what is hidden) and "noticeably faster" (time to finish) have no numbers yet. Owner: user.
13. **How does a learner undo a wrong "already known" mark?** The guardrail says a wrong mark must be cheap to undo. The capability "Learner can correct what the product thinks they know" was offered in the completeness check and not added, so no requirement provides it. Owner: user.
14. **Does finishing a lesson change what the product records as known?** Progress tracking (FR-014) was kept as nice-to-have bookkeeping, and the option that completed lessons count as known was not chosen. FR-011 assesses a new material only on topics that are new to the learner, so whether topics learned from an earlier course count as known is undecided. Owner: user.
15. **What form does manually downloaded course content take for FR-013?** The user said "somehow manually download"; a saved page, pasted text or a file are all possible. Owner: user. Low urgency, because FR-013 is nice-to-have.
16. **Has the shaping quality cross-check been run?** No. Shaping stopped after its fourth phase, so business logic, non-functional requirements, product framing and non-goals were never asked, and the closing cross-check is still pending. Owner: user.
