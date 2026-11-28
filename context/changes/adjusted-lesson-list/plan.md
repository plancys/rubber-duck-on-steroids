# Adjusted Lesson List Implementation Plan

## Overview

A learner gets the lesson list of a course adjusted to the topics they know (roadmap S-04, FR-008, US-01). This is the north star of milestone M-01. When the course has a topic map, the Lessons section of the course page shows the adjusted list. The rule skips a lesson when the learner knows every topic that the lesson explains. A later lesson that first explains a needed topic moves up, to the place right before the first lesson that needs it. When no lesson explains a needed topic, the lesson that needs it gets a gap note. Each skip, each move and each gap shows its reason. Each topic in a reason links to the checklist, where one click changes the mark.

This plan also answers the S-04 part of Open Roadmap Question 1 (Linear RUB-5): when a lesson counts as known, and when the order changes.

## Current State Analysis

- The course page reads the lessons of a course in course order, at most 500, in one `Promise.all` with the jobs and `topic_map_state` (`src/pages/dashboard/courses/[id].astro:56-83`). The Lessons section shows one `<li data-testid="lesson-item" data-status>` for each lesson, with the position, a link to the original lesson in a new tab, and "Could not load" for a failed lesson (`:264-300`).
- `topicMapStatus` gives `none`, `current`, `stale` or `partial` from the row of `topic_map_state` (`src/lib/topics.ts:60-65`). `none` means that the course has no map.
- A smoke regex reads `data-testid="lesson-item" data-status="…"` and the first `href` of each item (`scripts/smoke.mjs:335`, `:386-389`). The step "course has 2 loaded lessons and 1 failed lesson in order" uses it (`:732`). This step runs after `topicMapSteps` (`:730`), so the map exists when it runs.
- A lesson row has `position`, `title`, `url`, `status` (`loaded` or `failed`), `error` and `content_hash` (`supabase/migrations/20261124200800_create_courses.sql:34-54`, `supabase/migrations/20261127120000_create_topic_map.sql:22`).
- A topic link has the role `explains` or `mentions` (`create_topic_map.sql:104-125`). A passage holds the `lesson_url` of its lesson (`:28-50`). A link counts only while its `passage_hash` equals the `content_hash` of its passage (`supabase/migrations/20261127230000_create_learner_events.sql:123-131`).
- The home lesson of a topic is the first lesson that explains it, else the first lesson that mentions it (`worker/topics/build.ts:169-179`). The column is `course_topics.home_lesson_url` (`create_topic_map.sql:89-100`).
- `topic_relations.kind` is `prerequisite` or `part_of`. For a prerequisite, the learner must know `from_topic_id` before `to_topic_id` (`create_topic_map.sql:125-130`, `engine/rubber_duck_engine/prompt.py:38-39`). The worker removes prerequisite cycles (`worker/topics/build.ts:334-386`). The database does not check them.
- `lesson_analyses` holds `status` (`analysed` or `failed`), `content_hash` and `analysed_at` for each lesson (`create_topic_map.sql:151-174`). `topic_map_state` counts a loaded lesson as changed when it has no analysis, another content hash, or an analysis newer than the map (`supabase/migrations/20261127200000_fix_topic_map_review.sql:53-104`).
- `course_topic_list` gives home topics only, and only the lessons that are the home lesson of a live topic (`create_learner_events.sql:100-179`). `topic_map_lesson` gives the relations of one lesson (`fix_topic_map_review.sql:133-250`). No read gives the explained topics of each lesson or all prerequisite relations of a course.
- `topicStates` gives `unknown` or `claimed` for each topic from the events, and it follows the merges (`src/lib/learner-state.ts:89-108`). `readTopicMarks` reads the topic list and the events in parallel, and it keeps only the live topics (`src/lib/marks.ts:162-176`).
- The checklist page has one section `id="lesson-<position>"` for each home lesson (`src/components/topics/KnownTopicList.tsx:209`). No lesson reader exists. The original URL is the only way to open the text of a lesson.
- The fake model gives each topic an `explains` link, and one prerequisite between two topics of the same lesson (`scripts/fake-model.mjs:8-9`, `:55`, `:58-77`). So the smoke course gets no move and no gap note.
- The local docs course "Get started with ClickHouse" has 16 lessons and 101 topics. Each lesson explains 1 to 20 topics. Lesson 3 explains 18 topics, and 15 of them have their home in another lesson. Lesson 15 has 7 home topics and explains 1. Lesson 16 has no home topic. Of 18 prerequisite relations, 2 point backward: "Table parts" (lesson 2) needs "MergeTree" (lesson 3), and "ClickHouse CLI" (lesson 9) needs "Native TCP endpoint" (lesson 14). No lesson explains "MergeTree" or "Native TCP endpoint". Lessons 3 and 14 only mention them. So the rule gives no move in this course, and two gap notes.

