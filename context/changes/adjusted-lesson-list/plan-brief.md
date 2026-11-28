# Adjusted Lesson List — Plan Brief

> Full plan: `context/changes/adjusted-lesson-list/plan.md`
> Research: `context/archive/2026-11-25-course-topic-graph/research.md` (the S-02 research, sections R.6 and F.6), and the S-03 plan `context/archive/2026-11-27-mark-known-topics/plan.md`

## What & Why

A learner gets the lesson list of a course adjusted to the topics they know (roadmap S-04, FR-008, US-01). This is the north star of milestone M-01: the first point where the product hides something because of what the learner knows. The main success criterion asks whether the learner agrees with what the product hides. So each skip shows its reason.

## Starting Point

S-03 stores the marks of a learner and gives each topic the state `unknown` or `claimed`. The course page lists the lessons in course order with their load state. No read gives the explained topics of each lesson or the prerequisite relations of a course.

## Desired End State

When a course has a topic map, the Lessons section of the course page shows the adjusted list. A lesson whose explained topics the learner all marked shows "Skipped" at its place, with the reason and the original link. A needed lesson moves up. A lesson that needs a topic that no lesson explains shows a gap note. Each topic links to the checklist, where one click changes the mark.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Skip rule | Skip a lesson when the learner knows every topic that it explains. A mention does not count. | It matches what the lesson teaches, so a lesson that explains an unknown topic stays in the path. | Plan (the S-04 part of Question 1) |
| No counted topic | Never skip. A note says "Could not load", "Not analysed yet" or "No topics found". | Nothing that the product did not check is hidden, as the guardrail asks. | Plan |
| Order | A later lesson that first explains a needed topic moves to the place right before the first lesson that needs it. Both topics must be unknown. | FR-008 asks for "reordered if needed", and the reason makes each move easy to check. | Plan |
| Gap note | When no lesson explains the needed topic, the lesson that needs it gets a note | The docs course never explains "MergeTree", and a note shows that gap better than a move for a mention. | Plan (correction) |
| Place | The Lessons section of the course page, when a map exists | The learner sees the path where they see the lessons today. | Plan (owner) |
| Skipped look | In place, with the label, the reason and the topics one click away | The learner checks each skip at its place in the course. | Plan |
| Undo | Each topic links to its lesson section on the checklist | No new write path, and the checklist has the toggles, "Clear all" and "Undo". | Plan |
| Known | `claimed` counts as known | The checks of S-06 come later. | Roadmap |
| Data | A new function `course_lesson_map` with map data only, joined with the events in code | Rule 6 holds, and one JSON value passes the row limit of 1,000. | Research R.6 |
| Storage | None. The page calculates the list on each load. | The rule is a pure function of the map and the events, with the name `path-1`. | Research F.6 |

## Scope

**In scope:**

- The function `course_lesson_map` and its pgTAP tests
- The pure module `src/lib/lesson-path.ts`: the skip rule, the order, the gap notes and the unit tests
- The adjusted list on the course page, smoke steps, the phone check, AGENTS.md and the roadmap records

**Out of scope:**

- A new page, mark controls on the course page, and a "show anyway" choice
- Thresholds, inference from parents or prerequisites, and a stored path
- The lesson reader and collapsed passages (S-05), questions (S-06) and summaries (S-09)
- A change to the PRD, to Linear or to the topic engine

## Architecture / Approach

The course page reads the map document and the events of the learner in its existing `Promise.all`, and it joins them in code.

```text
Course page load: lessons + topic_map_state + course_lesson_map (map only) + learner_course_events (events only)
                  --> knownLiveTopics() --> lessonPath() --> Lessons section (skips, moves, gap notes, reasons)
Topic link in a reason --> /dashboard/courses/<id>/known#lesson-<home position> --> one click on the checklist
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | `course_lesson_map`, its pgTAP tests and the types | The changed-lesson test must match `topic_map_state` |
| 2. Rule function | `lessonPath`, the reader and the unit tests | The walk must move the needed lesson up, not push the other lesson down |
| 3. Course page | The adjusted list, smoke steps, the phone check and AGENTS.md | The smoke regex, and the 44 px rule at 320 px in five looks |
| 4. Production and records | The roadmap records, the migration in production and a check on a real course | The deploy reaches production before the migration |

**Prerequisites:** S-03 is done. Local Supabase, the worker, the engine with the fake model and the fixture site run for the smoke test. The owner runs `npx supabase db push` and the merge.
**Estimated effort:** about 6 to 10 hours in 4 phases. This is an estimate. Research R.8 gave 5 to 15 hours, 8 likely, for the lesson rule and the list page with reasons.

## Open Risks & Assumptions

- The skip rule trusts the `explains` and `mentions` roles of the model. Lesson 15 of the docs course skips after 1 mark, although it mentions 9 more topics.
- A wrong prerequisite from the model moves a lesson or adds a gap note. The reason text is the only guard.
- No real course shows a move today. The unit tests cover the moves with fixtures.
- A wrong `sameAs` join of S-02 (finding F4) can give a topic a mark that the learner did not give, and so skip a lesson. The original link stays one step away.
- The course page gets two more reads in its `Promise.all`.

## Success Criteria (Summary)

- The owner marks the topics they know on the docs course and agrees with the skipped lessons.
- Each skipped lesson shows its reason, and its original lesson opens in one step.
- A wrong mark goes away in two steps: the topic link, then one click on the checklist.
