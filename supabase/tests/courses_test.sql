-- This test proves the access rules and the course rules of public.courses and public.lessons.
-- A learner creates a course, reads their own courses and lessons, and deletes their own course.
-- Only the worker functions and reload_course change a course. Only the worker functions write the lessons of a crawl course.
-- The test runs in one transaction and rolls back at the end.

begin;

create extension if not exists pgtap with schema extensions;

select plan(59);

-- Create two users as the superuser.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'first@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'second@example.com');

-- The anon role has no access to courses and lessons.
set local role anon;

select throws_ok(
  $$ select * from public.courses $$,
  '42501',
  null,
  'anon cannot select courses'
);

select throws_ok(
  $$ select * from public.lessons $$,
  '42501',
  null,
  'anon cannot select lessons'
);

select throws_ok(
  $$ insert into public.courses (source_url, source_kind) values ('https://example.com/course', 'crawl') $$,
  '42501',
  null,
  'anon cannot insert courses'
);

select throws_ok(
  $$ select public.reload_course('00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'anon cannot execute reload_course'
);

-- A learner creates a course. The defaults set the owner and the state.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ insert into public.courses (source_url, source_kind)
     values ('https://example.com/course', 'crawl')
     returning user_id, source_kind, status, error is null, loaded_at is null $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'crawl'::text, 'loading'::text, true, true) $$,
  'a learner can insert a course and the defaults set the owner and the state'
);

select throws_ok(
  $$ insert into public.courses (source_url, source_kind) values ('https://example.com/course', 'crawl') $$,
  '23505',
  null,
  'a learner cannot insert a second course with the same source URL'
);

-- A learner sets only the source URL and the source kind of a new course.
select throws_ok(
  $$ insert into public.courses (source_url, source_kind, status)
     values ('https://example.com/other', 'crawl', 'ready') $$,
  '42501',
  null,
  'a learner cannot insert a course with a status of their choice'
);

select throws_ok(
  $$ insert into public.courses (source_url, source_kind, user_id)
     values ('https://example.com/other', 'crawl', '22222222-2222-2222-2222-222222222222') $$,
  '42501',
  null,
  'a learner cannot insert a course with an owner of their choice'
);

-- The column checks reject a URL that is not normalized and a source kind that does not exist.
select throws_ok(
  $$ insert into public.courses (source_url, source_kind) values ('https://example.com/other/', 'crawl') $$,
  '23514',
  null,
  'a source URL with a trailing slash is rejected'
);

select throws_ok(
  $$ insert into public.courses (source_url, source_kind) values ('https://example.com/other#intro', 'crawl') $$,
  '23514',
  null,
  'a source URL with a fragment is rejected'
);

select throws_ok(
  $$ insert into public.courses (source_url, source_kind) values ('ftp://example.com/other', 'crawl') $$,
  '23514',
  null,
  'a source URL that is not http or https is rejected'
);

select throws_ok(
  $$ insert into public.courses (source_url, source_kind) values ('https://example.com/other', 'upload') $$,
  '23514',
  null,
  'a source kind other than crawl and extension is rejected'
);

-- A learner cannot change a course or write a lesson.
select throws_ok(
  $$ update public.courses set status = 'ready' $$,
  '42501',
  null,
  'a learner cannot update a course'
);

select throws_ok(
  $$ truncate public.courses $$,
  '42501',
  null,
  'a learner cannot truncate courses'
);

select throws_ok(
  $$ insert into public.lessons (course_id, user_id, position, url, status)
     values ((select id from public.courses limit 1), '11111111-1111-1111-1111-111111111111', 1,
             'https://example.com/course/one', 'loaded') $$,
  '42501',
  null,
  'a learner cannot insert a lesson'
);

select throws_ok(
  $$ update public.lessons set title = 'Changed' $$,
  '42501',
  null,
  'a learner cannot update a lesson'
);

select throws_ok(
  $$ delete from public.lessons $$,
  '42501',
  null,
  'a learner cannot delete a lesson'
);

-- A second learner can load the same URL. The URL is unique for each learner, not for all learners.
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select results_eq(
  $$ insert into public.courses (source_url, source_kind)
     values ('https://example.com/course', 'crawl')
     returning user_id $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid) $$,
  'a second learner can insert a course with the same source URL'
);

select results_eq(
  $$ select user_id from public.courses $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid) $$,
  'a learner reads only their own courses'
);

