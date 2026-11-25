# Load a Course from Its URL — Plan Brief

> Full plan: `context/changes/load-course-from-url/plan.md`

## What & Why

A learner loads a course into the product and sees its lessons in course order. Every later slice (topic graph, knowledge marks, adjusted path, collapsed passages) reads the stored lessons, so this is the first user-visible step of the product. It is roadmap item S-01.

## Starting Point

The background work path (F-01) is merged: a job table, a worker with a lease and retries, and a status component. The example course site `learn.clickhouse.com` blocks every automated client and its Acceptable Use Policy bars scrapers, while sites such as `clickhouse.com/docs` allow automated reads.

## Desired End State

On `/dashboard/courses` the learner pastes the URL of an open course and sees the lessons in order after a short load. For a blocked site, the learner starts a course in a browser extension and opens each lesson page, and each page appears in the course. Each lesson is stored as Markdown.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Way in for blocked sites | A Chrome-family browser extension, inside S-01 | It reads only the pages that the learner opens, the defensible form under the site policy. |
| Extension behavior | The learner opens each lesson, and the extension saves it | Automated fetching with the learner's account breaks the ClickHouse policy. |
| Extension sign-in | A personal access token from Settings | Revocable, independent of cookies, and stored only as a hash. |
| Browsers | Chrome, Edge and Brave, loaded unpacked | One build and no store review in S-01. |
| Crawler | Crawlee (`JSDOMCrawler`) with `robots.txt` respect | The user asked for a well-known open-source crawler with built-in limits. |
| Lesson finder | Claude Haiku 5.5 reads the start page links once, with a rule fallback | One cheap call per course, and CI runs without a paid key. |
| Lesson text | Markdown, through Readability and Turndown | Later slices split and summarize Markdown by heading. |
| Limit | 200 pages and 1 model call per course | A clear upper bound on cost and time. |
| Second load | Replaces the lessons and keeps the course | One course for each URL, and later slices keep their links. |
| Failed pages | The course loads, and failed lessons are marked | One broken page does not lose the course. |
| Old jobs | Kept for now | The user decided to keep all jobs. |

## Scope

**In scope:**

- Course and lesson tables, and the `load_course` job.
- The crawl with `robots.txt` respect, the lesson finder, and Markdown conversion.
- Course pages with reload and delete.
- Access tokens, the extension, and its routes.
- A CI fixture site, and the production model key from Secret Manager.

**Out of scope:**

- Any way past a bot check.
- An extension that fetches pages by itself.
- A store release, and a Firefox build.
- Lesson text on screen, topic extraction, file uploads, and job cleanup.

## Architecture / Approach

```
Open site:    course page -> start route -> course row + load_course job -> worker (Crawlee -> Claude picks lessons -> Readability -> Markdown) -> lessons
Blocked site: extension (learner opens a page -> Readability -> Markdown) -> extension routes -> token-checking database functions -> lessons
```

The web app never holds the service key: the worker writes through `service_role` functions, and the extension writes through `security definer` functions that check the token.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Course tables and access | Tables, job type, worker and token functions, pgTAP | A gap in the token functions lets one learner write to another's course. |
| 2. Crawl job in the worker | Crawlee crawl, lesson finder, Markdown, worker dependencies | Readability misses the main text on some course sites. |
| 3. Courses in the web app | Load form, course list, ordered lessons, reload | A URL check gap lets a learner point the worker at an internal address. |
| 4. Tokens and the extension | Token settings, extension routes, Chrome MV3 extension | Extension permissions and CORS mistakes. |
| 5. CI and production | Fixture site, smoke steps, phone check, model key | CI timing with a fixture server, a preview and a worker. |

**Prerequisites:** the merged background work path, Docker, Node 26.13.0, and an Anthropic API key for model tests (CI does not need one).

**Estimated effort:** about 5 to 6 sessions. Phase 4 is the largest.

## Open Risks & Assumptions

- The ClickHouse policy says "extract data". Even a page that the learner opens and saves may fall under it. The learner judges that for their own study use.
- Readability works best on article-like pages. Course pages with heavy layout can give thin Markdown, and those lessons show as failed.
- The model can pick wrong links. The rule fallback and the 200-page cap bound the damage, and the learner can delete and reload.
- A load of many pages holds the single worker for minutes, so another learner's job waits.

## Success Criteria (Summary)

- A learner loads an open course from its URL and sees its lessons in course order.
- A learner loads the blocked example course through the extension by opening its lessons.
- CI fails when either path breaks.
