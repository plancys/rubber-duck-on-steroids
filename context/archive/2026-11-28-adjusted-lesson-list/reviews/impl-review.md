<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Adjusted Lesson List

- **Plan**: context/changes/adjusted-lesson-list/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 1 warning, 8 observations

Phases 3 and 4 have open human rows (3.8, 4.2, 4.3 and 4.4). The review covers the work that the agent did in these phases: the code, the tests and the roadmap records. Two read-only agents checked the plan drift and the safety, quality and patterns. The parent agent ran the quick success criteria again on `f533273`: no pending migration, pgTAP with 7 files and 300 tests, no diff from `npm run db:types`, 282 unit tests, lint, astro check and the build. The phone check and the smoke test passed on `2b38209`, and phase 4 changed no code after it.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — A failed lesson path read blanks the course page

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/courses/[id].astro:97
- **Detail**: When `course_lesson_map` or `learner_course_events` fails, the page sets status 500 and skips all results. It then shows "This course has no lessons yet.", "This course has no topic map yet." and a build button, although the course has lessons and a map. The plan asks for this behavior ("as for the other reads"), but the adjusted list is an extra. Two more reads now can hide the main list.
- **Fix**: When the lesson path read fails, keep the other results, show the course order, and add a short notice above the list.
  - Strength: The core data of the page stays visible, and the learner still opens each lesson.
  - Tradeoff: The page answers 200 with a notice for this one failure, not 500 as for the other reads.
  - Confidence: HIGH — the course order mode already exists for a course with no map.
  - Blind spot: No automated test makes the read fail.
- **Decision**: FIXED. When the lesson path read fails, the page keeps the core results, shows the course order and the notice "The adjusted list did not load, so the list shows the course order.", and answers 200.

### F2 — Two statements of the plan disagree with the code

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/adjusted-lesson-list/plan.md:23, :185-193
- **Detail**: The snippet of the walk moves lesson 3 before lesson 2 when the two lessons need each other. The rule text and the loop test keep the course order, and the code follows the text with a loop step (`src/lib/lesson-path.ts:303-312`). Also, the plan says that the docs course gets two gap notes. It gets six, on lessons 1, 2, 3, 8 and 9, because the gap rule has no direction filter. The code follows the rule in both cases.
- **Fix**: Add a "Deviations" section to the plan that records the loop step and the real gap count.
- **Decision**: FIXED. The plan has a "Deviations" section with the loop step, the six gap notes, the smoke lesson 3 and the change of F1.

### F3 — The S-04 risk line of the roadmap is stale

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md:149
- **Detail**: The risk line still says "It cannot be planned before the domain rule exists." The plan of S-04 answers its part of the rule, and the S-04 records of phase 4 say so.
- **Fix**: Replace the last sentence of the risk line with a sentence that names the plan as the source of the S-04 rule.
- **Decision**: FIXED. The risk line now says that the plan answers the S-04 part of the domain rule.

### F4 — The rule for known topics exists in two copies

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/lesson-path.ts:382-386, src/lib/marks.ts:171-174
- **Detail**: `knownLiveTopics` repeats the rule of `readTopicMarks`: the states after the merges, then the live topics in the state `claimed`. S-06 changes this rule, and then the two copies can give different known topics for the checklist and for the lesson list.
- **Fix**: Add one helper to `src/lib/learner-state.ts`, and call it from both modules.
- **Decision**: FIXED. `knownLiveTopicIds` in `src/lib/learner-state.ts` holds the rule, `readTopicMarks` and `knownLiveTopics` call it, and a unit test covers it.

### F5 — The lesson map keeps a topic whose home lesson row is gone

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: supabase/migrations/20261128120000_create_course_lesson_map.sql:80-87
- **Detail**: `course_topic_list` joins `lessons` on the home lesson URL, so it drops a topic whose home lesson row is gone after a reload. `course_lesson_map` keeps that topic until the next map build. So the course page can show a topic that the checklist does not list, and the lesson that explains it cannot be skipped until the map build.
- **Fix A ⭐ Recommended**: Keep the topic, and state the reason in the header of the function.
  - Strength: The lesson that explains the topic stays in the path, which is the guardrail that nothing the learner needs stays hidden.
  - Tradeoff: Until the map build, the topic link opens the checklist, and the checklist does not show the topic.
  - Confidence: HIGH — the map page marks the course as stale in this state, and an update fixes it.
  - Blind spot: How often a reload removes a lesson URL on a real course.
- **Fix B**: Join `lessons` in the function, as `course_topic_list` does.
  - Strength: The checklist and the lesson list see the same live topics.
  - Tradeoff: The rule then drops the explains pairs of that topic, and the lesson can skip although it explains a topic that the learner cannot mark.
  - Confidence: MED — the case is rare, but its effect hides text.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A. The header of the function states why it keeps the topic.

### F6 — Three texts of the list are unclear for a screen reader

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/courses/[id].astro:343-355, :389-391, :400-407
- **Detail**: A screen reader reads "Skipped You know all 3 topics it explains." with no pause. The name of each lesson link holds only the title, so a learner who moves by links does not hear "Skipped". Each summary has the same name, "Topics of this lesson". A topic link reads like a toggle ("Ducks Not marked"), but it opens the checklist.
- **Fix**: Add a hidden period after "Skipped", point the lesson link at its state note with `aria-describedby`, add the lesson title to each summary as hidden text, and give each topic link a name that says it opens the checklist.
- **Decision**: FIXED. A browser check on the docs course found 16 lesson links with an `aria-describedby` target, the summary text "Topics of this lesson: Real-time analytics", and the topic link name "Real-time analytics, not marked. Change the mark on the checklist.".

### F7 — A gap note names its own lesson

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/courses/[id].astro (the function `gapText`)
- **Detail**: On lessons 1 and 3 of the docs course, the gap note ends with "Lesson 1 mentions it." or "Lesson 3 mentions it.", which is the lesson of the note.
- **Fix**: Write "This lesson mentions it." when the lesson that mentions the prerequisite is the lesson of the note.
- **Decision**: FIXED. Lessons 1 and 3 of the docs course now say "This lesson mentions it.", and lesson 2 still names lesson 3.

### F8 — The phone check does not prove that a skipped lesson shows

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: scripts/phone-check.mjs:331-350
- **Detail**: The new step checks only that the save of "Mark all" answers 200. `AGENTS.md` says that the check measures the course page with a skipped lesson, but no step checks that the page shows one.
- **Fix**: After the click, count the items with `data-path-state="skipped"` on the course page, and report SKIP when the count is 0.
- **Decision**: FIXED. The phone check after the fixes logged "PASS [warm] mark all @375", so the course page showed a skipped lesson.

### F9 — Each course page load makes two more reads

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/courses/[id].astro:95, src/lib/lesson-path.ts:397-401
- **Detail**: The page reads the lesson map and the events on each load, also for a course with no map. The reads run in parallel with the other reads, so the delay stays small. The cost grows with the size of the course and of the event log.
- **Fix**: None for the MVP. Group the topic ids by lesson in the document if a large course gets slow.
- **Decision**: ACCEPTED. The cost stays for the MVP.

## Triage summary

- Fixed: F1, F2, F3, F4, F5 (Fix A), F6, F7, F8 (8)
- Accepted: F9 (1)
- Gates after the fixes: 283 unit tests, lint, astro check, the build, pgTAP with 7 files and 300 tests, `LOOKS=all npm run phone-check` with 180 page checks, and the smoke test with 91 steps. The first smoke run after the fixes failed one sign-in step with 429, because a browser check used the sign-in limit just before it. The run after the 60-second window passed.
