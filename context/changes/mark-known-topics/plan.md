# Mark Known Topics Implementation Plan

## Overview

A learner marks the topics of a course that they believe they already know (roadmap S-03, FR-005). Each click saves a mark at once. The learner marks topics on a new checklist page and in the topic panel of the map. Each mark goes to an append-only table of learner events. A pure function in the web app gives the state of each topic from these events. S-04, S-05 and S-06 read this state later.

This plan also answers the unknown of S-03 in the roadmap: a mark has two values, known or no mark.

## Current State Analysis

- The map of a course lives in 8 knowledge tables. A learner can only read their own rows (`supabase/migrations/20261127120000_create_topic_map.sql:199-274`). The header of that migration sets the rules: a knowledge table holds no learner state, and no view or function joins the map with learner data (`:4-11`).
- A `topics` row belongs to a learner, not to a course. `course_topics` links a course to its topics and holds the home lesson (`:52-73`, `:87-99`). A new topic id comes from a hash of the course id and the first normalized name (`worker/topics/identity.ts:48-61`). So one concept in two courses has two ids.
- A map update keeps each topic id. A merged topic keeps its row and points at the topic that replaces it (`worker/topics/build.ts:398-428`). A retired topic keeps its row, and it comes back with the same id (`worker/topics/build.test.ts:316-336`). `finish_topic_map` keeps the `course_topics` row of each topic in the state, and the builder names each stored topic (`create_topic_map.sql:790-797`, `worker/topics/build.ts:398-440`).
- A merge chain is one step long after each build. A detached topic can keep a longer chain or a loop. The worker follows a chain with `finalTarget`, which gives null for a loop (`worker/topics/identity.ts:151-161`).
- A course delete runs the trigger `courses_delete_topics`. It deletes the topics of the course that no other course uses. Its comment asks S-03 to look at this rule again (`create_topic_map.sql:276-312`, `:280`). The learner deletes a course through `src/pages/api/courses/[id]/delete.ts:22-30`.
- A topic has at most one `part_of` parent, and a chain can be deeper than one level (`worker/topics/build.ts:296-322`). `topic_map_lesson` picks the parent with `order by pt.name, pt.id limit 1` (`supabase/migrations/20261127200000_fix_topic_map_review.sql:188-197`).
- The page functions `topic_map_state` and `topic_map_lesson` are `language sql stable`, not security definer, and only `authenticated` can call them (`fix_topic_map_review.sql:57-70`, `:133-138`, `:260-265`). No read gives all topics of a course in one call.
- The API returns at most 1,000 rows for one request (`supabase/config.toml:18`).
- The app writes with a form post and a redirect (`src/pages/api/courses/[id]/topics.ts:11-35`). One island writes with `fetch` and a `FormData` body (`src/components/tokens/CreateTokenForm.tsx:38-54`). Each route checks its input by hand, for example with `isCourseId` (`src/lib/courses.ts:91`).
- Astro refuses a cross-site POST with a form content type, but it does not check `application/json` (`node_modules/astro/dist/core/app/origin-check.js:29-57`).
- The topic panel has no control that changes data (`src/components/topics/TopicPanel.tsx:47-149`). The map island mounts with `client:only="react"` (`src/pages/dashboard/courses/[id]/map.astro:132-144`).
- The app has no checkbox component. The phone check measures the tap size of `a, button, summary, input[type="submit"]`, and the font size of each input (`scripts/phone-check.mjs:37`, `:160-177`).

## Desired End State

A signed-in learner opens "Mark the topics you know" from the course page or from the map page. The page lists the live topics of the course in groups by lesson, with each child under its parent. One click on a topic saves the mark "known" or removes it. "Mark all" and "Clear all" change one lesson in one call, and "Undo" brings back the marks that the lesson had before. In the map, the topic panel has a "Known" control that saves the same mark. A reload shows the same marks in both places. Another learner cannot read or write these marks. A course delete removes the marks of that course.

Verification: the pgTAP tests, the unit tests, the smoke steps, the phone check, and a check on a real course.

### Key Discoveries:

- Rule 6 of the S-02 research: the learner state is a function of the events, and no database view or function joins the map with learner data (`context/archive/2026-11-25-course-topic-graph/research.md:1160`). The page makes two reads and joins them in code.
- The research gives four learner states for M-01: unknown, claimed, confirmed and refuted. A self-mark gives "claimed" (`research.md:1138`, `:1149`). An undo is one more event (`research.md:605`).
- The S-02 plan kept `part_of` so that "a parent lets S-03 mark its children in one step" (`context/archive/2026-11-25-course-topic-graph/plan-brief.md:28`). The owner chose no effect on the children instead, because a general topic does not cover its detailed topics.
- A child table uses a composite foreign key to `(id, user_id)` of its parent, so a row always has the owner of its parent (`create_topic_map.sql:48-49`, `:68-69`).
- A column grant stops a learner from setting `user_id` (`supabase/migrations/20261124123303_create_jobs.sql:77-79`).
- A check trigger runs as the caller with `set search_path = ''` (`create_topic_map.sql:318-369`).
- A function that returns one `jsonb` value is not subject to the row limit, as `topic_map_lesson` shows (`fix_topic_map_review.sql:133-258`).
- The pgTAP setup uses two users, `set local role authenticated` and `set local request.jwt.claim.sub` (`supabase/tests/topic_map_test.sql:7-49`, `supabase/tests/notes_rls_test.sql:49-51`).
- The web app imports a sibling module with a relative path and the `.ts` extension when `node --test` must run it (`allowImportingTsExtensions` in `node_modules/astro/tsconfigs/base.json`, `src/lib/topic-map-layout.test.ts`).

## What We're NOT Doing

- No marks on the map canvas, no legend and no knowledge overlay. S-07 does that.
- No levels of knowledge and no explicit "not known" value.
- No effect of a parent mark on its children, and no effect of a child mark on its parent. No inference along `prerequisite`.
- No change to the topic engine, the prompt or the meaning of `part_of`. The idea of a map from general to detailed topics goes to the roadmap in Phase 4.
- No questions and no states `confirmed` or `refuted`. S-06 adds them.
- No marks across courses. A mark belongs to one topic id, and a topic id belongs to one course until S-10.
- No search and no filter on the checklist page.
- No update and no delete of an event, and no quota on marks. A mark costs no model call.
- No change to the trigger `courses_delete_topics`. The cascade removes the marks with the topics.
- No mark control in the outline of the map page. The checklist page works without a script.
- No undo inside a lesson reader. S-05 owns that part of Open Roadmap Question 13.

## Implementation Approach

The database comes first, then the pure state function and the route, then the two places in the web app, then production.

The table `learner_events` holds one row for each mark or unmark. A learner can insert and read only their own rows. Nobody can change or delete a row. Two read functions return JSON: the live topics of a course with no learner data, and the events of a course with no map data. The pages join them in code with the state function. The newest event of a topic decides its state, and an event on a merged topic counts for the topic that replaces it.

One route takes the form fields `mark` and `unmark`. It answers JSON to the island and a redirect to a form post with no script. Both places use one hook. A control stays disabled while its write runs, and it shows the new state after the server answers.

## Critical Implementation Details

**State sequencing.** The newest event of a topic wins, so the events need a strict order. `created_at` takes `clock_timestamp()`, not `now()`, because `now()` gives one value for each transaction. The order is `created_at`, then `id`. The island disables a control while its write runs, so one page never sends two writes for one topic at the same time.

**Row limit.** A plain select returns at most 1,000 rows (`supabase/config.toml:18`). A learner who clicks often passes that number in one course. Read the events only through `learner_course_events`, which returns one `jsonb` value.

**Origin check.** Astro checks the origin only for form content types. The island must send a `FormData` body, and the route must refuse every other content type.

**Merge chains.** A detached topic can keep a chain of merges or a loop. The state function follows a chain to its live end, as `finalTarget` does in the worker, and it ignores an event whose chain loops. The web app must not import from `worker/` (`AGENTS.md:55`), so the function has its own copy of this walk.

## Phase 1: Learner events and the topic list in the database

### Overview

Add the first learner table, its rules and the two read functions. Prove each rule with pgTAP.

### Changes Required:

#### 1. The table of learner events

**File**: `supabase/migrations/<timestamp>_create_learner_events.sql`

