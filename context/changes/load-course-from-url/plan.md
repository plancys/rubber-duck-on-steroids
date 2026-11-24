# Load a Course from Its URL Implementation Plan

## Overview

A learner loads a course into the product and sees its lessons in course order. There are two ways in. For an open site, the learner gives the URL of the course start page, and a `load_course` job in the worker crawls the site. For a site that blocks automated reads, the learner uses a browser extension, which saves each lesson page that the learner opens. Each lesson is stored as Markdown, because the topic graph (S-02) and the collapsed passages (S-05) read that text.

This is roadmap item S-01. It covers FR-001, FR-002 and US-01. It also takes in FR-013 (a way in for blocked sites), in the form of the browser extension.

## Current State Analysis

- The background work path (F-01) is merged. A job row goes into `public.jobs`, and the worker in `worker/` claims it with a lease (`supabase/migrations/20261124123303_create_jobs.sql`). A new job type adds one handler to `worker/handlers/index.ts` and one value to the check `jobs_type_check`.
- The demo job runs only when `WORKER_ALLOW_DEMO` is `"true"` (`worker/handlers/index.ts`). A job payload is limited to 4096 bytes (`supabase/migrations/20261124170000_limit_job_payload.sql`).
- The worker has zero dependencies, and its image copies `worker/` without `npm install` (`worker/Dockerfile`).
- The web app runs on Cloudflare Workers with 10 ms of CPU for each request on the Free plan (`context/foundation/infrastructure.md:19`). It holds no Supabase service key. Only the worker holds that key (`AGENTS.md`).
- The example course site `learn.clickhouse.com` answers 403 to every automated client, also for `robots.txt`. Its bot check labels such a request "automated". The ClickHouse Acceptable Use Policy (2026-04-10) bars bots and scrapers from extracting data. `clickhouse.com/docs` allows automated reads (`robots.txt`: `Allow: /`).
- The status page pattern exists: `src/pages/dashboard/job-check.astro`, `src/components/jobs/JobStatus.tsx` and `src/components/hooks/useJobStatus.ts`.
- New signed-in pages follow `src/lib/nav.ts`: one entry in `navLinks` and one `Entry` on the dashboard. Account pages go in `accountLinks`.

## Desired End State

1. The learner opens `/dashboard/courses`, pastes the URL of an open course start page, and starts the load. The page shows the job progress with the existing status component, then the course.
2. The course page `/dashboard/courses/<id>` lists the lessons in course order: number, title, link to the original page, and a "could not load" mark for each lesson that failed.
3. A second load of the same URL replaces the lessons of that course and keeps the course.
4. For a blocked site, the learner creates a personal access token in Settings, pastes it into the extension once, starts a course in the extension, and opens each lesson page. Each opened page appears in the course, in the order the learner opened it.
5. CI loads a small fixture course through the URL path and a page through the extension path.

To verify:

1. `npm start`, `npm run worker`, then load `https://clickhouse.com/docs/<a section start page>` on `/dashboard/courses`, and read the lesson list.
2. Load the extension unpacked from `extension/dist`, add a token, start a course, open two pages, and read the course.
3. `SMOKE_COURSES=1 npm run smoke` passes against the fixture site.

### Key Discoveries:

- Crawlee options: `respectRobotsTxtFile` skips pages that `robots.txt` disallows, `maxRequestsPerCrawl` caps the page count, `maxConcurrency` caps parallel requests, and `MemoryStorageBackend` (or `CRAWLEE_PERSIST_STORAGE=false`) keeps Crawlee storage off the disk.
- Crawlee's `JSDOMCrawler` gives each page a DOM, which Mozilla Readability reads directly. Turndown converts the Readability HTML to Markdown.
- The web app cannot run Readability or Turndown inside 10 ms of CPU. So the worker converts crawled pages, and the extension converts in the browser and sends Markdown.
- The web app has no service key. A `security definer` database function checks the extension token, so no key reaches the web app.

