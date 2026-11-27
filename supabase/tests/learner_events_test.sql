-- This test proves the access rules, the insert check, the cascade and the read functions of the learner events.
-- A learner inserts and reads only their own events. Nobody updates or deletes an event. Anonymous users get nothing.
-- An event needs a topic of the course of the event. A course delete removes the events of the course.
-- course_topic_list gives the live topics of a course, and learner_course_events gives the events of the caller.
-- Each query reads only the fixed users and courses of this test, so local data does not change a result.
-- The test runs in one transaction and rolls back at the end.

begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

-- Create two users as the superuser.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'first@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'second@example.com');

-- Course 1 and course 2 are ready crawl courses of the first learner. The second learner has no course.
insert into public.courses (id, user_id, source_url, title, source_kind, status, loaded_at)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course', 'Course one', 'crawl', 'ready', now()),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'https://example.com/ponds', 'Course two', 'crawl', 'ready', now());

insert into public.lessons (course_id, user_id, position, title, url, markdown, status)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, 'One',
   'https://example.com/course/one', '# One Ducks swim. Birds fly.', 'loaded'),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, 'Two',
   'https://example.com/course/two', '# Two Feathers and bills.', 'loaded'),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 3, 'Three',
   'https://example.com/course/three', '# Three Wings and mud.', 'loaded'),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 1, 'Ponds',
   'https://example.com/ponds/one', '# Ponds Ducks live in ponds.', 'loaded');

-- The superuser inserts the maps of both courses. The topic map test proves the worker functions that write a map.
-- Course 1 has passages 1 and 2 in lesson one and passage 3 in lesson two. Course 2 has passage 4.
insert into public.passages (id, course_id, user_id, lesson_url, lesson_hash, position, start_offset, end_offset,
                             content_hash)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/one', 'one', 1, 6, 17, 'one-1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/one', 'one', 2, 18, 28, 'one-2'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/two', 'two', 1, 6, 25, 'two-1'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/ponds/one', 'ponds', 1, 8, 28, 'ponds-1');

-- Ducks belongs to both courses, and Ponds belongs to course 2 only. Wings is merged into Ducks, and Mud is retired.
-- A map build gives a merged or a retired topic no home lesson. Here Wings and Mud keep the home lesson three,
-- so the topic list must leave them out by their state.
insert into public.topics (id, user_id, name, description, merged_into, retired_at)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ducks', 'A water bird.',
   null, null),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Birds', 'Animals with feathers.',
   null, null),
  ('dddddddd-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Feathers', 'The cover of a bird.',
   null, null),
  ('dddddddd-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Bills', null,
   null, null),
  ('dddddddd-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Wings', 'A part of a bird.',
   'dddddddd-0000-0000-0000-000000000001', null),
  ('dddddddd-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Mud', 'Wet earth.',
   null, now()),
  ('dddddddd-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Ponds', 'Small lakes.',
   null, null);

insert into public.course_topics (course_id, topic_id, user_id, home_lesson_url)
values
  ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/one'),
  ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/one'),
  ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/two'),
  ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/two'),
  ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000005',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/three'),
  ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000006',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/three'),
  ('cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/ponds/one'),
  ('cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000007',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/ponds/one');

-- In lesson one, Ducks has the first link. The link of Birds in passage 1 points at an old text, so it does not count.
-- In lesson two, Bills and Feathers have their first link in the same passage, so the name decides.
insert into public.topic_links (topic_id, passage_id, user_id, passage_hash, role, quote, quote_start)
values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'one-1', 'explains', 'Ducks swim.', 0),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'one-1-old', 'mentions', 'Birds', 0),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'one-2', 'explains', 'Birds fly.', 0),
  ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'two-1', 'explains', 'Feathers', 0),
  ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'two-1', 'mentions', 'bills', 0);

