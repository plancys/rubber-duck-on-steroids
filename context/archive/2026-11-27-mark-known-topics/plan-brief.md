# Mark Known Topics — Plan Brief

> Full plan: `context/changes/mark-known-topics/plan.md`
> Research: `context/archive/2026-11-25-course-topic-graph/research.md` (the S-02 research, sections R.6 and F.6)

## What & Why

A learner marks the topics of a course that they believe they already know (roadmap S-03, FR-005). The marks are the first learner data of the product. S-04 uses them for the adjusted lesson list, S-05 for the collapsed passages, and S-06 asks questions only about marked topics. A course can have about 100 topics, so the marking must stay quick, and a wrong mark must be cheap to undo.

## Starting Point

S-02 stores the topic map of each course in 8 knowledge tables that a learner can only read. The map page shows a canvas, an outline and a topic panel with no control that changes data. No learner table exists.

## Desired End State

A learner opens "Mark the topics you know" from the course page or the map page. One click on a topic saves the mark "known" or removes it, and "Mark all", "Clear all" and "Undo" work for each lesson. The topic panel of the map has a "Known" control that saves the same mark. A reload shows the same marks, and no other learner can see them.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Levels | Two values: known or no mark | One click marks a topic, and the checks of S-06 add the depth later. | Plan (answers the S-03 unknown) |
| Place | A checklist page and a "Known" control in the topic panel | The list gives quick bulk marking, and the panel gives marking while the learner reads the map. | Plan |
| Saving | Each click saves at once, in both places | One route and one hook serve both places, and the learner loses nothing on leaving. | Plan |
| Parent mark | No effect on the children, and no effect on the parent | A general topic says nothing about its detailed topics, as "concurrency" and "happens before" show. | Plan (owner) |
| Merge | The mark follows the merge, and the newest mark wins | The learner keeps the claim, because S-02 joins two topics only for one concept. | Plan |
| Storage | The append-only table `learner_events` | An undo is one more event, and S-06 adds its answers to the same log. | Research R.6, F.6 |
| State | A pure function in app code gives `unknown` or `claimed` | Rule 6 of S-02 forbids SQL that joins the map with learner data. | Research R.6 |
| Reads | Two read functions that return JSON, joined in code | Rule 6 holds, and the API row limit of 1,000 does not cut the events. | Research / Plan |
| Course delete | The cascade removes the marks with the topics | A new load gives new topic ids, and the marks are private data. | Plan |
| Lesson actions | "Mark all", "Clear all" and "Undo" | Marking stays quick, and an undo stays cheap, as the PRD guardrail asks. | Plan |
| No script | A form post with a redirect, and the island uses `fetch` | This is the pattern of the app, and the smoke test posts forms. | Plan |
| Map idea | A note for S-06 and a parked change of the map prompt | It changes the topic engine of S-02, so it is outside S-03. | Plan |

## Scope

**In scope:**

- The table `learner_events`, its rules, the insert check and two read functions
- The state function, the marks route, the checklist page, the panel control and two links
- pgTAP tests, unit tests, smoke steps, the phone check and the roadmap records

**Out of scope:**

- Marks on the map canvas and the overlay (S-07), questions (S-06) and the lesson reader (S-05)
- Levels of knowledge, inference from a parent or a prerequisite, and marks across courses (S-10)
- A change to the topic engine or to the meaning of `part_of`

## Architecture / Approach

A click sends the ids of the changed topics to one route, and the route inserts one event for each topic. A page load makes two reads and joins them in code.

```text
Checklist page or topic panel --click--> POST /api/courses/[id]/marks --> learner_events (append-only)
Page load: course_topic_list (map only) + learner_course_events (events only) --> topicStates() in code
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Database | The event table, its rules, two read functions and the pgTAP tests | The insert check and the cascades act in another way under RLS |
| 2. State function and route | `topicStates`, the marks module, the route and its smoke steps | A merge chain or a loop gives a wrong state |
| 3. Checklist page and panel control | The page, the island, the hook, the panel control, the links and the phone check | About 100 toggles must pass the 44 px rule at 320 px in five looks |
| 4. Production and records | The roadmap records, the migration in production and a check on a real course | The deploy reaches production before the migration |

**Prerequisites:** S-02 is done. Local Supabase, the worker and the engine with the fake model run for the smoke test. The owner runs `npx supabase db push` and the merge.
**Estimated effort:** about 6 to 10 hours in 4 phases. This is an estimate. The research gave 3 to 9 hours for the table, the state function and the marks with undo. The panel control, the list function and the forms with no script add to it.

## Open Risks & Assumptions

- The mark follows a merge, and S-02 cannot undo a wrong join (finding F4). A wrong join can give a topic a mark that the learner did not give it. S-05 keeps that text one step away.
- Each click adds one event. At about 10,000 events in one course, the read needs a snapshot (phase B).
- With two open tabs, the newest write wins.
- "Undo" needs the script. With no script, the learner removes a mark with one click.
- `course_topic_list` repeats the text order and the parent rule of `topic_map_lesson`. A change to one needs the same change to the other.

## Success Criteria (Summary)

- The owner marks the known topics of the docs course with the checklist, and the marking is quick.
- A mark from the panel and a mark from the checklist show in both places after a reload.
- pgTAP and the smoke test prove that no other learner can read or write the marks.