## What We're NOT Doing

- No automated read of a site that blocks bots or disallows the page in `robots.txt`. No browser-like headers, no headless browser to pass a bot check, no stealth plugin.
- No extension that fetches lesson pages by itself. It saves only the pages that the learner opens.
- No Chrome Web Store release and no Firefox build. The extension loads unpacked in Chrome, Edge and Brave.
- No display of the lesson text in the product. S-05 shows lessons. S-01 shows the list only.
- No language-model call other than the one call that picks the lessons from the start page links.
- No cleanup of old jobs. The user decided to keep all jobs for now.
- No upload of epub, mobi, md or pdf files (FR-012 stays parked).
- No topic extraction. S-02 does that.

## Implementation Approach

Data first, then the crawl, then the web app, then the extension, then CI and production. Phases 1 to 3 give a working URL load. Phase 4 adds the extension path on the same tables.

A course belongs to one learner and has a unique source URL for that learner. Lessons belong to a course and carry a position. The worker writes through `service_role` functions, as it does for jobs. The extension writes through a `security definer` function that takes the token, so the web app stays without a service key.

## Critical Implementation Details

### State sequencing

The start route creates the course row in the state `loading` before it creates the job. The job payload holds only the course id (the URL lives on the course), so the payload stays far under 4096 bytes. A reload uses the same course row: the route sets the state back to `loading` and creates a new job. The worker replaces the lessons in one database call at the end of the crawl, so the lesson list never shows a mix of old and new lessons.

### Debug & observability

The crawl writes one log line for each page with its result (`loaded`, `failed`, `skipped_by_robots`) and the job id, never the page text. The model call logs the token counts and the number of picked lessons, never the prompt.

## Phase 1: Course tables and access

### Overview

This phase adds the tables for courses, lessons and access tokens, the `load_course` job type, and the database functions that the worker and the extension use.

### Changes Required:

#### 1. Courses and lessons

**File**: `supabase/migrations/<timestamp>_create_courses.sql`

**Intent**: Store each course of a learner and its lessons in course order, with the lesson text as Markdown.

**Contract**:

- `public.courses`: `id uuid` primary key; `user_id uuid not null default auth.uid()` referencing `auth.users` with `on delete cascade`; `source_url text not null` (normalized: no fragment, no trailing slash); `title text`; `source_kind text not null` with a check for `crawl` and `extension`; `status text not null default 'loading'` with a check for `loading`, `ready` and `failed`; `error text`; `loaded_at timestamptz`; `created_at`, `updated_at` with the trigger pattern of `jobs`. Unique `(user_id, source_url)`.
- `public.lessons`: `id uuid` primary key; `course_id uuid not null` referencing `courses` with `on delete cascade`; `user_id uuid not null` (copied from the course, for row level security); `position integer not null`; `title text`; `url text not null`; `markdown text`; `status text not null` with a check for `loaded` and `failed`; `error text`; `created_at`. Unique `(course_id, position)` and `(course_id, url)`. A check limits `markdown` to 1 MB.
- Row level security on both tables. The role `authenticated` gets `select` on its own rows, `insert (source_url, source_kind)` on `courses`, and `delete` on its own courses. It gets no `update` and no write on `lessons`. The role `anon` gets nothing.

#### 2. The load_course job type

**File**: `supabase/migrations/<timestamp>_create_courses.sql`

**Intent**: Let the jobs table hold course loads.

**Contract**: `jobs_type_check` allows `demo` and `load_course`. The payload of `load_course` is `{ "courseId": "<uuid>" }`.

#### 3. Functions for the worker

**File**: `supabase/migrations/<timestamp>_create_courses.sql`

**Intent**: Give the worker its only way to read a course and to store a crawl result.

**Contract**: Only `service_role` can execute them.

