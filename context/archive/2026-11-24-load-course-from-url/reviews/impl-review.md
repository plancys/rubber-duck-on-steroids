<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Load a Course from Its URL

- **Plan**: context/changes/load-course-from-url/plan.md
- **Scope**: Full plan (completed phases only. Phase 5 waits for the production checks 5.5 and 5.6.)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Plan Adherence: no MISSING item. The 6 deviations from the plan are the ones the user approved during the implementation. The other drift is small and makes the code stricter.

Scope Discipline: the extras are benign. Examples: a trigger that limits a `load_course` job to the own crawl course, a 5 MB page cap, the root `postinstall` for `worker/` and `extension/`, and a "load stopped" message. No breach of "What We're NOT Doing".

Success Criteria: CI on PR #4 passes `ci` and both `smoke` variants, including `npx supabase test db` on a clean database. Locally, lint, `astro check`, the unit tests, the build, the extension build, the worker image build and `npm run db:types` (no diff) pass. Locally, `npx supabase test db` fails 1 of 169 tests because of manual test data (see F9). All manual rows of Phases 1 to 4 have evidence from this session.

## Findings

### F1 — The worker reads any address, including private ones

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: worker/courses/http.ts:76, supabase/migrations/20261124200800_create_courses.sql:109, supabase/migrations/20261124123303_create_jobs.sql:79
- **Detail**: Only `src/lib/courses.ts` checks for a private address. A learner can call PostgREST with the anon key and their own session. They can insert a `crawl` course with `http://10.0.0.5/` and then a `load_course` job. The database checks only `^https?://`, and the job trigger checks only the owner and the kind. The worker fetches the page with `redirect: "follow"` and no address check. The learner then reads the page as lesson Markdown. This also covers the known gaps: a public name that resolves to a private address, and a redirect to a private address.
- **Fix A ⭐ Recommended**: Add an address guard to the worker fetch client. Resolve each host with DNS, reject private, loopback, link-local and metadata addresses, and follow redirects by hand with the same check on each hop.
  - Strength: One check covers every way in (web app, direct PostgREST, DNS, redirects) and every request (robots.txt, start page, lessons).
  - Tradeoff: More code in `http.ts`, and the CI fixture site on `localhost` needs an opt-in flag for the worker, as `ALLOW_PRIVATE_COURSE_URLS` does for the app.
  - Confidence: HIGH — the worker is the only process that sends the requests.
  - Blind spot: A DNS answer can change between the check and the connect. A pinned-address agent closes that gap, but it needs more work.
- **Fix B**: Add a database check that rejects literal private hosts in `courses.source_url`.
  - Strength: Small SQL change, and it stops the direct PostgREST path for literal addresses.
  - Tradeoff: It does not cover DNS names or redirects, so the main gap stays open.
  - Confidence: MED — it closes only one path.
  - Blind spot: IPv6 and encoded forms of addresses are hard to match in SQL.
- **Decision**: FIXED (Fix A)

### F2 — A large robots.txt can stop the worker with out of memory

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: worker/courses/http.ts:102-103
- **Detail**: `sendRequest` reads the whole body with `arrayBuffer()` and checks the 5 MB cap after that. `loadRobotsTxt` (`crawl.ts:153`) uses `sendRequest`. A site that sends a very large robots.txt fills the memory of the container, and the job then gets more starts.
- **Fix**: Read the body in `sendRequest` through the same size limit that `stream()` uses, and stop at 5 MB.
- **Decision**: FIXED

### F3 — A reload can replace good lessons with failed rows

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: worker/handlers/load-course.ts:127-129, supabase/migrations/20261124200800_create_courses.sql:208-214
- **Detail**: `finish_course_load` deletes all lessons and inserts the new list when at least 1 page loads. Example: a reload runs during a partial outage of the site, and 1 of 150 pages loads. The other 149 lessons lose their Markdown and become `failed` rows.
- **Fix A ⭐ Recommended**: In `finish_course_load`, keep the old Markdown for a URL that failed in this crawl but loaded before.
  - Strength: The learner never loses text that the product had. The lesson order still comes from the new crawl.
  - Tradeoff: A lesson can show old text after the site changes it. The function gets more complex.
  - Confidence: MED — the SQL is simple, but a pgTAP test must prove the merge.
  - Blind spot: S-02 and S-05 must accept a lesson that is `loaded` with old text.