**Intent**: Store each mark of a learner as one append-only event, beside the knowledge tables of S-02 and with no change to them.

**Contract**:

- `learner_events`: `id uuid` primary key (`gen_random_uuid()`), `user_id uuid not null default auth.uid()` (references `auth.users`, cascade), `course_id uuid not null`, `topic_id uuid not null`, `kind text not null`, `created_at timestamptz not null default clock_timestamp()`.
- A check allows `kind in ('mark_known', 'unmark_known')`. S-06 extends this check for its answer events.
- A foreign key `(course_id, user_id)` to `courses (id, user_id)`, and a foreign key `(topic_id, user_id)` to `topics (id, user_id)`. Both cascade on delete. No foreign key goes to `course_topics`, because `finish_topic_map` deletes the row of a topic that leaves a course.
- An index on `(course_id, created_at, id)`.
- RLS is on. One select policy and one insert policy for `authenticated`, both with `(select auth.uid()) = user_id`. No update policy and no delete policy.
- Grants: revoke all from `anon` and `authenticated`. Grant `select` and `insert (course_id, topic_id, kind)` to `authenticated`.
- The header states the rules: no knowledge table points at this table, no view or function returns map data joined with this table, and a course delete removes the events through the topic and the course.

#### 2. The insert check

**File**: `supabase/migrations/<timestamp>_create_learner_events.sql`

**Intent**: Refuse an event for a topic that is not in the course of the event.

**Contract**: A trigger before insert runs as the caller with `set search_path = ''`. It raises `check_violation` (23514) when no `course_topics` row has the `course_id` and the `topic_id` of the new row. RLS hides the `course_topics` rows of another learner, so a topic of another learner also fails here. A merged or a retired topic of the course passes, because it keeps its `course_topics` row. The check returns no data, so rule 6 of S-02 holds.

#### 3. The topic list of a course

**File**: `supabase/migrations/<timestamp>_create_learner_events.sql`

**Intent**: Give the checklist page and the map page all live topics of a course in one read, with no learner data.

**Contract**: `course_topic_list(course_id uuid) returns jsonb`, `language sql stable`, `set search_path = ''`, not security definer. Only `authenticated` can execute it. It returns null when the caller cannot see the course. Else it returns:

```json
{
  "lessons": [{ "url": "…", "position": 1, "title": "…" }],
  "topics": [{ "id": "…", "name": "…", "description": "…", "home_lesson_url": "…", "parent_id": null }],
  "merged": [{ "id": "…", "merged_into": "…" }]
}
```

- `lessons`: each lesson that is the home lesson of at least one live topic, in course order.
- `topics`: each live topic of the course (`merged_into is null` and `retired_at is null`) with a home lesson. The order is the position of the home lesson, then the text order of `topic_map_lesson`: the first link position, then the name, then the id.
- `parent_id`: the parent rule of `topic_map_lesson`, a `part_of` relation from the topic whose source passage is in the course, first by parent name and id.
- `merged`: each topic of the course with `merged_into` set, and its target.

#### 4. The events of a course

**File**: `supabase/migrations/<timestamp>_create_learner_events.sql`

**Intent**: Give the pages all events of one course in one read, past the row limit of the API.

**Contract**: `learner_course_events(course_id uuid) returns jsonb`, `language sql stable`, `set search_path = ''`, not security definer. Only `authenticated` can execute it. It returns a JSON array `[{ "id", "topic_id", "kind", "created_at" }]` of the events of the caller for the course, in the order `created_at, id`. It reads only `learner_events`.

#### 5. pgTAP tests

**File**: `supabase/tests/learner_events_test.sql`

**Intent**: Prove the access rules, the insert check, the cascade and both read functions.

**Contract**: The setup of `topic_map_test.sql`: two learners, one course with live, merged and retired topics, and a second course of the first learner. The tests:

- `anon` cannot read or insert an event (42501).
- A learner inserts `mark_known` and `unmark_known` events for a topic of their course and reads them back.
- A learner cannot set `user_id` (42501), cannot update or delete an event (42501), and cannot insert a wrong `kind` (23514).
- A topic of the second course with the id of the first course fails with 23514.
- A merged topic and a retired topic of the course pass the insert check.
- The second learner reads no event of the first learner, and `learner_course_events` gives `[]` to them. An insert for the course of the first learner fails with 23514.
- A course delete by the learner removes their events of that course.
- `course_topic_list` gives the live topics only, in the stated order, with the parent and the merged pairs. It gives null to the second learner.
- `learner_course_events` gives the order `created_at, id`.