- `start_course_load(course_id uuid)` returns the course row (with `source_url`).
- `finish_course_load(course_id uuid, title text, lessons jsonb)` replaces all lessons of the course in one transaction, sets `ready`, `loaded_at` and the title. `lessons` is an array of `{ position, title, url, markdown, status, error }`.
- `fail_course_load(course_id uuid, reason text)` sets `failed` and `error`, and keeps the old lessons.

#### 4. Functions for the learner

**File**: `supabase/migrations/<timestamp>_create_courses.sql`

**Intent**: Let a learner reload a course without an update right on the table.

**Contract**: `reload_course(course_id uuid)` returns `boolean`. It is `security definer` with `search_path = ''`. It changes the row only when the owner is `auth.uid()` and the state is not `loading`, and sets `loading` and clears `error`. Only `authenticated` can execute it.

#### 5. Access tokens and the page save

**File**: `supabase/migrations/<timestamp>_create_access_tokens.sql`

**Intent**: Let the extension act for one learner without a session and without a service key in the web app.

**Contract**:

- `public.access_tokens`: `id`, `user_id` (default `auth.uid()`, cascade), `name text not null`, `token_hash text not null unique` (SHA-256 hex), `created_at`, `last_used_at`, `revoked_at`. Row level security: the owner selects own rows and inserts own rows with `name` and `token_hash` only. `revoke_access_token(id uuid)` (definer, owner only) sets `revoked_at`. At most 5 live tokens for each learner.
- `extension_start_course(token text, source_url text, title text)` returns the course id. It is `security definer`, executable by `anon`. It hashes the token, finds a live token, sets `last_used_at`, and creates the course with `source_kind = 'extension'` and status `ready`, or returns the existing course of that learner for that URL.
- `extension_save_page(token text, course_id uuid, url text, title text, markdown text)` returns the lesson position. Same checks. The course must belong to the token owner and have `source_kind = 'extension'`. The page goes to the next position, or replaces the lesson with the same URL in place.
- Both functions return the same error for an unknown, a revoked and a foreign token.

#### 6. Policy and rule tests

**File**: `supabase/tests/courses_test.sql`, `supabase/tests/access_tokens_test.sql`

**Intent**: Prove the access rules and the functions.

**Contract**: The tests cover: a learner reads only own courses and lessons; a learner cannot update a course or write a lesson; a duplicate source URL for the same learner fails; `finish_course_load` replaces lessons in one call; `fail_course_load` keeps old lessons; `reload_course` works for the owner only and not while `loading`; the token functions refuse unknown, revoked and foreign tokens, append pages in order, and replace a page with the same URL; `anon` cannot read a table; only `service_role` executes the worker functions.

#### 7. Generated types

**File**: `src/db/database.types.ts`

**Intent**: Types for the new tables and functions.

**Contract**: The file comes from `npm run db:types`.

### Success Criteria:

#### Automated Verification:

- The migrations apply to a clean local database: `npx supabase db reset`
- The policy and rule tests pass: `npx supabase test db`
- The generated types are current: `npm run db:types` leaves no diff
- Lint passes: `npm run lint`
- Type checks pass: `CI=true npx astro check`

#### Manual Verification:

- In Studio, `courses`, `lessons` and `access_tokens` show row level security as on

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Crawl job in the worker

### Overview

This phase adds the `load_course` handler: a polite crawl of an open site, the lesson finder, and the conversion to Markdown.

### Changes Required:

#### 1. Worker dependencies and image

**File**: `worker/package.json`, `worker/package-lock.json`, `worker/Dockerfile`, `worker/.dockerignore`, `package.json`

**Intent**: Give the worker its first dependencies and keep the image small.

**Contract**: `worker/package.json` lists `crawlee` (with `@crawlee/jsdom`), `@mozilla/readability`, `turndown` and `@anthropic-ai/sdk`, at pinned versions. The Dockerfile runs `npm ci --omit=dev` before it copies the code, as the user `node`. `.dockerignore` keeps `node_modules` and the tests out. `scripts/worker.mjs` and `npm run test:unit` keep working from the repo root.