-- The next tests start from fixed courses and lessons.
-- Course 1 is a ready crawl course of the first learner with 2 lessons. Course 2 is a ready crawl course of the second learner.
-- Course 3 is an extension course of the first learner. Course 4 is an extension course of the second learner.
reset role;
delete from public.courses;

insert into public.courses (id, user_id, source_url, title, source_kind, status, loaded_at)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course', 'Old title', 'crawl', 'ready', now() - interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'https://example.com/course', 'Course of the second learner', 'crawl', 'ready', now() - interval '1 day'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'https://blocked.example.com/course', 'Extension course', 'extension', 'ready', null),
  ('cccccccc-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'https://blocked.example.com/course', 'Extension course', 'extension', 'ready', null);

insert into public.lessons (course_id, user_id, position, title, url, markdown, status)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, 'Old one',
   'https://example.com/course/old-one', '# Old one', 'loaded'),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, 'Old two',
   'https://example.com/course/old-two', '# Old two', 'loaded'),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 1, 'Second one',
   'https://example.com/course/second-one', '# Second one', 'loaded');

-- A lesson always has the owner of its course.
select throws_ok(
  $$ insert into public.lessons (course_id, user_id, position, url, status)
     values ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 3,
             'https://example.com/course/three', 'loaded') $$,
  '23503',
  null,
  'a lesson with an owner other than the owner of its course is rejected'
);

-- A learner reads only their own lessons.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select position, title from public.lessons order by position $$,
  $$ values (1, 'Old one'::text), (2, 'Old two'::text) $$,
  'a learner reads only their own lessons'
);