## Desired End State

A signed-in learner opens a course with a topic map. The Lessons section shows each lesson once, in the adjusted order. Each lesson keeps its course number and its link to the original lesson. A lesson whose explained topics the learner marked shows "Skipped" at its place, with the reason "You know all N topics it explains". A lesson that moved up names the topics that a lesson before it needs. A lesson that needs a topic that no lesson explains shows a gap note. A lesson that did not load, has no current analysis, or explains no topic is not skipped, and a note says why. The topics of each lesson are one click away, and each topic links to its lesson section on the checklist. A course with no map shows the course order, as before.

Verification: the pgTAP tests, the unit tests, the smoke steps, the phone check, and a check by the owner on the docs course.

### Key Discoveries:

- Rule 6 of the S-02 research: no database view or function joins the map with learner data (`context/archive/2026-11-25-course-topic-graph/research.md:1160`). The new read function returns map data only, and the page joins it with the events in code.
- A function that returns one `jsonb` value passes the API row limit of 1,000 (`supabase/config.toml:18`, `create_learner_events.sql:96-98`).
- The PRD accepts that a whole lesson is rarely fully known. Passage-level collapsing (FR-009, S-05) does the detailed work (`context/foundation/prd.md:144-147`). So a strict skip rule fits the PRD.
- Principle 8 of the S-02 research: the learner state is a pure function with a named policy version (`research.md:605`). `LEARNER_STATE_POLICY = "marks-1"` is the pattern (`src/lib/learner-state.ts:23`).
- The web app imports a sibling module with a relative path and the `.ts` extension, so `node --test` can run it (`src/lib/marks.ts:6-7`).

## What We're NOT Doing

- No new page. The owner chose the Lessons section of the course page for the adjusted list.
- No mark control on the course page, no "show anyway" choice, and no lesson event. A change of a mark goes through the checklist.
- No threshold. One unknown explained topic keeps a lesson in the path. A topic that a lesson only mentions does not count.
- No inference. A mark on a parent, a child or a prerequisite does not make another topic known, as in S-03.
- No lesson reader, no collapsed passages and no summaries (S-05, S-09). No questions, and no states `confirmed` or `refuted` (S-06 decides how they count).
- No change to the topic engine, the prompt, the relations or the home lesson rule. No check of the quality of a prerequisite.
- No stored path. The page calculates the list on each load.
- No marks for done lessons and no progress on the path (FR-014, parked).
- No numbers for "nearly all" and "noticeably faster" (Open Roadmap Question 12).
- No change to the PRD and no change in Linear. Question 1 stays open for S-05 and S-06, and the roadmap holds the S-04 part.
- No path across courses (S-10).

## Implementation Approach

The database comes first, then the pure rule function, then the course page, then production.

`course_lesson_map(course_id)` returns one JSON document with map data only: the analysis state of each loaded lesson, the live topics with their home lesson, the explained topics of each lesson, the prerequisite relations, and the merged topics. The course page reads it and `learner_course_events` in its existing `Promise.all`. `lessonPath()` in `src/lib/lesson-path.ts` takes the lessons, the map and the known topics, and gives the adjusted list. The rule has the name `LESSON_PATH_POLICY = "path-1"`. `claimed` counts as known. S-06 decides how `confirmed` and `refuted` count.