- **Fix B**: Fail the reload when fewer than half of the pages load, and keep the old lessons.
  - Strength: Small change in the handler, and `fail_course_load` already keeps the old lessons.
  - Tradeoff: The threshold is a guess. A real site change that removes many pages then always fails.
  - Confidence: MED — the right threshold is not known.
  - Blind spot: No data on real failure rates.
- **Decision**: FIXED (Fix A)

### F4 — The extension functions do not hold the route limits

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261124200900_create_access_tokens.sql:251-252, src/pages/dashboard/courses/[id].astro:46-50
- **Detail**: Anyone with a token can call `extension_save_page` and `extension_start_course` through PostgREST with the anon key. These calls skip the title and URL length limits, the IP rate limit and the private-host check of the routes. The database has no cap on lessons per course. The course page then reads every lesson row in the request path, which has 10 ms of CPU.
- **Fix**: Add the title and URL length checks and a cap of 500 lessons per course inside the two functions, and add `.limit(500)` to the lesson query of the course page.
  - Strength: The database holds the rules for every caller, as it does for the 1 MB Markdown check.
  - Tradeoff: Two limits (route and database) must stay the same.
  - Confidence: HIGH — the functions already check the token and the course owner.
  - Blind spot: The right cap for a long course is not known. 500 is a guess above the 200-lesson crawl cap.
- **Decision**: FIXED

### F5 — A learner can start unlimited course loads

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261124123303_create_jobs.sql:79, supabase/migrations/20261124200800_create_courses.sql:121-157
- **Detail**: A learner can insert `load_course` jobs directly through PostgREST. The one-job-in-progress index runs them one after another, but a script can add a new job after each one ends. Each job reads up to 201 pages and makes one Anthropic call. The Anthropic spend limit caps the model cost, but not the crawl load on other sites.
- **Fix**: In the `load_course` job trigger, allow at most 10 `load_course` jobs for each learner in one hour, and raise a clear error above that.
  - Strength: One SQL rule covers the web app and direct calls.
  - Tradeoff: A learner with many courses waits for the next hour.
  - Confidence: HIGH — the trigger already reads the job owner.
  - Blind spot: The right number is not known.
- **Decision**: FIXED

### F6 — A short robots.txt outage becomes a final "blocked" failure

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: worker/courses/crawl.ts:159-162, worker/handlers/load-course.ts:110
- **Detail**: A robots.txt timeout or a 5xx answer gives `DISALLOW_ALL`. The crawl then reports `blocked`, and the job fails with no retry. The learner reads "This site does not allow automated reads", which is not true for a short outage.
- **Fix**: When robots.txt does not answer, fail the start page as a network error with retry, not as blocked.
- **Decision**: FIXED

### F7 — The extension can convert a crawl course that loaded well

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/migrations/20261124200900_create_access_tokens.sql:171-181, worker/courses/crawl.ts:125
- **Detail**: The comment says the conversion is for blocked sites, but the code also converts a `ready` crawl course. The learner then loses Reload for that course. Crawl lesson URLs can keep a trailing slash, but the extension sends URLs without it, so the same page can get a second lesson row.
- **Fix**: Convert only a `failed` crawl course, and remove the trailing slash from crawl lesson URLs as the extension does.
- **Decision**: FIXED

### F8 — A failed job insert after a reload leaves the course in "loading"

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/courses.ts:222-225
- **Detail**: `reloadCourse` sets the course to `loading`, then inserts the job. A job that starts between the busy check and the insert makes the insert fail. The course then stays in `loading` with no job, and the learner can only delete it. This is the known "stuck loading" item, with its cause found.
- **Fix**: When the job insert fails, set the course back to its old state, or move both steps into one database function.
- **Decision**: FIXED

### F9 — pgTAP test 25 reads courses of other users

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: supabase/tests/access_tokens_test.sql:226-232
- **Detail**: The test selects every course with `source_url like 'https://learn.example.com/%'`. It passes on a clean database (CI), but it fails on a local database that has such a course from a manual check.
- **Fix**: Add `and user_id = '11111111-1111-1111-1111-111111111111'` to the test query.
- **Decision**: FIXED

### F10 — Small hardening items

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/courses/[id].astro:52-59, extension/src/api.ts:52
- **Detail**: The course page finds its newest job by `payload->>courseId`, and `jobs` has no index for it, so each page view scans the table. The extension accepts an `http:` product address, so it can send the token without TLS.
- **Fix**: Add an index on `jobs (user_id, created_at desc)`, and accept `http:` in the extension only for `localhost` and `127.0.0.1`.
- **Decision**: FIXED