-- Feathers is a part of Ducks and a part of Birds, so its parent is Birds, the first parent by name.
-- Ducks has no parent in course 1. A prerequisite relation gives no parent,
-- and the part_of relation to Ponds has its source passage in course 2.
insert into public.topic_relations (user_id, kind, from_topic_id, to_topic_id, reason, source_passage_id)
values
  ('11111111-1111-1111-1111-111111111111', 'part_of', 'dddddddd-0000-0000-0000-000000000003',
   'dddddddd-0000-0000-0000-000000000001', 'Feathers cover a duck.', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('11111111-1111-1111-1111-111111111111', 'part_of', 'dddddddd-0000-0000-0000-000000000003',
   'dddddddd-0000-0000-0000-000000000002', 'Feathers cover a bird.', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('11111111-1111-1111-1111-111111111111', 'prerequisite', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000003', 'Ducks come before feathers.', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('11111111-1111-1111-1111-111111111111', 'part_of', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000007', 'Ducks live in ponds.', 'aaaaaaaa-0000-0000-0000-000000000004');

-- The access rules of the table and the functions.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.learner_events'::regclass),
  'row-level security is on for learner_events'
);

select is_empty(
  $$ select r.name, f.name
     from unnest(array['anon', 'service_role']) as r(name)
     cross join unnest(array['public.course_topic_list(uuid)', 'public.learner_course_events(uuid)']) as f(name)
     where has_function_privilege(r.name, f.name, 'EXECUTE') $$,
  'anon and service_role cannot execute a read function of the marks'
);

select is_empty(
  $$ select f.name
     from unnest(array['public.course_topic_list(uuid)', 'public.learner_course_events(uuid)']) as f(name)
     where not has_function_privilege('authenticated', f.name, 'EXECUTE') $$,
  'authenticated can execute each read function of the marks'
);

-- anon reads and writes no event.
set local role anon;

select throws_ok(
  $$ select * from public.learner_events $$,
  '42501',
  null,
  'anon cannot select learner events'
);

select throws_ok(
  $$ insert into public.learner_events (course_id, topic_id, kind)
     values ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'mark_known') $$,
  '42501',
  null,
  'anon cannot insert a learner event'
);

-- A learner marks a topic of their course, removes the mark, and reads both events back.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select lives_ok(
  $$ insert into public.learner_events (course_id, topic_id, kind)
     values
       ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'mark_known'),
       ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'unmark_known') $$,
  'a learner can insert a mark and an unmark of a topic of their course'
);

select results_eq(
  $$ select user_id, course_id, topic_id, kind
     from public.learner_events
     order by kind $$,
  $$ values
       ('11111111-1111-1111-1111-111111111111'::uuid, 'cccccccc-0000-0000-0000-000000000001'::uuid,
        'dddddddd-0000-0000-0000-000000000001'::uuid, 'mark_known'::text),
       ('11111111-1111-1111-1111-111111111111'::uuid, 'cccccccc-0000-0000-0000-000000000001'::uuid,
        'dddddddd-0000-0000-0000-000000000001'::uuid, 'unmark_known'::text) $$,
  'a learner reads back their events, and the owner of each event is the learner'
);

-- A learner sets only the course, the topic and the kind, and never changes an event.
select throws_ok(
  $$ insert into public.learner_events (user_id, course_id, topic_id, kind)
     values ('22222222-2222-2222-2222-222222222222', 'cccccccc-0000-0000-0000-000000000001',
             'dddddddd-0000-0000-0000-000000000001', 'mark_known') $$,
  '42501',
  null,
  'a learner cannot insert an event with an owner of their choice'
);

select throws_ok(
  $$ update public.learner_events set kind = 'mark_known' $$,
  '42501',
  null,
  'a learner cannot update an event'
);

select throws_ok(
  $$ delete from public.learner_events $$,
  '42501',
  null,
  'a learner cannot delete an event'
);

-- Row-level security does not apply to TRUNCATE, so the grant must stop it.
select throws_ok(
  $$ truncate public.learner_events $$,
  '42501',
  null,
  'a learner cannot truncate the events'
);

-- Ducks is a topic of course 1, so the insert check passes and the kind check stops the insert.
select throws_ok(
  $$ insert into public.learner_events (course_id, topic_id, kind)
     values ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'known') $$,
  '23514',
  'new row for relation "learner_events" violates check constraint "learner_events_kind_check"',
  'a learner cannot insert an event of an unknown kind'
);

-- The insert check. Ponds is a topic of course 2 only.
select throws_ok(
  $$ insert into public.learner_events (course_id, topic_id, kind)
     values ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000007', 'mark_known') $$,
  '23514',
  'A learner event needs a topic of the course of the event.',
  'a learner cannot insert an event for a topic of a different course'
);

select lives_ok(
  $$ insert into public.learner_events (course_id, topic_id, kind)
     values ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000005', 'mark_known') $$,
  'a merged topic of the course passes the insert check'
);

select lives_ok(
  $$ insert into public.learner_events (course_id, topic_id, kind)
     values ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000006', 'mark_known') $$,
  'a retired topic of the course passes the insert check'
);

-- The topic list of course 1.
select is(
  public.course_topic_list('cccccccc-0000-0000-0000-000000000001') -> 'lessons',
  '[{"url": "https://example.com/course/one", "position": 1, "title": "One"},
    {"url": "https://example.com/course/two", "position": 2, "title": "Two"}]'::jsonb,
  'course_topic_list gives each lesson with a live topic, in course order'
);