The rule, as the owner decided it:

- **Skip.** A lesson is skipped when it explains at least one live topic, and the learner knows every live topic that it explains. The home lesson of the topic does not matter. A topic that the lesson only mentions does not count.
- **No counted topic.** A lesson is never skipped in three cases. It did not load (`not_loaded`, note "Could not load"). Its analysis is missing, failed, older than its text or newer than the map (`not_analysed`, note "Not analysed yet"). It explains no live topic (`no_topics`, note "No topics found").
- **First explainer.** The first explainer of a topic is the first lesson in course order that explains it.
- **Need.** A lesson A needs a lesson B when a prerequisite relation goes from a topic p to a topic t, and the learner knows neither topic. A is the first explainer of t, B is the first explainer of p, and B is not A.
- **Gap.** A lesson A gets a gap note when a prerequisite relation goes from a topic p to a topic t, and the learner knows neither topic. A is the first explainer of t, and no lesson explains p. The note names t, p, and the home lesson of p when that lesson is in the list. For example: "Table parts needs MergeTree. No lesson explains it. Lesson 3 mentions it."
- **Order.** The list walks the lessons in course order. Before it places a lesson, it places each unplaced lesson that this lesson needs, in course order, with their own needs first. A lesson that is still on the walk is not placed again, so two lessons that need each other keep the course order. With no backward need, the list is the course order. A mark on t or p removes the need, and also the gap note.
- **Moved up.** A lesson is moved up when a lesson that comes before it in course order comes after it in the list. Its reason names the lesson whose walk placed it, and each pair of topics t and p between the two lessons.

A skipped lesson never takes part in a move or a gap note. It explains only known topics, so it has no need and no gap, and no lesson needs it.

## Critical Implementation Details

**Markup contract.** The smoke regex at `scripts/smoke.mjs:335` reads `data-testid="lesson-item" data-status="…"` as the first two attributes of an item, and the first `href` after them. Each list item keeps these two attributes first, in both modes. The link to the original lesson stays the first link of the item.

**Order walk.** Suppose that lesson 9 needs lesson 14. A queue sort that always takes the free lesson with the lowest course position pushes lesson 9 down after lesson 14. The owner decided that lesson 14 moves up to the place right before lesson 9. So the walk places the needs of a lesson first, as the snippet in Phase 2 shows.

**Every lesson once.** `lessonPath` gives each input lesson exactly once. This is the guardrail that hidden content is never lost. A unit test checks it on each fixture.

## Phase 1: Database

### Overview

Add the read function for the lesson map, and prove each part of its document with pgTAP.

### Changes Required:

#### 1. The read function

**File**: `supabase/migrations/<timestamp>_create_course_lesson_map.sql`

**Intent**: Give the course page all map data that the lesson rule needs in one read, with no learner data.

**Contract**: `course_lesson_map(course_id uuid) returns jsonb`, `language sql stable`, `set search_path = ''`, not security definer. Revoke execute from `public`, `anon` and `service_role`, and grant it to `authenticated`. It returns null when the caller cannot see the course. Else it returns:

```json
{
  "analyses": [{ "lesson_url": "…", "state": "current" }],
  "topics": [{ "id": "…", "name": "…", "home_lesson_url": "…" }],
  "explains": [{ "lesson_url": "…", "topic_id": "…" }],
  "prerequisites": [{ "from_topic_id": "…", "to_topic_id": "…" }],
  "merged": [{ "id": "…", "merged_into": "…" }]
}
```

- `analyses`: one item for each loaded lesson with a `lesson_analyses` row. `state` is `failed` for a failed analysis. It is `changed` when the content hash of the analysis differs from the content hash of the lesson, or when `analysed_at` is later than `course_maps.built_at`. Else it is `current`. This is the test of `topic_map_state`. A loaded lesson with no row has no item.
- `topics`: each live topic of the course (`merged_into is null` and `retired_at is null`) with a home lesson.
- `explains`: each distinct pair of a lesson URL and a live topic of the course, with an `explains` link from a passage of that lesson. The `passage_hash` of the link must equal the `content_hash` of the passage.
- `prerequisites`: each distinct `prerequisite` relation with a source passage in the course and two live topics of the course as its ends.
- `merged`: each topic of the course with `merged_into` set, as in `course_topic_list`.
- The header states rule 6: the function reads no learner table, and no function joins the map with the events.

