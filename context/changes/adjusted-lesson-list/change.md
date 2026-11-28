---
change_id: adjusted-lesson-list
title: Adjusted lesson list
status: implementing
created: 2026-11-28
updated: 2026-11-28
archived_at: null
---

## Notes

Roadmap item S-04 of milestone M-01 (FR-008, US-01), the north star of the milestone. The learner gets a lesson list that fits the topics they know. The rule skips a lesson when the learner knows every topic that it explains. It also moves a needed lesson up. The Lessons section of the course page shows the list. The plan came from `/10x-plan adjusted-lesson-list` on 2026-11-28. It answers the S-04 part of Open Roadmap Question 1 (Linear RUB-5).

### Run without interaction (2026-11-28)

- The owner asked on 2026-11-28 to run all phases with `/10x-implement` and no interaction. The agent takes the recommended option of each question and runs the checks itself. The owner reviews the history afterwards.
- A subagent wrote the code of each phase. The parent agent ran the gates, the break checks and the commits.
- The branch `adjusted-lesson-list` starts from `origin/main` (`d8ef1fe`). It has no upstream, so a push needs an explicit target.

### Phase 1: course lesson map (2026-11-28)

- `npx supabase migration up` applied `20261128120000_create_course_lesson_map.sql` to the local database. No existing row changed.
- pgTAP: 7 files, 300 tests, with 10 in `course_lesson_map_test.sql`. Break check: inside a rolled-back transaction, a copy of the function that counts `mentions` links made test 6 fail.

### Phase 2: rule function (2026-11-28)

- Mismatch: the snippet of the plan moved lesson 3 before lesson 2 when the two lessons need each other. The approved rule says that such lessons keep the course order. The agent took "Adapt and continue" toward the approved rule. Inside a loop, the walk drops each need of an earlier lesson on a later lesson. Tarjan's algorithm finds the loops. Each move still has a real topic pair as its reason.
- Unit tests: 282, with 15 new. Break checks: a skip on one known topic made 2 tests fail, and a walk with no loop step made the loop test fail.
