<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Mark Known Topics

- **Plan**: context/changes/mark-known-topics/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 6 observations

Scope notes: phases 1 and 2 are done. Phase 3 has all its code rows done, and row 3.5 waits for the judgment of the owner. Phase 4 has row 4.1 (the roadmap records) done, and rows 4.2 to 4.4 are the production steps of the owner. Two review agents read the diff `4cc6827..HEAD`: one for plan drift, and one for safety, quality and patterns. The owner asked for a run with no interaction, so the agent took the recommended option of each finding.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Success criteria evidence

- Automated, run again on `83b8c5e`: pgTAP 285 of 285, `npm run db:types` gives no diff, unit tests 266 of 266, lint and `astro check` with 0 errors, and the build passes. The smoke test (98 of 98) and the phone check (all looks) ran on the same code at `e7fc7ef`.
- Plan drift: 0 DRIFT, 0 MISSING, no scope creep. The 10 adaptations of the implementers keep the intent of the plan. `KnownBox.tsx` is not in the plan, and it adds no behavior.
- Manual: rows 3.6 to 3.9 have browser evidence in `change.md`. Row 3.5 waits for the owner. Rows 4.3 and 4.4 are human steps.

## Findings

### F1 — No index on the cascade columns of learner_events

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261127230000_create_learner_events.sql:36-43
- **Detail**: The foreign keys `(topic_id, user_id)` and `user_id` have no index. A course delete runs `courses_delete_topics`, and each topic delete cascades to `learner_events` with a scan of the whole table. A user delete does the same. The topic map migration indexes each cascade column (`create_topic_map.sql:188-197`).
- **Fix**: Add a new migration with indexes on `(topic_id)` and `(user_id, created_at)`.
- **Decision**: FIXED — `supabase/migrations/20261128020000_fix_learner_events_review.sql` adds `learner_events_topic_idx` and `learner_events_user_created_idx`. 2 pgTAP tests (`has_index`).

### F2 — No limit on mark inserts

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/courses/[id]/marks.ts:62-66
- **Detail**: Anyone can sign up (`context/foundation/prd.md:173`). One account can insert 500 events in each request with no limit, and the table only grows. The plan skipped a quota because a mark costs no model call (`plan.md:51`). The notes sample has no quota either, but the other learner writes of the product have one (RD001, RD004, the token limit).
- **Fix A ⭐ Recommended**: A statement-level insert trigger refuses more than 2,000 events of one learner in one hour with RD005, and the route answers 429 `too_many_marks`.
  - Strength: It bounds one account to 48,000 rows a day, with no effect on real use. A course of 101 topics needs about 100 to 300 events in a session.
  - Tradeoff: One more trigger, one more error path, and new tests.
  - Confidence: HIGH — the same shape as RD001 and RD004.
  - Blind spot: It does not stop abuse with many accounts.
- **Fix B**: Accept, and record a follow-up for a later slice.
  - Strength: No new code before the review of the owner.
  - Tradeoff: One script can grow the table until the follow-up lands.
  - Confidence: MED — it depends on the size of the production database plan.
  - Blind spot: The size of the production database plan.
- **Decision**: FIXED via Fix A — a statement-level trigger in the same migration refuses more than 2000 events of one learner in one hour with RD005. `markErrorKey` maps RD005 to `too_many_marks`, and the route answers 429. 2 pgTAP tests (2000 passes, 2001 fails). Break check: without the trigger, the RD005 test failed.

### F3 — The lesson buttons lose the keyboard focus

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/topics/KnownTopicList.tsx:208-242
- **Detail**: "Mark all", "Clear all" and "Undo" use the native `disabled` while a write runs, so the focused button loses the focus to the page body. After "Mark all" the button stays disabled, and after "Undo" the button leaves the page. No live region tells the new count of the lesson.
- **Fix**: After a lesson action, move the focus to "Undo" (after "Mark all" or "Clear all"), to the lesson heading (after "Undo"), or back to the button (after a failure). Make the count of the lesson a polite live region.
  - Strength: A keyboard user keeps the place, and a screen reader hears the result.
  - Tradeoff: Focus code in one component.
  - Confidence: HIGH — the panel already moves the focus to its heading (`TopicPanel.tsx`).
  - Blind spot: No screen reader test, only a check of `document.activeElement`.