#### 2. pgTAP tests

**File**: `supabase/tests/course_lesson_map_test.sql`

**Intent**: Prove the access rule, each part of the document, and rule 6.

**Contract**: The setup follows `supabase/tests/learner_events_test.sql`: two learners and one course. The course has a loaded and a failed lesson, passages, live, merged and retired topics, `explains` and `mentions` links, and one link with an old `passage_hash`. It also has `prerequisite` and `part_of` relations, a `course_maps` row, and analyses that are current, changed by hash and failed, plus one loaded lesson with no analysis. The tests:

- `anon` cannot execute the function (42501).
- The second learner gets null.
- `analyses` gives `current`, `changed` and `failed`, and no item for the lesson with no analysis or for the failed lesson.
- `topics` gives the live topics only.
- `explains` gives the `explains` links only. It drops a `mentions` link, a link with an old passage hash, and the links of merged and retired topics.
- `prerequisites` gives the `prerequisite` relations only, and it drops a relation with a merged end.
- `merged` gives the merged pair.
- `pg_get_functiondef` of the function does not contain `learner_events`, so rule 6 holds.

#### 3. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Give the web app the type of the new function.

**Contract**: `npm run db:types` writes the file. Nobody edits it by hand.

### Success Criteria:

#### Automated Verification:

- The migration applies to the local database: `npx supabase migration up`
- The pgTAP tests pass, the new file included: `npx supabase test db`
- `npm run db:types` adds `course_lesson_map` to `src/db/database.types.ts`
- Lint and types pass: `npm run lint` and `npx astro check`

**Implementation Note**: This phase has no manual check. Go to the next phase when the automated checks pass.

---

## Phase 2: Rule function

### Overview

Add the pure module that gives the adjusted list, with its parser, its reader and its unit tests.

### Changes Required:

#### 1. The lesson path module

**File**: `src/lib/lesson-path.ts`, `src/lib/lesson-path.test.ts`

**Intent**: Give the adjusted lesson list as a pure function of the lessons, the lesson map and the known topics. Give the page one reader for the map and the events.

**Contract**:

- `LESSON_PATH_POLICY = "path-1"` names the rule.
- `LessonAnalysisState = "current" | "changed" | "failed"`. `CourseLessonMap = { analyses: Map<string, LessonAnalysisState>, topics: { id, name, homeLessonUrl }[], explains: { lessonUrl, topicId }[], prerequisites: { fromTopicId, toTopicId }[], merged: MergedTopic[] }`. `MergedTopic` is the type of `src/lib/topics.ts`.
- `parseCourseLessonMap(data: unknown): CourseLessonMap | null` reads the JSON of `course_lesson_map`. It gives null for a value that is not an object, and it drops a malformed item.
- `PathLessonInput = { url, position, title, status, error }` is the lesson row of the course page. A status other than `loaded` gives `not_loaded`.
- `PathState = "open" | "skipped" | "not_loaded" | "not_analysed" | "no_topics"`.
- `PathTopic = { id, name, known, homePosition }`. `homePosition` is the course position of the home lesson, or null when that lesson is not in the input.
- `PathMove = { position, title, pairs: { topic, prerequisite }[] }`. `position` and `title` belong to the lesson whose walk placed the moved lesson. The pairs hold topic names.
- `PathGap = { topic, prerequisite, mentionPosition }`. The names are topic names. `mentionPosition` is the course position of the home lesson of the prerequisite, or null when that lesson is not in the input.
- `PathLesson = PathLessonInput & { state: PathState, topics: PathTopic[], knownCount: number, movedUp: PathMove | null, gaps: PathGap[] }`. `topics` holds the explained live topics of the lesson, sorted by name, then by id.
- `lessonPath(lessons, map, known: ReadonlySet<string>): PathLesson[]` applies the rule of the Implementation Approach. It ignores an explains pair, a topic or a relation that names a lesson URL or a topic id outside the input.
- `pathCounts(path)` gives `{ skipped, moved, total }` for the summary line of the page.
- `knownLiveTopics(events: readonly LearnerEvent[], map): Set<string>` calls `topicStates` with the merges of the map. It keeps the live topics of the map in the state `claimed`, as `readTopicMarks` does.
- `readLessonPath(supabase, courseId)` calls `course_lesson_map` and `learner_course_events` in parallel. It gives `{ error: true }` when a read fails. Else it gives `{ map, known }`, where `map` is null when the learner cannot see the course. It uses the client type of `src/lib/marks.ts`.
- Runtime imports of sibling modules use a relative path with the `.ts` extension.