#### 6. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Give the web app the types of the new table and the two functions.

**Contract**: `npm run db:types` writes the file. Nobody edits it by hand.

### Success Criteria:

#### Automated Verification:

- The migration applies to the local database: `npx supabase migration up`
- The pgTAP tests pass, the new file included: `npx supabase test db`
- `npm run db:types` adds `learner_events`, `course_topic_list` and `learner_course_events` to `src/db/database.types.ts`
- Lint and types pass: `npm run lint` and `npx astro check`

**Implementation Note**: This phase has no manual check. Go to the next phase when the automated checks pass.

---

## Phase 2: State function and marks route

### Overview

Add the pure state function, the marks module and the route. Prove the route with smoke steps.

### Changes Required:

#### 1. The state function

**File**: `src/lib/learner-state.ts`, `src/lib/learner-state.test.ts`

**Intent**: Give the state of each topic as a pure function of the events and the merges.

**Contract**:

- `LearnerEventKind = "mark_known" | "unmark_known"`. `LearnerEvent = { id, topicId, kind, createdAt }`. `TopicState = "unknown" | "claimed"`. These are the first two of the four M-01 states. S-06 adds `confirmed` and `refuted`.
- `LEARNER_STATE_POLICY = "marks-1"` names the rule.
- `parseLearnerEvents(data: unknown): LearnerEvent[]` reads the JSON of `learner_course_events` and drops a malformed item.
- `topicStates(events, merges: ReadonlyMap<string, string>): Map<string, TopicState>`. Each event counts for the live end of the merge chain of its topic. The function ignores an event whose chain loops. The newest event of each topic by `(createdAt, id)` decides: `mark_known` gives `claimed`, and `unmark_known` gives `unknown`. A topic with no event is not in the result, and it reads as `unknown`.
- `knownTopicIds(states): Set<string>` gives the ids in the state `claimed`.
- Tests: a mark and then an unmark give `unknown`. A mark on a merged topic counts for its target. The newest event wins between a merged topic and its target, in both orders. A chain A to B to C. A loop. An equal `createdAt` sorts by `id`. The order of the input does not change the result. A mark on a retired topic stays on its id.

#### 2. The marks module

**File**: `src/lib/marks.ts`, `src/lib/marks.test.ts`

**Intent**: Hold the form rules, the error keys, the client write and the server read of the marks in one module with no Astro API.

**Contract**:

- `MAX_MARK_IDS = 500`.
- `parseMarkForm(form: FormData)` gives `{ mark: string[], unmark: string[], lesson: number | null }` or `{ error: "invalid_marks" }`. The fields `mark` and `unmark` repeat. Each value is a UUID. A form has at least 1 id and at most 500 ids. No id is in both lists. Duplicates collapse. `lesson` is an optional lesson position for the redirect.
- Error keys: `signed_out`, `not_configured`, `not_found`, `invalid_marks`, `marks_stale`, `unknown`. `markErrorText(key)` gives a fixed text. `markErrorKey(code)` maps 23514 and 23503 to `marks_stale`, 42501 to `not_found`, and each other code to `unknown`. The notice key `marks_saved` has a fixed text too.
- `saveMarks(courseId, { mark, unmark })` posts a `FormData` body with `Accept: application/json` to the route. It gives `{ ok: true }` or `{ error: key }`.
- `readTopicMarks(supabase, courseId)` calls `course_topic_list` and `learner_course_events` in parallel. It gives `{ list, known }`, where `list` is the parsed topic list or null, and `known` is the set of live topic ids in the state `claimed`.
- Runtime imports of sibling modules use a relative path with the `.ts` extension, so `node --test` can run the tests.
- Tests for `parseMarkForm` and `markErrorKey`.

#### 3. The topic list helpers

**File**: `src/lib/topics.ts`, `src/lib/topics.test.ts`

**Intent**: Parse the topic list and group it for the checklist.