-- A learner cannot call the worker functions.
select throws_ok(
  $$ select * from public.start_course_load('cccccccc-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'a learner cannot execute start_course_load'
);

select throws_ok(
  $$ select public.finish_course_load('cccccccc-0000-0000-0000-000000000001', 'Title', '[]') $$,
  '42501',
  null,
  'a learner cannot execute finish_course_load'
);

select throws_ok(
  $$ select public.fail_course_load('cccccccc-0000-0000-0000-000000000001', 'Reason') $$,
  '42501',
  null,
  'a learner cannot execute fail_course_load'
);

-- A load_course job holds the id of a crawl course of the same learner.
select lives_ok(
  $$ insert into public.jobs (type, payload)
     values ('load_course', '{"courseId": "cccccccc-0000-0000-0000-000000000001"}') $$,
  'a learner can insert a load_course job for their own crawl course'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$ insert into public.jobs (type, payload)
     values ('load_course', '{"courseId": "cccccccc-0000-0000-0000-000000000001"}') $$,
  '23514',
  null,
  'a learner cannot insert a load_course job for the course of a different learner'
);

select throws_ok(
  $$ insert into public.jobs (type, payload)
     values ('load_course', '{"courseId": "cccccccc-0000-0000-0000-000000000004"}') $$,
  '23514',
  null,
  'a learner cannot insert a load_course job for an extension course'
);

select throws_ok(
  $$ insert into public.jobs (type, payload) values ('load_course', '{"courseId": "not-a-uuid"}') $$,
  '23514',
  null,
  'a load_course job with a courseId that is not a uuid is rejected'
);

select throws_ok(
  $$ insert into public.jobs (type, payload) values ('load_course', '{}') $$,
  '23514',
  null,
  'a load_course job without a courseId is rejected'
);

-- reload_course works only for the owner of a crawl course, and not while the course loads.
-- It sets the course loading and inserts the load_course job in one call, and returns the job id.
select is(
  public.reload_course('cccccccc-0000-0000-0000-000000000001'),
  null::uuid,
  'reload_course does nothing for the course of a different learner'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  public.reload_course('cccccccc-0000-0000-0000-000000000003'),
  null::uuid,
  'reload_course does nothing for an extension course'
);

-- The first learner has a job in progress: the load_course job above. The job insert fails, so the whole call fails.
select throws_ok(
  $$ select public.reload_course('cccccccc-0000-0000-0000-000000000001') $$,
  '23505',
  null,
  'reload_course fails when the learner has a job in progress'
);

select results_eq(
  $$ select status from public.courses where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  $$ values ('ready'::text) $$,
  'a reload_course that fails leaves the course in its old state'
);

reset role;
delete from public.jobs where user_id = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select isnt(
  public.reload_course('cccccccc-0000-0000-0000-000000000001'),
  null::uuid,
  'reload_course returns a job id for the owner of a ready crawl course'
);

select results_eq(
  $$ select c.status, c.error is null, j.type, j.status, j.user_id
     from public.courses as c
     join public.jobs as j on j.payload ->> 'courseId' = c.id::text
     where c.id = 'cccccccc-0000-0000-0000-000000000001' $$,
  $$ values ('loading'::text, true, 'load_course'::text, 'waiting'::text, '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'reload_course sets the course loading, clears the error and inserts the load_course job of the learner'
);

select is(
  public.reload_course('cccccccc-0000-0000-0000-000000000001'),
  null::uuid,
  'reload_course does nothing while the course loads'
);

-- A learner starts at most 10 course loads in one hour. The second learner has 10 load jobs from the last hour.
reset role;
insert into public.jobs (user_id, type, payload, status, created_at)
select '22222222-2222-2222-2222-222222222222', 'load_course',
       '{"courseId": "cccccccc-0000-0000-0000-000000000002"}', 'done', now() - interval '30 minutes'
from generate_series(1, 10);

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$ insert into public.jobs (type, payload)
     values ('load_course', '{"courseId": "cccccccc-0000-0000-0000-000000000002"}') $$,
  'RD001',
  null,
  'a learner cannot start an eleventh course load in one hour'
);

select throws_ok(
  $$ select public.reload_course('cccccccc-0000-0000-0000-000000000002') $$,
  'RD001',
  null,
  'reload_course fails above the load quota'
);

select results_eq(
  $$ select status from public.courses where id = 'cccccccc-0000-0000-0000-000000000002' $$,
  $$ values ('ready'::text) $$,
  'a reload above the load quota leaves the course in its old state'
);

reset role;
update public.jobs
set created_at = now() - interval '61 minutes'
where user_id = '22222222-2222-2222-2222-222222222222';

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select lives_ok(
  $$ insert into public.jobs (type, payload)
     values ('load_course', '{"courseId": "cccccccc-0000-0000-0000-000000000002"}') $$,
  'a load job that is older than one hour does not count toward the load quota'
);

-- The worker functions.
reset role;
set local role service_role;

select results_eq(
  $$ select id, source_url, status from public.start_course_load('cccccccc-0000-0000-0000-000000000001') $$,
  $$ values ('cccccccc-0000-0000-0000-000000000001'::uuid, 'https://example.com/course'::text, 'loading'::text) $$,
  'start_course_load returns the course with its source URL'
);

select is_empty(
  $$ select id from public.start_course_load('cccccccc-0000-0000-0000-000000000003') $$,
  'start_course_load returns no row for an extension course'
);

-- A bad lesson list changes nothing, because the replace is one transaction.
select throws_ok(
  $$ select public.finish_course_load('cccccccc-0000-0000-0000-000000000001', 'New title',
       '[{"position": 1, "url": "https://example.com/course/one", "status": "loaded"},
         {"position": 1, "url": "https://example.com/course/two", "status": "loaded"}]') $$,
  '23505',
  null,
  'finish_course_load rejects two lessons with the same position'
);

select throws_ok(
  $$ select public.finish_course_load('cccccccc-0000-0000-0000-000000000001', 'New title',
       jsonb_build_array(jsonb_build_object(
         'position', 1, 'url', 'https://example.com/course/one', 'status', 'loaded',
         'markdown', repeat('a', 1048577)))) $$,
  '23514',
  null,
  'finish_course_load rejects a lesson with more than 1 MB of Markdown'
);

select results_eq(
  $$ select c.status, c.title, (select count(*) from public.lessons as l where l.course_id = c.id)
     from public.courses as c
     where c.id = 'cccccccc-0000-0000-0000-000000000001' $$,
  $$ values ('loading'::text, 'Old title'::text, 2::bigint) $$,
  'a rejected finish_course_load keeps the old lessons and the old title'
);

select ok(
  public.finish_course_load('cccccccc-0000-0000-0000-000000000001', 'New title',
    '[{"position": 1, "title": "One", "url": "https://example.com/course/one", "markdown": "# One",
       "status": "loaded", "error": null},
      {"position": 2, "title": "Two", "url": "https://example.com/course/two", "markdown": "# Two",
       "status": "loaded", "error": null},
      {"position": 3, "title": "Three", "url": "https://example.com/course/three", "markdown": null,
       "status": "failed", "error": "The page answered 404."}]'),
  'finish_course_load returns true for a course that loads'
);