- **Decision**: FIXED — `KnownTopicList.tsx` moves the focus to "Undo" after "Mark all" or "Clear all", to the lesson heading after "Undo", and back to the button after a failure. The lesson count is a polite live region. A browser check proved both focus moves.

### F4 — Two rules have no direct test

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/learner_events_test.sql:186-192, src/lib/topics.test.ts
- **Detail**: pgTAP proves that a learner cannot set `user_id`, but not `created_at`. The newest event wins, so the order needs the server time. `topicParents` changed in phase 2 (the shared `stopParentLoops`), and no test calls it directly.
- **Fix**: Add a pgTAP test for `created_at` (42501) and a unit test for `topicParents` with a loop.
- **Decision**: FIXED — a pgTAP test refuses an insert with `created_at` (42501), and a unit test proves `topicParents` with a loop.

### F5 — No test proves the origin check of the marks route

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs
- **Detail**: A cross-site form post fails because Astro checks the origin of a form body (`checkOrigin` is true by default), and the route refuses every other body with 415. No step proves the 403, so a change of that default goes unseen.
- **Fix**: Add a smoke step that sends a form post with a foreign `Origin` and expects 403.
- **Decision**: FIXED — the smoke step "marks route refuses a form post from another site" expects 403, and it passed.

### F6 — The guide says that nobody can change an event

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: AGENTS.md:60, context/changes/mark-known-topics/plan.md:60
- **Detail**: The migration revokes the rights of `anon` and `authenticated` only. `service_role` keeps update, delete and truncate. The worker never writes this table, but the text is wrong.
- **Fix**: Write "a learner cannot change or delete a row" in `AGENTS.md`, and record the correction in the deviations of the plan.
- **Decision**: FIXED — `AGENTS.md` says that a learner cannot change or delete a row, and names the limit. The plan records the correction under "Deviations".

### F7 — The map page reads the full topic list for each lesson view

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/courses/[id]/map.astro:66-78
- **Detail**: `readTopicMarks` reads `course_topic_list` only for the merges, and passes the known ids of all lessons to the island. For 100 topics this is about 20 KB.
- **Fix**: Read only the merges, and filter the ids to the open lesson.
- **Decision**: SKIPPED — about 20 KB for a course of 100 topics. S-07 changes the reads of the map page.

### F8 — Three rare cases have no handling

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/courses/[id]/map.astro:77-78, src/components/topics/KnownTopicList.tsx:288-291, src/lib/marks.ts:12
- **Detail**: A failed read of the marks hides "Known" with no reason. A lost answer after a saved write leaves the old marks on the screen until a reload. "Mark all" on a lesson with more than 500 topics gets `invalid_marks`.
- **Fix**: Accept. Each case is rare, and a reload repairs the first two. The largest lesson of the local courses has fewer than 30 topics.
- **Decision**: ACCEPTED — each case is rare. A reload repairs the first two, and the largest local lesson has fewer than 30 topics.

### F9 — The merge walk can end outside the course

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/learner-state.ts:62-78
- **Detail**: `liveEnd` follows a merge chain to a topic that is not in the course, where `finalTarget` of the worker gives null. `readTopicMarks` keeps only the live topics of the course (`marks.ts:168-169`), so the page is right. S-04 to S-06 must keep that filter.
- **Fix**: Write the rule in the comment of `topicStates`.
- **Decision**: FIXED — the comment of `topicStates` says that a caller keeps only the live topics of the course.

## Triage summary

- Fixed: F1, F2 (Fix A), F3, F4, F5, F6, F9 (7)
- Skipped: F7 (1)
- Accepted: F8 (1)

After the fixes: pgTAP 290 of 290, unit tests 267 of 267, lint and `astro check` with 0 errors, the build, the phone check in all looks (179 checks), and the smoke test (99 steps) passed.