**Contract**:

- `parseTopicList(data: unknown): TopicList | null` reads the JSON of `course_topic_list`.
- `checklistLessons(list): ChecklistLesson[]` gives one group for each lesson in course order. A child sits under its parent when both have the same home lesson. Else the child sits at the top level of its home lesson. A parent loop stops, as in `topicParents`.
- `knownTopicsPath(courseId)` gives `/dashboard/courses/<id>/known`.
- Tests for both functions, with a parent in another lesson and a parent loop.

#### 4. The marks route

**File**: `src/pages/api/courses/[id]/marks.ts`

**Intent**: Save the marks of one click or of one lesson action in one insert.

**Contract**:

- `POST` only, with `export const prerender = false`.
- JSON mode when the `Accept` header holds `application/json`. Else redirect mode.
- A body with a content type other than `application/x-www-form-urlencoded` or `multipart/form-data` gives 415 with `{ error: "invalid_marks" }`.
- No Supabase client: 503 `not_configured`, or a redirect to `/dashboard/courses?error=not_configured`. No user: 401 `signed_out`, or a redirect to `/auth/signin`. A bad course id: 404 `not_found`, or a redirect to `/dashboard/courses?error=not_found`.
- A form error: 400 `invalid_marks`, or a redirect to the checklist page with `?error=invalid_marks`.
- One insert of `{ course_id, topic_id, kind }` rows: `mark_known` for each `mark` id and `unmark_known` for each `unmark` id. The route reads nothing before the insert. The foreign keys, the insert check and RLS decide.
- A database error: 409 `marks_stale`, 404 `not_found` or 500 `unknown`, or a redirect to the checklist page with `?error=<key>`.
- Success: 200 with `{ saved: <rows> }`, or a 302 to `/dashboard/courses/<id>/known?notice=marks_saved`, with `#lesson-<position>` when the form gives `lesson`.
- Each JSON answer has `Cache-Control: no-store`.

#### 5. Smoke steps for the route

**File**: `scripts/smoke.mjs`

**Intent**: Prove the route against the running app, in the topic steps.

**Contract**: New steps in `topicMapSteps`, after "open lesson lists a topic with a quote". One step reads a topic id from the outline of the open lesson (`id="topic-<uuid>"`). Then:

- "learner marks a topic with a form post": 302 to the checklist page with `notice=marks_saved`.
- "learner removes the mark with a script request": 200 with `{ "saved": 1 }`.
- "marks route refuses a JSON body": 415.
- "marks route refuses a bad topic id": 400 with `invalid_marks`.
- "second learner cannot mark a topic of the course": 409 with `marks_stale`.

### Success Criteria:

#### Automated Verification:

- The unit tests pass, the new tests included: `npm run test:unit`
- Lint and types pass: `npm run lint` and `npx astro check`
- The build passes: `npm run build`
- The smoke test passes with the new route steps: `SMOKE_COURSES=1 SMOKE_TOPICS=1 npm run smoke`, with the setup of `AGENTS.md:81`

**Implementation Note**: This phase has no manual check. Go to the next phase when the automated checks pass.

---

## Phase 3: Checklist page and panel control

### Overview

Add the checklist page and the "Known" control in the topic panel, with one hook for both. Link the page from the course page and the map page.

### Changes Required:

#### 1. The hook

**File**: `src/components/hooks/useTopicMarks.ts`

**Intent**: Give both places one client module for the marks.

**Contract**: `useTopicMarks(courseId: string, initialKnown: readonly string[])` gives `isKnown(id)`, `isPending(id)`, `error` and `save(mark: string[], unmark: string[]): Promise<boolean>`. `save` sets the ids to pending, calls `saveMarks`, and applies the new values only after a 200 answer. On a failure it keeps the old values and sets `error` to the text of the error key.

#### 2. The checklist page

**File**: `src/pages/dashboard/courses/[id]/known.astro`

**Intent**: Let the learner mark the topics of a course quickly.

**Contract**:

- The path is `/dashboard/courses/<id>/known`. The middleware protects it. It is a course subpage, as the map page is, so it gets no nav entry and no dashboard entry.
- The page reads the course row and `readTopicMarks` in parallel. A bad id and a course of another learner both give 404, as on the map page.
- It shows the heading "Mark the topics you know", a link back to the course page, the count "N of M topics marked as known", and the text of a `?notice=` or `?error=` key.
- With no topic, it shows "This course has no topics yet. Build the topic map on the course page.", with a link to the course page.
- It renders `KnownTopicList` with `client:load`.
- Test ids: `known-page`, `known-count`, `known-lesson` with `data-position`, and `known-topic` with `data-topic-id` and `data-known`.

#### 3. The checklist island

**File**: `src/components/topics/KnownTopicList.tsx`

**Intent**: Show one toggle for each topic and the actions of each lesson.

**Contract**:

- One `<section id="lesson-<position>">` for each lesson: the lesson title, a link "Open on the map" to `topicMapPath(courseId, position)`, the count "k of n", and the buttons "Mark all" and "Clear all".
- Each topic shows its name, its description and one toggle button with `aria-pressed`. The accessible name of the toggle holds the topic name, and it does not change with the state. Children sit under their parent in a nested list.
- Each toggle and each lesson button sits in a `<form method="POST" action="/api/courses/<id>/marks">` with the field `mark` or `unmark` and a hidden field `lesson`. With no script, a click posts the form and the route redirects back. With the script, the island stops the submit and calls `save`.
- "Mark all" sends `mark` for the topics of the lesson with no mark. "Clear all" sends `unmark` for the marked topics of the lesson. A button with nothing to send is disabled.
- After "Mark all" or "Clear all", an "Undo" button sends the marks that the lesson had before, in one call. The next action on that lesson removes it. "Undo" needs the script.
- A control stays disabled with `aria-busy` while its write runs. An error shows as text in the section of the lesson.
- Each link and each button has `min-h-11 min-w-11`. A long topic name wraps at 320 px.

#### 4. The control in the topic panel

**File**: `src/pages/dashboard/courses/[id]/map.astro`, `src/components/topics/TopicMap.tsx`, `src/components/topics/TopicPanel.tsx`

**Intent**: Let the learner mark a topic while they read it on the map.

**Contract**:

- When a lesson is open, `map.astro` calls `readTopicMarks` and passes `knownTopicIds: string[]` to `TopicMap`. The overview needs no marks.
- `TopicMap` calls `useTopicMarks` and passes `known`, `pending` and `onToggleKnown` to `TopicPanel`.
- `TopicPanel` shows a toggle button "Known" with `aria-pressed` and the test id `topic-panel-known`, under the heading. A click saves at once. An error shows in the panel.
- The canvas and the outline show no mark. S-07 adds that.
- The map page shows a link "Mark the topics you know" (`known-link-map`) under the heading.

#### 5. The link on the course page

**File**: `src/pages/dashboard/courses/[id].astro`

**Intent**: Lead the learner from the course to the checklist.

**Contract**: In the "Topic map" section, when the map status is not `none`, a link "Mark the topics you know" (`known-link`) sits next to "Open the topic map", in the same style.

#### 6. Smoke steps and the phone check

**File**: `scripts/smoke.mjs`, `scripts/phone-check.mjs`

**Intent**: Prove the page against the running app, and keep the phone rules.

**Contract**:

- New smoke steps in `topicMapSteps`: "checklist lists the topics of the course" (200 with `known-topic`), "a mark shows on the checklist" (a mark through the route, then `data-known="true"` for that topic), and "second learner gets 404 for the checklist".
- The phone check checks `<course page>/known` after the course page, in each look.

#### 7. The agent guide

**File**: `AGENTS.md`

**Intent**: Keep the guide true for the next agent.

**Contract**: The "Project structure" section names the marks files: the table, `src/lib/learner-state.ts`, `src/lib/marks.ts`, the route, the page, the island and the hook. The "Testing" section adds the mark steps to the topic steps and the checklist page to the phone check.

### Success Criteria:

#### Automated Verification:

- The unit tests pass: `npm run test:unit`
- Lint, types and the build pass: `npm run lint`, `npx astro check` and `npm run build`
- The phone check passes with the checklist page in all five looks: `LOOKS=all npm run phone-check`
- The smoke test passes with the page steps: `SMOKE_COURSES=1 SMOKE_TOPICS=1 npm run smoke`