select results_eq(
  $$ select position, title, status, error, user_id
     from public.lessons
     where course_id = 'cccccccc-0000-0000-0000-000000000001'
     order by position $$,
  $$ values
       (1, 'One'::text, 'loaded'::text, null::text, '11111111-1111-1111-1111-111111111111'::uuid),
       (2, 'Two'::text, 'loaded'::text, null::text, '11111111-1111-1111-1111-111111111111'::uuid),
       (3, 'Three'::text, 'failed'::text, 'The page answered 404.'::text, '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'finish_course_load replaces all old lessons with the new lessons in one call'
);

select results_eq(
  $$ select status, title, error is null, loaded_at = now()
     from public.courses
     where id = 'cccccccc-0000-0000-0000-000000000001' $$,
  $$ values ('ready'::text, 'New title'::text, true, true) $$,
  'finish_course_load sets ready, the title and loaded_at'
);

select is(
  public.finish_course_load('cccccccc-0000-0000-0000-000000000001', 'Later title', '[]'),
  false,
  'finish_course_load returns false for a course that does not load'
);

-- A reload keeps the old text of a lesson that loaded before and fails now. The order comes from the new crawl.
select results_eq(
  $$ select status from public.start_course_load('cccccccc-0000-0000-0000-000000000001') $$,
  $$ values ('loading'::text) $$,
  'start_course_load sets a ready course loading for a reload'
);

select ok(
  public.finish_course_load('cccccccc-0000-0000-0000-000000000001', 'New title',
    '[{"position": 1, "title": "Two", "url": "https://example.com/course/two", "markdown": "# Two new",
       "status": "loaded", "error": null},
      {"position": 2, "title": "One link", "url": "https://example.com/course/one", "markdown": null,
       "status": "failed", "error": "The page answered with status 503."},
      {"position": 3, "title": "Three", "url": "https://example.com/course/three", "markdown": null,
       "status": "failed", "error": "The page answered 404."}]'),
  'finish_course_load returns true for a reload'
);

select results_eq(
  $$ select position, title, url, markdown, status, error
     from public.lessons
     where course_id = 'cccccccc-0000-0000-0000-000000000001'
     order by position $$,
  $$ values
       (1, 'Two'::text, 'https://example.com/course/two'::text, '# Two new'::text, 'loaded'::text, null::text),
       (2, 'One'::text, 'https://example.com/course/one'::text, '# One'::text, 'loaded'::text, null::text),
       (3, 'Three'::text, 'https://example.com/course/three'::text, null::text, 'failed'::text,
        'The page answered 404.'::text) $$,
  'finish_course_load keeps the old text of a lesson that loaded before and fails in the reload'
);

-- fail_course_load keeps the lessons of the last load.
select results_eq(
  $$ select status from public.start_course_load('cccccccc-0000-0000-0000-000000000001') $$,
  $$ values ('loading'::text) $$,
  'start_course_load sets a ready course loading again'
);

select ok(
  public.fail_course_load('cccccccc-0000-0000-0000-000000000001', 'This site does not allow automated reads.'),
  'fail_course_load returns true for a course that loads'
);

select results_eq(
  $$ select c.status, c.error, (select count(*) from public.lessons as l where l.course_id = c.id)
     from public.courses as c
     where c.id = 'cccccccc-0000-0000-0000-000000000001' $$,
  $$ values ('failed'::text, 'This site does not allow automated reads.'::text, 3::bigint) $$,
  'fail_course_load sets failed and the error, and keeps the old lessons'
);

select throws_ok(
  $$ select public.reload_course('cccccccc-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'service_role cannot execute reload_course'
);

-- A learner deletes only their own course. The lessons of the course go with it.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is_empty(
  $$ delete from public.courses where id = 'cccccccc-0000-0000-0000-000000000001' returning id $$,
  'a learner deletes no course of a different learner'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ delete from public.courses where id = 'cccccccc-0000-0000-0000-000000000001' returning id $$,
  $$ values ('cccccccc-0000-0000-0000-000000000001'::uuid) $$,
  'a learner can delete their own course'
);

reset role;

select is_empty(
  $$ select id from public.lessons where course_id = 'cccccccc-0000-0000-0000-000000000001' $$,
  'the lessons of a deleted course are gone'
);

select * from finish();

rollback;
