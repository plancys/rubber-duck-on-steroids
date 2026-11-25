# Review fixes: load-course-from-url

Source: `context/changes/load-course-from-url/reviews/impl-review.md` (2026-11-25). The user accepted a fix for each finding.

Put all database changes in one new migration. Do not edit the committed migrations. Add a pgTAP or unit test for each fix.

1. **F1 (Fix A): address guard in the worker.** In `worker/courses/http.ts`, resolve each host with DNS before each request. Reject loopback, private, link-local, CGNAT, multicast, unspecified and metadata addresses, IPv4 and IPv6, including IPv4-mapped IPv6. Follow redirects by hand, with the same check on each hop. The check covers robots.txt, the start page and the lessons. A rejected start page fails at once with a safe reason. A rejected lesson is a failed lesson. The env value `ALLOW_PRIVATE_COURSE_URLS=true` turns the check off for local work and CI only. Production never sets it.
2. **F2: stream limit in `sendRequest`.** Read the body through the 5 MB limit, and stop at the limit.
3. **F3 (Fix A): keep old text on a reload.** In `finish_course_load`, a new lesson that failed keeps the old Markdown when the same URL loaded before.
4. **F4: limits in the extension functions.** `extension_start_course` and `extension_save_page` check the same title and URL lengths as the routes. A course holds at most 500 lessons. The course page reads at most 500 lessons.
5. **F5: load quota.** The `load_course` job trigger allows at most 10 `load_course` jobs for each learner in one hour. The routes show a clear error above that.
6. **F6: robots.txt outage.** When robots.txt does not answer (network error, timeout, 5xx), the start page fails as a network error with retry, not as blocked.
7. **F7: conversion and lesson URLs.** `extension_start_course` converts only a `failed` crawl course. A `ready` or `loading` crawl course gives a clear error. Crawl lesson URLs have no trailing slash, as in the extension.
8. **F8: reload in one step.** One database function sets the course to `loading` and inserts the job. A failed insert leaves the course in its old state.
9. **F9: scoped test.** pgTAP test 25 in `access_tokens_test.sql` reads only the courses of its test user.
10. **F10: hardening.** Add an index on `jobs (user_id, created_at desc)`. The extension accepts an `http:` product address only for `localhost` and `127.0.0.1`.