The walk of the order. The snippet shows the order of the calls, because a queue sort gives another result:

```ts
// needsOf(url) gives the lessons that the lesson needs, in course order.
function place(url: string): void {
  if (placed.has(url) || walking.has(url)) return; // a lesson on the walk keeps the course order
  walking.add(url);
  for (const need of needsOf(url)) place(need);
  walking.delete(url);
  placed.add(url);
  order.push(url);
}
for (const lesson of lessonsInCourseOrder) place(lesson.url);
```

Tests:

- A lesson is skipped when the learner knows every topic that it explains. One unknown explained topic keeps it `open`. A topic of another home lesson that it explains counts. A mentioned topic is not in the map, so it does not count.
- A failed lesson gives `not_loaded`. A lesson with no analysis, or with a `failed` or `changed` analysis, gives `not_analysed`, also when the learner knows all its old topics. A current lesson with no explained topic gives `no_topics`.
- No marks and no backward need give the course order.
- Two backward needs with no marks, in 16 lessons: lesson 2 needs lesson 3, and lesson 9 needs lesson 14. The order is 1, 3, 2, 4, 5, 6, 7, 8, 14, 9, 10, 11, 12, 13, 15, 16. Lessons 3 and 14 have `movedUp` with their pair. Lessons 2 and 9 have none.
- A mark on t removes the move. A mark on p removes the move.
- The docs case: "Table parts" (lesson 2) needs "MergeTree", which no lesson explains and lesson 3 mentions. Lesson 2 gets a gap note with `mentionPosition` 3, and the list keeps the course order. A mark on either topic removes the note.
- A chain: lesson 2 needs lesson 4, and lesson 4 needs lesson 3. The order is 1, 3, 4, 2, 5.
- A loop: two lessons that need each other keep the course order, and the walk ends.
- A prerequisite that an earlier lesson or the same lesson explains first gives no move and no gap note.
- Each fixture gives each input lesson exactly once.
- `knownLiveTopics`: a mark on a merged topic counts for its target, and an unmark after a mark gives no known topic.
- `parseCourseLessonMap`: a malformed item drops, and a value that is not an object gives null.

### Success Criteria:

#### Automated Verification:

- The unit tests pass, the new tests included: `npm run test:unit`
- Lint and types pass: `npm run lint` and `npx astro check`

**Implementation Note**: This phase has no manual check. Go to the next phase when the automated checks pass.

---

## Phase 3: Course page

### Overview

Show the adjusted list in the Lessons section of the course page. Prove it with smoke steps and the phone check, and update the agent guide.

### Changes Required:

#### 1. The course page

**File**: `src/pages/dashboard/courses/[id].astro`

**Intent**: Show the adjusted lesson list when the course has a map, and the course order as before when it has none.

**Contract**:

- `readLessonPath(supabase, id)` joins the `Promise.all` at `:56-83`. A read error gives status 500 and `courseErrorText("unknown")`, as for the other reads.
- The adjusted mode needs `mapStatus !== "none"` and a map from `readLessonPath`. Else the section shows the lessons in course order, as today.
- The heading stays "Lessons". In the adjusted mode, a line `data-testid="lesson-path-summary"` sits above the list: "Adjusted to the topics you know: S of N lessons skipped, M moved up." With no known topic, the line says "Mark the topics you know to skip lessons." and links to the checklist.
- The list is `<ol data-testid="lesson-path">` in the adjusted mode.
- Each item is `<li data-testid="lesson-item" data-status="<load status>" data-position="<course position>" data-path-state="<state>" data-moved="<true or false>">`. It shows the course position, then the link to the original lesson, then the text of its state:
  - `skipped`: the label "Skipped" (`data-testid="lesson-skipped"`) and "You know all N topics it explains."
  - `open`: "You know K of N topics it explains."
  - `not_loaded`: "Could not load: <error>", with the test id `lesson-failed` of today.
  - `not_analysed`: "Not analysed yet. The list does not skip it." (`data-testid="lesson-not-analysed"`).
  - `no_topics`: "No topics found. The list does not skip it." (`data-testid="lesson-no-topics"`).
- A moved lesson adds a line (`data-testid="lesson-moved"`) in this form: `Moved up: "<topic>" in lesson <N> needs "<prerequisite>", which this lesson explains.`
- A lesson with gaps adds one line for each gap (`data-testid="lesson-gap"`), for example: `"Table parts" needs "MergeTree". No lesson explains it. Lesson 3 mentions it.`
- A lesson with explained topics adds `<details data-testid="lesson-topics">` with the summary "Topics of this lesson". Each topic is a link to `knownTopicsPath(courseId, homePosition)` with `data-topic-id` and `data-known`, and a text "Known" or "Not marked".
- Each link and each summary has `min-h-11 min-w-11`. A long topic name wraps at 320 px.
- The page is static markup with no island, so the list works with no script. The "Topic map" section and its links stay as they are.

#### 2. The checklist path with a lesson anchor

**File**: `src/lib/topics.ts`, `src/lib/topics.test.ts`

**Intent**: Link a topic of the list to its lesson section on the checklist.

**Contract**: `knownTopicsPath(courseId, position?)` gives `/dashboard/courses/<id>/known#lesson-<position>` with a position, and the path of today with no position. A test covers both forms.

#### 3. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove the adjusted list against the running app.

**Contract**: New steps in `topicMapSteps`, after the checklist steps (`:590-627`):

- "course page shows the lesson path": 200, with `data-testid="lesson-path"` and `data-path-state="open"` on the item of lesson 1.
- "marks on the topics of lesson 1 skip it": the step reads the `data-topic-id` values in the item of lesson 1. It marks them with one script request to the marks route. Then the course page shows `data-path-state="skipped"` on the item of lesson 1.
- "unmarks bring lesson 1 back": one script request with `unmark` for the same ids. Then the course page shows `data-path-state="open"` on the item of lesson 1.
- The step "course has 2 loaded lessons and 1 failed lesson in order" (`:732`) passes with no change. The fake model explains each topic and gives no backward need.
- The step for the second learner keeps `bodyExcludes: 'data-testid="lesson-item"'` (`:782`).

#### 4. The phone check

**File**: `scripts/phone-check.mjs`

**Intent**: Check the phone rules on the adjusted list with a skipped lesson, in each look.

**Contract**: After `loadCourse` (`:302-325`) and before the first check of the course page (`:380`), the first pass opens the checklist page. It clicks "Mark all" in the first lesson section and waits for the save. So the course page shows a skipped lesson in each look. With no map, or with no "Mark all" button, the check reports SKIP for this step and checks the page anyway.

#### 5. The agent guide

**File**: `AGENTS.md`

**Intent**: Keep the guide true for the next agent.

**Contract**: The "Project structure" section gets a "Lesson path" entry after "Marks" (`:60`). It names `course_lesson_map`, `src/lib/lesson-path.ts`, the Lessons section of the course page, the rule in one sentence, and the policy name `path-1`. The "Testing" section adds the lesson path steps to the topic steps (`:82`), and the "Mark all" click to the phone check (`:83`).