#### 2. Crawl and conversion

**File**: `worker/courses/crawl.ts`, `worker/courses/markdown.ts`

**Intent**: Read the start page and the lesson pages of an open site, and convert each page to Markdown.

**Contract**:

- A `JSDOMCrawler` with `respectRobotsTxtFile: { userAgent: "RubberDuckBot" }`, `maxConcurrency: 2`, `maxRequestsPerCrawl: 201` (the start page plus 200 lessons), in-memory storage, a timeout of 20 seconds for each page, and the user agent `RubberDuckBot/0.1 (+<repo URL>)`.
- The start page gives the course title and its links (text and absolute URL, in page order, same site only, fragments removed, duplicates removed).
- A start page that answers 401, 403 or 429, or that `robots.txt` disallows, fails the job with the safe reason "This site does not allow automated reads. Use the browser extension."
- Each lesson page: Readability on the page DOM, then Turndown with fenced code blocks and ATX headings. An empty result or an HTTP error marks the lesson `failed` with a short reason. The job still ends done when at least one lesson loads.
- The handler reports progress through `step`: step 1 "Reading the start page", step 2 "Finding the lessons", then one step for each lesson page.

#### 3. Lesson finder

**File**: `worker/courses/find-lessons.ts`, `worker/llm.ts`

**Intent**: Pick the lesson URLs and their order from the start page links.

**Contract**:

- `worker/llm.ts`: a small interface `pickLessons(input)` with one implementation that calls the Anthropic Messages API with the model `claude-haiku-5-5`, one call, a tool schema that returns an ordered list of link indexes, and a timeout of 60 seconds. The key comes from `ANTHROPIC_API_KEY`.
- Without the key, or when the call fails or returns nothing valid, the finder uses the rule: the links whose path starts with the path of the start page, in page order.
- The finder returns at most 200 lessons.

#### 4. Handler registration

**File**: `worker/handlers/index.ts`, `worker/handlers/load-course.ts`

**Intent**: Run the crawl as a job.

**Contract**: `createHandlers` always registers `load_course`. The handler reads the course through `start_course_load`, crawls, and calls `finish_course_load`, or `fail_course_load` with a safe reason before it throws a `SafeError`. It stops on the abort signal between pages.

#### 5. Unit tests

**File**: `worker/courses/*.test.ts`, `worker/handlers/load-course.test.ts`

**Intent**: Test the logic without a network.

**Contract**: The tests use saved HTML fixtures in `worker/courses/fixtures/` and a fake fetch or a local `node:http` server. They cover: link extraction and normalization, the rule fallback, the model answer parser (valid, invalid, out-of-range indexes), the 200-lesson cap, Markdown output for headings, code and lists, a 403 start page, a page disallowed by `robots.txt`, and a failed lesson that does not fail the course.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type checks pass: `CI=true npx astro check`
- The worker image builds: `docker build -t rubber-duck-worker worker/`

#### Manual Verification:

- A course row inserted by hand for a `clickhouse.com/docs` section, with a `load_course` job, ends `ready` with its lessons in order and Markdown that reads well
- A course row for `https://learn.clickhouse.com/real-time-analytics-with-clickhouse` ends `failed` with the extension reason, and the worker log shows a blocked start page

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Courses in the web app

### Overview

This phase lets the learner start a load, follow it, and read the lesson list.

### Changes Required:

#### 1. Course helpers

**File**: `src/lib/courses.ts`

**Intent**: Hold the URL check, the course view and the texts, as `src/lib/jobs.ts` does for jobs.