select is(
  public.course_topic_list('cccccccc-0000-0000-0000-000000000001') -> 'topics',
  '[{"id": "dddddddd-0000-0000-0000-000000000001", "name": "Ducks", "description": "A water bird.",
     "home_lesson_url": "https://example.com/course/one", "parent_id": null},
    {"id": "dddddddd-0000-0000-0000-000000000002", "name": "Birds", "description": "Animals with feathers.",
     "home_lesson_url": "https://example.com/course/one", "parent_id": null},
    {"id": "dddddddd-0000-0000-0000-000000000004", "name": "Bills", "description": null,
     "home_lesson_url": "https://example.com/course/two", "parent_id": null},
    {"id": "dddddddd-0000-0000-0000-000000000003", "name": "Feathers", "description": "The cover of a bird.",
     "home_lesson_url": "https://example.com/course/two", "parent_id": "dddddddd-0000-0000-0000-000000000002"}]'::jsonb,
  'course_topic_list gives the live topics by home lesson, first link and name, with the parent'
);

select is(
  public.course_topic_list('cccccccc-0000-0000-0000-000000000001') -> 'merged',
  '[{"id": "dddddddd-0000-0000-0000-000000000005", "merged_into": "dddddddd-0000-0000-0000-000000000001"}]'::jsonb,
  'course_topic_list gives each merged topic of the course with the topic that replaces it'
);

-- The superuser inserts three events of course 2 with fixed times. Two of them have the same time.
reset role;

insert into public.learner_events (id, user_id, course_id, topic_id, kind, created_at)
values
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000007', 'mark_known',
   '2026-01-01 10:00:00+00'),
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000007', 'unmark_known',
   '2026-01-01 10:00:00+00'),
  ('eeeeeeee-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'cccccccc-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'mark_known',
   '2026-01-01 09:00:00+00');

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select x.e - 'created_at', (x.e ->> 'created_at')::timestamptz
     from jsonb_array_elements(public.learner_course_events('cccccccc-0000-0000-0000-000000000002'))
       with ordinality as x(e, n)
     order by x.n $$,
  $$ values
       ('{"id": "eeeeeeee-0000-0000-0000-000000000003", "topic_id": "dddddddd-0000-0000-0000-000000000001",
          "kind": "mark_known"}'::jsonb, '2026-01-01 09:00:00+00'::timestamptz),
       ('{"id": "eeeeeeee-0000-0000-0000-000000000001", "topic_id": "dddddddd-0000-0000-0000-000000000007",
          "kind": "unmark_known"}'::jsonb, '2026-01-01 10:00:00+00'::timestamptz),
       ('{"id": "eeeeeeee-0000-0000-0000-000000000002", "topic_id": "dddddddd-0000-0000-0000-000000000007",
          "kind": "mark_known"}'::jsonb, '2026-01-01 10:00:00+00'::timestamptz) $$,
  'learner_course_events gives the events of one course in the order created_at, id'
);

-- The second learner gets no event and no topic of the first learner.
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is_empty(
  $$ select id from public.learner_events $$,
  'the second learner reads no event of the first learner'
);

select is(
  public.learner_course_events('cccccccc-0000-0000-0000-000000000001'),
  '[]'::jsonb,
  'learner_course_events gives an empty array for the course of a different learner'
);

select is(
  public.course_topic_list('cccccccc-0000-0000-0000-000000000001'),
  null::jsonb,
  'course_topic_list gives null for the course of a different learner'
);

-- Row-level security hides the course topics of the first learner, so the insert check stops the insert.
select throws_ok(
  $$ insert into public.learner_events (course_id, topic_id, kind)
     values ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'mark_known') $$,
  '23514',
  'A learner event needs a topic of the course of the event.',
  'a learner cannot insert an event for the course of a different learner'
);

-- A course delete removes the events of the course. The delete removes the topics of course 1, and their events go
-- with them. Ducks stays, because course 2 holds it, so the cascade of the course removes the events of Ducks.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ delete from public.courses where id = 'cccccccc-0000-0000-0000-000000000001' returning id $$,
  $$ values ('cccccccc-0000-0000-0000-000000000001'::uuid) $$,
  'a learner can delete a course with events'
);

reset role;

select results_eq(
  $$ select
       (select count(*) from public.learner_events where course_id = 'cccccccc-0000-0000-0000-000000000001'),
       (select count(*) from public.learner_events where course_id = 'cccccccc-0000-0000-0000-000000000002'),
       (select count(*) from public.topics where id = 'dddddddd-0000-0000-0000-000000000001') $$,
  $$ values (0::bigint, 3::bigint, 1::bigint) $$,
  'a course delete removes the events of the course and keeps the events of the other course'
);

select * from finish();

rollback;