### Success Criteria:

#### Automated Verification:

- The unit tests pass: `npm run test:unit`
- Lint, types and the build pass: `npm run lint`, `npx astro check` and `npm run build`
- The phone check passes with the adjusted list in all five looks: `LOOKS=all npm run phone-check`
- The smoke test passes with the lesson path steps: `SMOKE_COURSES=1 SMOKE_TOPICS=1 npm run smoke`

#### Manual Verification:

- On the local docs course, a lesson whose explained topics are all marked shows "Skipped" at its place with the reason, and its link opens the original lesson
- A topic link of a skipped lesson opens its lesson section on the checklist, one click removes the mark, and a reload of the course page shows the lesson as not skipped
- With "MergeTree" and "Table parts" not marked, lesson 2 shows the gap note that names lesson 3, the list keeps the course order, and a mark on either topic removes the note after a reload
- The owner marks the topics that they know on the docs course, and agrees with the skipped lessons

**Implementation Note**: After this phase and its automated checks, pause for the confirmation of the human before the next phase.

---

## Phase 4: Production and records

### Overview

Record the S-04 part of the domain rule in the roadmap, put the function in production, merge the change, and check it on a real course.

### Changes Required:

#### 1. The roadmap records

**File**: `context/foundation/roadmap.md`

**Intent**: Keep the decisions of this plan in view after the change goes to the archive.

**Contract**:

- S-04, "Unknowns", first item: change "Block: yes" to "Block: no", and add "Answered for S-04" with the rule. A lesson is skipped when the learner knows every topic that it explains. A lesson with no current analysis or no explained topic is never skipped. A later lesson that first explains a needed topic moves to the place right before the first lesson that needs it, when the learner knows neither topic. When no lesson explains the needed topic, the lesson that needs it gets a gap note. The plan of S-04 (`adjusted-lesson-list`) records the rule.
- Open Roadmap Question 1: add "S-04 answers its part", with the same rule in short. The parts of S-05 (which passages count as known) and S-06 (what a wrong answer does) stay open. Change "Block: S-04, S-05, S-06" to "Block: S-05, S-06".
- "Backlog Handoff", the row of S-04: the note says that the plan of S-04 answers its part of Question 1.

#### 2. The production database

**File**: `supabase/migrations/<timestamp>_create_course_lesson_map.sql`

**Intent**: Apply the new function to production before the deploy that uses it.

**Contract**: The owner runs `npx supabase db push` before the merge to `main`, as for S-03 (`context/archive/2026-11-27-mark-known-topics/change.md:70`). The CI deploy of `main` then deploys the page.

### Success Criteria:

#### Automated Verification:

- The roadmap holds the S-04 records: `grep -c "Answered for S-04\|S-04 answers its part" context/foundation/roadmap.md` gives at least 2
- The CI run on `main` after the merge passes, the `deploy` job included: `gh run list --branch main --limit 1`

#### Manual Verification:

- The owner applies the migration to production with `npx supabase db push`, then merges the pull request
- In production, the owner opens a real course with marks, and the Lessons section shows the adjusted list with the skips of those marks

**Implementation Note**: The production steps are human actions. An agent does not run `npx supabase db push`, does not merge to `main`, and does not deploy.

---

## Testing Strategy

### Unit Tests:

- `lessonPath`: the skip rule, the three states with no counted topic, the order with moves, a chain and a loop, the gap note, a mark that removes a move or a note, and each lesson once.
- `parseCourseLessonMap`, and `knownLiveTopics` with a merged topic.
- `knownTopicsPath` with and without a lesson position.

### Integration Tests:

- pgTAP: the access rule, each part of `course_lesson_map`, and rule 6.
- Smoke: the adjusted mode, a skip after marks, the return after unmarks, the order step, and the second learner.
- Phone check: the course page with a skipped lesson at 320 and 375 px in five looks.

### Manual Testing Steps:

1. Open the local docs course with no marks. Find the course order, and the gap notes on lesson 2 ("MergeTree", lesson 3) and lesson 9 ("Native TCP endpoint", lesson 14).
2. On the checklist, click "Mark all" in the section of lesson 6. Reload the course page, and find lesson 6 skipped with its reason.
3. Open the topics of lesson 6, follow one topic link, and remove the mark. Reload the course page, and find lesson 6 not skipped.
4. Mark "MergeTree". Reload the course page, and find no gap note on lesson 2.
5. Mark the topics that you know, and judge each skipped lesson.

## Performance Considerations

The course page adds two RPC reads to its `Promise.all`. For the docs course, the document holds about 100 topics, about 110 explains pairs and 18 relations. A course of 150 lessons stays well below 1 MB. The walk visits each lesson and each need once. Nothing is stored.

## Migration Notes

The migration adds one function. It changes no table, no row and no other function. No backfill exists. To roll back, revert the page and drop the function.

## References

- Roadmap item S-04: `context/foundation/roadmap.md:138-150`
- PRD FR-008, US-01 and the guardrails: `context/foundation/prd.md:61-64`, `:70-82`, `:144-147`
- The words of the owner about the path: `context/foundation/shape-notes.md:101`
- S-03 plan: `context/archive/2026-11-27-mark-known-topics/plan.md`
- S-02 research, the learner state and rule 6: `context/archive/2026-11-25-course-topic-graph/research.md:1138-1160`, `:605`
- Similar read function: `course_topic_list` in `supabase/migrations/20261127230000_create_learner_events.sql:100-179`
- Similar reader: `readTopicMarks` in `src/lib/marks.ts:162-176`
- The test for a changed lesson: `topic_map_state` in `supabase/migrations/20261127200000_fix_topic_map_review.sql:53-104`
- Linear: RUB-11 (S-04) and RUB-5 (Question 1)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database

#### Automated

- [x] 1.1 The migration applies to the local database: `npx supabase migration up`
- [x] 1.2 The pgTAP tests pass, the new file included: `npx supabase test db`
- [x] 1.3 `npm run db:types` adds `course_lesson_map` to `src/db/database.types.ts`
- [x] 1.4 Lint and types pass: `npm run lint` and `npx astro check`

### Phase 2: Rule function

#### Automated

- [ ] 2.1 The unit tests pass, the new tests included: `npm run test:unit`
- [ ] 2.2 Lint and types pass: `npm run lint` and `npx astro check`

### Phase 3: Course page

#### Automated

- [ ] 3.1 The unit tests pass: `npm run test:unit`
- [ ] 3.2 Lint, types and the build pass: `npm run lint`, `npx astro check` and `npm run build`
- [ ] 3.3 The phone check passes with the adjusted list in all five looks: `LOOKS=all npm run phone-check`
- [ ] 3.4 The smoke test passes with the lesson path steps: `SMOKE_COURSES=1 SMOKE_TOPICS=1 npm run smoke`

#### Manual

- [ ] 3.5 On the local docs course, a lesson whose explained topics are all marked shows "Skipped" at its place with the reason, and its link opens the original lesson
- [ ] 3.6 A topic link of a skipped lesson opens its lesson section on the checklist, one click removes the mark, and a reload of the course page shows the lesson as not skipped
- [ ] 3.7 With "MergeTree" and "Table parts" not marked, lesson 2 shows the gap note that names lesson 3, the list keeps the course order, and a mark on either topic removes the note after a reload
- [ ] 3.8 The owner marks the topics that they know on the docs course, and agrees with the skipped lessons

### Phase 4: Production and records

#### Automated

- [ ] 4.1 The roadmap holds the S-04 records: `grep -c "Answered for S-04\|S-04 answers its part" context/foundation/roadmap.md` gives at least 2
- [ ] 4.2 The CI run on `main` after the merge passes, the `deploy` job included: `gh run list --branch main --limit 1`

#### Manual

- [ ] 4.3 The owner applies the migration to production with `npx supabase db push`, then merges the pull request
- [ ] 4.4 In production, the owner opens a real course with marks, and the Lessons section shows the adjusted list with the skips of those marks