**Contract**: `normalizeCourseUrl(input)` accepts only `http` and `https`, removes the fragment and a trailing slash, and rejects private addresses (`localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) unless the setting `ALLOW_PRIVATE_COURSE_URLS` is `true`. Error keys and texts follow the pattern of `jobErrorText`.

#### 2. Routes

**File**: `src/pages/api/courses/index.ts`, `src/pages/api/courses/[id]/reload.ts`, `src/pages/api/courses/[id]/delete.ts`

**Intent**: Start a load, reload a course, and delete a course.

**Contract**: The start route checks the session, normalizes the URL, inserts the course (or finds the existing course of that learner for that URL and reloads it), inserts a `load_course` job with `{ courseId }`, calls `wakeWorker()`, and redirects to `/dashboard/courses/<id>?job=<jobId>`. A `job_active` conflict redirects with that error. The reload route calls `reload_course`, then inserts the job. The delete route deletes the own course.

#### 3. Pages

**File**: `src/pages/dashboard/courses/index.astro`, `src/pages/dashboard/courses/[id].astro`

**Intent**: Show the courses and the lessons in order.

**Contract**: The list page shows the load form and the courses of the learner with state, lesson count and date. The course page shows the title, the source link, the state, the `JobStatus` of the newest job of the course while it loads (the page reloads when the job ends), and the ordered lessons with number, title, original link, and a "could not load" mark. Buttons: Reload and Delete. Phone rules apply.

#### 4. Navigation

**File**: `src/lib/nav.ts`, `src/pages/dashboard.astro`

**Intent**: Make the courses reachable.

**Contract**: One `navLinks` entry "Courses" and one dashboard `Entry`, outside the `sample-resource` markers.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type checks pass: `CI=true npx astro check`
- The production build passes: `npm run build`
- Unit tests still pass: `npm run test:unit`

#### Manual Verification:

- A load of a `clickhouse.com/docs` section shows the progress, then the lessons in course order
- A second load of the same URL replaces the lessons and keeps one course in the list
- A load of the blocked example course shows the reason with the extension hint
- A URL with `localhost` or a non-http scheme shows an error and starts no job
- The course pages obey the phone rules at 320px

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Tokens and the extension

### Overview

This phase adds the personal access tokens, the page-save route, and the browser extension for blocked sites.

### Changes Required:

#### 1. Token settings

**File**: `src/pages/dashboard/settings.astro`, `src/pages/api/tokens/index.ts`, `src/pages/api/tokens/[id]/revoke.ts`, `src/components/tokens/`

**Intent**: Let the learner create, see and revoke tokens.

**Contract**: The create route makes 32 random bytes, stores only the SHA-256 hash through the learner client, and shows the token once. The settings page lists the tokens by name, creation date and last use, with a Revoke button.

#### 2. Extension routes

**File**: `src/pages/api/extension/courses.ts`, `src/pages/api/extension/pages.ts`

**Intent**: Receive the calls of the extension.

**Contract**: Both routes read `Authorization: Bearer <token>`, call `extension_start_course` or `extension_save_page` through the anon client, return JSON, and answer CORS only for the `chrome-extension://` origin. A body over 1 MB gets 413. A bad token gets 401. These routes are the only ones without a session check, and they use the existing auth rate limiter.

#### 3. The extension

**File**: `extension/manifest.json`, `extension/src/*.ts`, `extension/build.mjs`, `package.json`

**Intent**: Save the pages that the learner opens on a course site.

**Contract**:

- Manifest V3 for Chrome, Edge and Brave. Permissions: `storage`, `activeTab`, `scripting`, and optional host permissions that the learner grants for one site when a course starts.
- A popup with: the product address and the token (stored in `chrome.storage.local`), "Start a course on this page" (sends the current page URL and title to `extension/courses`), the course name and the count of saved pages, and "Stop".
- While a course runs, each page that the learner opens on the same site and under the start path is converted in the page (Readability, then Turndown) and sent to `extension/pages`. A page is saved once for each URL.
- `extension/build.mjs` bundles with esbuild into `extension/dist`. `npm run build:extension` runs it. `dist` is in `.gitignore`.

#### 4. Unit tests

**File**: `extension/src/*.test.ts`

**Intent**: Test the extension logic without a browser.

**Contract**: The tests cover the same-site and start-path rule, the once-per-URL rule, and the Markdown conversion of a fixture page.

### Success Criteria:

#### Automated Verification:

- The extension builds: `npm run build:extension`
- Unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type checks pass: `CI=true npx astro check`
- The production build passes: `npm run build`

#### Manual Verification:

- A token made in Settings shows once, and Revoke ends its use
- The extension, loaded unpacked in Chrome, starts a course on the example course site and saves each lesson page that you open, in that order
- The course page in the product lists the saved lessons
- A revoked token makes the extension show a sign-in error

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 5: CI and production

### Overview

This phase makes CI protect both paths and gives the worker its model key in production.

### Changes Required:

#### 1. Fixture course site

**File**: `scripts/fixtures/course/`, `scripts/fixture-server.mjs`

**Intent**: Give CI a small course site that allows automated reads.

**Contract**: A start page with 3 lesson links in order, one link to a page outside the course path, one lesson that answers 404, and a `robots.txt` that allows everything except one path. `scripts/fixture-server.mjs` serves the folder on port 8799 with zero dependencies.

#### 2. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Prove both paths against a running server and worker.

**Contract**: Behind `SMOKE_COURSES`, outside the sample markers: a load of the fixture course ends `ready` with 2 loaded lessons and 1 failed lesson in order (the rule fallback, no model key); a reload keeps one course; a second learner gets 404 for the course; a token is made and used for `extension/courses` and `extension/pages`; a revoked token gets 401.

#### 3. CI smoke job and phone check

**File**: `.github/workflows/ci.yml`, `scripts/phone-check.mjs`

**Intent**: Run the new checks in CI.

**Contract**: The smoke job starts the fixture server before the worker, appends `ALLOW_PRIVATE_COURSE_URLS=true` to `.dev.vars`, sets `SMOKE_COURSES=1`, and builds the extension. The phone check adds `/dashboard/courses` and one course page.

#### 4. Production key and documents

**File**: `.github/workflows/ci.yml`, `README.md`, `AGENTS.md`, `.env.example`

**Intent**: Give the production worker its model key without a plain variable.

**Contract**: `deploy-worker` adds `ANTHROPIC_API_KEY=worker-anthropic-api-key:latest` to its `secrets:` input. The README gets the Secret Manager command for that secret, an Anthropic spend limit step, and a section on the extension: build, load unpacked, token. `AGENTS.md` gets the extension folder, the new commands, and the rule that the worker never passes a bot check by deception.

### Success Criteria:

#### Automated Verification:

- The smoke test passes with the course steps: `SMOKE_COURSES=1 npm run smoke`, with the fixture server, the preview and the worker running
- The phone check passes for the course pages: `npm run phone-check`
- The pull request shows the `ci` job and both `smoke` variants as passed

#### Manual Verification:

- The CI smoke log shows the fixture course load and the extension steps, and no key
- After the Google setup, a production load of a `clickhouse.com/docs` section uses the model and ends `ready`
- The Anthropic usage page shows a cost that you accept for that load

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- Link extraction, URL normalization, the rule fallback, and the model answer parser.
- The 200-lesson cap and the failed-lesson marks.
- Markdown output for headings, code blocks and lists.
- The extension rules: same site and start path, once per URL.

### Integration Tests:

- pgTAP for the access rules and every new function.
- Smoke steps for the URL path (fixture site, rule fallback) and the extension routes.

### Manual Testing Steps:

1. Load a `clickhouse.com/docs` section and read the lesson order against the site.
2. Load the same URL again and confirm one course.
3. Load the blocked example course and read the extension hint.
4. Make a token, load the extension unpacked, and save two lessons of the example course.
5. Revoke the token and confirm the extension error.

## Performance Considerations

- A load of 200 pages at 2 parallel requests with 20-second timeouts takes minutes. The worker heartbeat keeps the lease, and the learner sees step progress.
- One model call for each course, with only link texts and URLs, keeps the cost to cents.
- The 1 MB limit for each lesson and the 200-page limit bound the storage for each course.
- The extension routes do little CPU work, because the browser converts the page.

## Migration Notes

- The migrations only add tables, functions and one allowed job type.
- A rollback of the web app leaves the tables in place, and they do no harm without the routes.
- The worker image changes from zero dependencies to an `npm ci` build. The first CI deploy after this change builds a larger image.

## References

- Roadmap item: `context/foundation/roadmap.md`, S-01
- Requirements: `context/foundation/prd.md`, FR-001, FR-002, FR-013, US-01
- Background work path: `context/changes/background-work-path/plan.md`
- Job functions: `supabase/migrations/20261124123303_create_jobs.sql`
- Handler registry: `worker/handlers/index.ts`
- Status component: `src/components/jobs/JobStatus.tsx`
- ClickHouse Acceptable Use Policy: https://clickhouse.com/legal/agreements/acceptable-use-policy
- Crawlee options: https://github.com/apify/crawlee/blob/master/packages/basic-crawler/src/internals/basic-crawler.ts
- Crawlee storage: https://github.com/apify/crawlee/blob/master/docs/guides/result-storage.mdx

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Course tables and access

#### Automated

- [x] 1.1 The migrations apply to a clean local database
- [x] 1.2 The policy and rule tests pass
- [x] 1.3 The generated types are current
- [x] 1.4 Lint passes
- [x] 1.5 Type checks pass

#### Manual

- [x] 1.6 courses, lessons and access_tokens show row level security as on

### Phase 2: Crawl job in the worker

#### Automated

- [x] 2.1 Unit tests pass
- [x] 2.2 Lint passes
- [x] 2.3 Type checks pass
- [x] 2.4 The worker image builds

#### Manual

- [x] 2.5 A clickhouse.com/docs course ends ready with its lessons in order and readable Markdown
- [x] 2.6 The blocked example course ends failed with the extension reason

### Phase 3: Courses in the web app

#### Automated

- [ ] 3.1 Lint passes
- [ ] 3.2 Type checks pass
- [ ] 3.3 The production build passes
- [ ] 3.4 Unit tests still pass

#### Manual

- [ ] 3.5 A docs section load shows the progress, then the lessons in course order
- [ ] 3.6 A second load of the same URL replaces the lessons and keeps one course
- [ ] 3.7 A load of the blocked example course shows the reason with the extension hint
- [ ] 3.8 A localhost or non-http URL shows an error and starts no job
- [ ] 3.9 The course pages obey the phone rules at 320px

### Phase 4: Tokens and the extension

#### Automated

- [ ] 4.1 The extension builds
- [ ] 4.2 Unit tests pass
- [ ] 4.3 Lint passes
- [ ] 4.4 Type checks pass
- [ ] 4.5 The production build passes

#### Manual

- [ ] 4.6 A token shows once, and Revoke ends its use
- [ ] 4.7 The extension saves each lesson page that you open on the example course, in that order
- [ ] 4.8 The course page lists the saved lessons
- [ ] 4.9 A revoked token makes the extension show a sign-in error

### Phase 5: CI and production

#### Automated

- [ ] 5.1 The smoke test passes with the course steps
- [ ] 5.2 The phone check passes for the course pages
- [ ] 5.3 The pull request shows the ci job and both smoke variants as passed

#### Manual

- [ ] 5.4 The CI smoke log shows the fixture course load and the extension steps, and no key
- [ ] 5.5 A production load of a docs section uses the model and ends ready
- [ ] 5.6 The Anthropic usage page shows a cost that you accept