#### Manual Verification:

- On the local docs course, the owner marks the known topics with the checklist and the lesson buttons, and finds the marking quick
- "Undo" after "Mark all" brings back the marks of the lesson as they were
- The "Known" control in the panel saves a mark, and the checklist shows it after a reload
- With JavaScript off, a click on a toggle saves the mark, and the page comes back at the same lesson
- A mark on a parent leaves its children unchanged

**Implementation Note**: After this phase and its automated checks, pause for the confirmation of the human before the next phase.

---

## Phase 4: Production and records

### Overview

Record the decisions in the roadmap, put the migration in production, merge the change, and check it on a real course.

### Changes Required:

#### 1. The roadmap records

**File**: `context/foundation/roadmap.md`

**Intent**: Keep the decisions of this plan in view after the change goes to the archive.

**Contract**:

- S-03, "Unknowns": add "Answered: two values, known or no mark."
- Open Roadmap Question 13: add the part of the answer from S-03. A learner removes a mark with one click on the checklist page or in the topic panel. The undo inside a lesson stays with S-05.
- S-06, "Unknowns": add the idea of the owner. The questions start at a general topic and go deeper to its detailed topics, as an interviewer does. Owner: user. Block: no.
- "Parked": add "A map from general to detailed topics". The idea: `part_of` means a deeper level of expertise. Why parked: it changes the prompt and the review of S-02. Start it when: the plan of S-06 or the next review of the map.

#### 2. The production database

**File**: `supabase/migrations/<timestamp>_create_learner_events.sql`

**Intent**: Apply the new table and functions to production before the deploy that uses them.

**Contract**: The owner runs `npx supabase db push` before the merge to `main`, as for S-02 (`context/archive/2026-11-25-course-topic-graph/change.md:136`). The CI deploy of `main` then deploys the pages.

### Success Criteria:

#### Automated Verification:

- The roadmap holds the four records: `grep -c "general to detailed\|two values, known or no mark" context/foundation/roadmap.md` gives at least 3
- The CI run on `main` after the merge passes, the `deploy` job included: `gh run list --branch main --limit 1`

#### Manual Verification:

- The owner applies the migration to production with `npx supabase db push`, then merges the pull request
- In production, the owner marks topics of a real course on the checklist page and in the panel, and sees the marks after a reload

**Implementation Note**: The production steps are human actions. An agent does not run `npx supabase db push`, does not merge to `main`, and does not deploy.

---

## Testing Strategy

### Unit Tests:

- `topicStates`: the newest event wins. A merged topic, a chain, a loop, an equal time, any input order.
- `parseMarkForm`: the UUID check, the limit of 500, an id in both lists, duplicates, an empty form.
- `markErrorKey`: each database code.
- `checklistLessons`: the course order, a nested child, a parent in another lesson, a parent loop.

### Integration Tests:

- pgTAP: the access rules, the insert check, the cascade on a course delete, and both read functions.
- Smoke: the form post, the script request, a JSON body, a bad id, the second learner, the checklist page, and a mark after a reload.
- Phone check: the checklist page at 320 and 375 px in five looks.

### Manual Testing Steps:

1. Open the local docs course and open "Mark the topics you know".
2. Mark the topics that you know, with single clicks and with "Mark all", and note the time.
3. Use "Undo" after "Mark all", and check the marks of the lesson.
4. Open a lesson on the map, open a topic, and use "Known". Reload the checklist and find the mark.
5. Turn JavaScript off, click a toggle, and check that the page comes back at the same lesson with the mark.

## Performance Considerations

The checklist reads two JSON values. For a course of about 100 topics and some hundred events, both stay small. The map page reads the marks only when a lesson is open. Each click adds one event, so the log of a course grows with use. At about 10,000 events in one course, the read of all events needs a snapshot. Phase B of the roadmap owns that.

## Migration Notes

The migration adds one table, one trigger and two functions. It changes no existing row and no existing object. No backfill exists. To roll back, drop the two functions, the trigger and the table. No other table points at `learner_events`.

## Deviations

The implementation review of 2026-11-28 (`reviews/impl-review.md`) changed three points of this plan:

- F2: "What We're NOT Doing" says no quota on marks. The new migration `supabase/migrations/20261128020000_fix_learner_events_review.sql` limits a learner to 2,000 events in one hour (RD005), and the route answers 429 `too_many_marks`. Anyone can sign up, and the table only grows.
- F1: the same migration adds indexes on `topic_id` and on `(user_id, created_at)` for the cascades and for the quota. So a rollback also drops the trigger `learner_events_quota`, the function `check_learner_event_quota` and these two indexes.
- F6: the Implementation Approach says that nobody can change or delete a row. That holds for a learner. `service_role` keeps its rights, and the worker never writes this table.

## References

- Roadmap item S-03: `context/foundation/roadmap.md:125-136`
- PRD FR-005 and the guardrails: `context/foundation/prd.md:61-64`, `:125-128`
- S-02 research, the reduced design and its six rules: `context/archive/2026-11-25-course-topic-graph/research.md:1105-1170`
- S-02 research, the design principles: `context/archive/2026-11-25-course-topic-graph/research.md:594-611`
- S-02 plan brief: `context/archive/2026-11-25-course-topic-graph/plan-brief.md`
- The map migrations: `supabase/migrations/20261127120000_create_topic_map.sql`, `supabase/migrations/20261127200000_fix_topic_map_review.sql`
- Similar route: `src/pages/api/courses/[id]/topics.ts:11-35`
- Similar fetch write: `src/components/tokens/CreateTokenForm.tsx:38-54`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Learner events and the topic list in the database

#### Automated

- [x] 1.1 The migration applies to the local database: `npx supabase migration up` — ac836fa
- [x] 1.2 The pgTAP tests pass, the new file included: `npx supabase test db` — ac836fa
- [x] 1.3 `npm run db:types` adds `learner_events`, `course_topic_list` and `learner_course_events` to `src/db/database.types.ts` — ac836fa
- [x] 1.4 Lint and types pass: `npm run lint` and `npx astro check` — ac836fa

### Phase 2: State function and marks route

#### Automated

- [x] 2.1 The unit tests pass, the new tests included: `npm run test:unit` — 55bcb99
- [x] 2.2 Lint and types pass: `npm run lint` and `npx astro check` — 55bcb99
- [x] 2.3 The build passes: `npm run build` — 55bcb99
- [x] 2.4 The smoke test passes with the new route steps: `SMOKE_COURSES=1 SMOKE_TOPICS=1 npm run smoke`, with the setup of `AGENTS.md:81` — 55bcb99

### Phase 3: Checklist page and panel control

#### Automated

- [x] 3.1 The unit tests pass: `npm run test:unit` — e7fc7ef
- [x] 3.2 Lint, types and the build pass: `npm run lint`, `npx astro check` and `npm run build` — e7fc7ef
- [x] 3.3 The phone check passes with the checklist page in all five looks: `LOOKS=all npm run phone-check` — e7fc7ef
- [x] 3.4 The smoke test passes with the page steps: `SMOKE_COURSES=1 SMOKE_TOPICS=1 npm run smoke` — e7fc7ef

#### Manual

- [ ] 3.5 On the local docs course, the owner marks the known topics with the checklist and the lesson buttons, and finds the marking quick
- [x] 3.6 "Undo" after "Mark all" brings back the marks of the lesson as they were — e7fc7ef
- [x] 3.7 The "Known" control in the panel saves a mark, and the checklist shows it after a reload — e7fc7ef
- [x] 3.8 With JavaScript off, a click on a toggle saves the mark, and the page comes back at the same lesson — e7fc7ef
- [x] 3.9 A mark on a parent leaves its children unchanged — e7fc7ef

### Phase 4: Production and records

#### Automated

- [x] 4.1 The roadmap holds the four records: `grep -c "general to detailed\|two values, known or no mark" context/foundation/roadmap.md` gives at least 3 — 83b8c5e
- [ ] 4.2 The CI run on `main` after the merge passes, the `deploy` job included: `gh run list --branch main --limit 1`

#### Manual

- [ ] 4.3 The owner applies the migration to production with `npx supabase db push`, then merges the pull request
- [ ] 4.4 In production, the owner marks topics of a real course on the checklist page and in the panel, and sees the marks after a reload
