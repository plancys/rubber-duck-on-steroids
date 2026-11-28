-- This test proves the access rule, each part of the document of course_lesson_map, and rule 6.
-- Only a signed-in learner executes the function, and it gives null for the course of a different learner.
-- The function reads no learner table, so it does not join the map with the events.
-- Each query reads only the fixed users and course of this test, so local data does not change a result.
-- The test runs in one transaction and rolls back at the end.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- Create two users as the superuser.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'first@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'second@example.com');

-- The course is a ready crawl course of the first learner. The second learner has no course.
insert into public.courses (id, user_id, source_url, title, source_kind, status, loaded_at)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course', 'Course one', 'crawl', 'ready', now());

-- The lessons one to five loaded. The lesson missing failed to load.
insert into public.lessons (course_id, user_id, position, title, url, markdown, status, error)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, 'One',
   'https://example.com/course/one', '# One Ducks swim. Birds fly.', 'loaded', null),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, 'Two',
   'https://example.com/course/two', '# Two Feathers and bills.', 'loaded', null),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 3, 'Three',
   'https://example.com/course/three', '# Three Wings and mud.', 'loaded', null),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 4, 'Four',
   'https://example.com/course/four', '# Four Reeds grow.', 'loaded', null),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 5, 'Five',
   'https://example.com/course/five', '# Five Ducks drink water.', 'loaded', null),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 6, 'Missing',
   'https://example.com/course/missing', null, 'failed', 'The page answered 404.');

-- The last map build of the course. The test runs in one transaction, where now() does not move,
-- so the map and each analysis get a fixed time.
insert into public.course_maps (course_id, user_id, built_at)
values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-01-01 10:00:00+00');

-- The analyses of the lessons:
-- one: current. It read the text of the lesson, and it is older than the map.
-- two: changed by hash. It read an old text of the lesson.
-- three: failed. It is newer than the map, so the test also proves that failed comes before changed.
-- four: no analysis.
-- five: changed by time. A build stored it after the map, and no finish followed.
-- missing: the lesson failed to load, so the analysis from before the reload does not count.
insert into public.lesson_analyses (course_id, user_id, lesson_url, content_hash, status, error, analysed_at)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course/one', md5('# One Ducks swim. Birds fly.'), 'analysed', null,
   '2026-01-01 09:00:00+00'),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course/two', md5('# Two An old text.'), 'analysed', null,
   '2026-01-01 09:00:00+00'),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course/three', md5('# Three Wings and mud.'), 'failed', 'The engine gave no valid answer.',
   '2026-01-01 11:00:00+00'),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course/five', md5('# Five Ducks drink water.'), 'analysed', null,
   '2026-01-01 11:00:00+00'),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course/missing', 'missing-old', 'analysed', null,
   '2026-01-01 09:00:00+00');

-- The passages: 1 and 2 in lesson one, 3 in lesson two, 4 in lesson three, and 5 and 6 in lesson five.
-- The failed analysis of lesson three keeps the passage of its last good analysis.
-- The new analysis of lesson five gave passage 6 a new text.
insert into public.passages (id, course_id, user_id, lesson_url, lesson_hash, position, start_offset, end_offset,
                             content_hash)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/one', 'one', 1, 6, 17, 'one-1'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/one', 'one', 2, 18, 28, 'one-2'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/two', 'two', 1, 6, 25, 'two-1'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/three', 'three', 1, 8, 21, 'three-1'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/five', 'five', 1, 7, 17, 'five-1'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'cccccccc-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/five', 'five', 2, 18, 24, 'five-2');

-- Ducks, Birds, Feathers, Bills and Water are live topics with a home lesson. Wings is merged into Ducks, and Mud is
-- retired. A map build gives a merged or a retired topic no home lesson. Here Wings and Mud keep the home lesson three,
-- so the function must leave them out by their state. Reeds is live, but it has no home lesson in the course.
insert into public.topics (id, user_id, name, merged_into, retired_at)
values
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ducks', null, null),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Birds', null, null),
  ('dddddddd-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Feathers', null, null),
  ('dddddddd-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Bills', null, null),
  ('dddddddd-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Wings',
   'dddddddd-0000-0000-0000-000000000001', null),
  ('dddddddd-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Mud', null, now()),
  ('dddddddd-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Water', null, null),
  ('dddddddd-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Reeds', null, null);

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
  ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000007',
   '11111111-1111-1111-1111-111111111111', 'https://example.com/course/five'),
  ('cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000008',
   '11111111-1111-1111-1111-111111111111', null);

-- The links. Ducks has two explains links in lesson one, so the pair of lesson one and Ducks shows once.
-- Ducks also has an explains link in lesson five, which is not its home lesson.
-- Birds has a mentions link in lesson two, and Bills has only a mentions link.
-- Wings and Mud have explains links in lesson three.
-- The link of Water in passage 6 points at the old text of the passage, so it does not count.
insert into public.topic_links (topic_id, passage_id, user_id, passage_hash, role, quote, quote_start)
values
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'one-1', 'explains', 'Ducks swim.', 0),
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'one-2', 'explains', 'fly', 0),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'one-2', 'explains', 'Birds fly.', 0),
  ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'two-1', 'mentions', 'Feathers', 0),
  ('dddddddd-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'two-1', 'explains', 'Feathers', 0),
  ('dddddddd-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'two-1', 'mentions', 'bills', 0),
  ('dddddddd-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111', 'three-1', 'explains', 'Wings', 0),
  ('dddddddd-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000004',
   '11111111-1111-1111-1111-111111111111', 'three-1', 'explains', 'mud', 0),
  ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000005',
   '11111111-1111-1111-1111-111111111111', 'five-1', 'explains', 'Ducks drink', 0),
  ('dddddddd-0000-0000-0000-000000000007', 'aaaaaaaa-0000-0000-0000-000000000006',
   '11111111-1111-1111-1111-111111111111', 'five-2-old', 'explains', 'water', 0);

-- The relations. Ducks comes before Feathers in two source passages, so the pair shows once.
-- Bills comes before Birds, and no lesson explains Bills. Feathers is a part of Birds, which is not a prerequisite.
-- Wings comes before Feathers, but Wings is merged. Ducks comes before Mud, but Mud is retired.
insert into public.topic_relations (user_id, kind, from_topic_id, to_topic_id, reason, source_passage_id)
values
  ('11111111-1111-1111-1111-111111111111', 'prerequisite', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000003', 'Ducks come before feathers.', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('11111111-1111-1111-1111-111111111111', 'prerequisite', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000003', 'A duck has feathers.', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'prerequisite', 'dddddddd-0000-0000-0000-000000000004',
   'dddddddd-0000-0000-0000-000000000002', 'Bills come before birds.', 'aaaaaaaa-0000-0000-0000-000000000002'),
  ('11111111-1111-1111-1111-111111111111', 'part_of', 'dddddddd-0000-0000-0000-000000000003',
   'dddddddd-0000-0000-0000-000000000002', 'Feathers cover a bird.', 'aaaaaaaa-0000-0000-0000-000000000003'),
  ('11111111-1111-1111-1111-111111111111', 'prerequisite', 'dddddddd-0000-0000-0000-000000000005',
   'dddddddd-0000-0000-0000-000000000003', 'Wings come before feathers.', 'aaaaaaaa-0000-0000-0000-000000000004'),
  ('11111111-1111-1111-1111-111111111111', 'prerequisite', 'dddddddd-0000-0000-0000-000000000001',
   'dddddddd-0000-0000-0000-000000000006', 'Ducks come before mud.', 'aaaaaaaa-0000-0000-0000-000000000004');

-- The rights on the function.
select is_empty(
  $$ select r.name
     from unnest(array['anon', 'service_role']) as r(name)
     where has_function_privilege(r.name, 'public.course_lesson_map(uuid)', 'EXECUTE') $$,
  'anon and service_role cannot execute course_lesson_map'
);

select ok(
  has_function_privilege('authenticated', 'public.course_lesson_map(uuid)', 'EXECUTE'),
  'authenticated can execute course_lesson_map'
);

-- anon gets no map.
set local role anon;

select throws_ok(
  $$ select public.course_lesson_map('cccccccc-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'anon cannot execute course_lesson_map'
);

-- The first learner reads the map of their course.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- Lesson four has no analysis, and the lesson missing did not load, so neither has an item.
select is(
  public.course_lesson_map('cccccccc-0000-0000-0000-000000000001') -> 'analyses',
  '[{"lesson_url": "https://example.com/course/one", "state": "current"},
    {"lesson_url": "https://example.com/course/two", "state": "changed"},
    {"lesson_url": "https://example.com/course/three", "state": "failed"},
    {"lesson_url": "https://example.com/course/five", "state": "changed"}]'::jsonb,
  'course_lesson_map gives the analysis state of each loaded lesson with an analysis, in course order'
);

-- Wings is merged, Mud is retired, and Reeds has no home lesson.
select is(
  public.course_lesson_map('cccccccc-0000-0000-0000-000000000001') -> 'topics',
  '[{"id": "dddddddd-0000-0000-0000-000000000001", "name": "Ducks",
     "home_lesson_url": "https://example.com/course/one"},
    {"id": "dddddddd-0000-0000-0000-000000000002", "name": "Birds",
     "home_lesson_url": "https://example.com/course/one"},
    {"id": "dddddddd-0000-0000-0000-000000000003", "name": "Feathers",
     "home_lesson_url": "https://example.com/course/two"},
    {"id": "dddddddd-0000-0000-0000-000000000004", "name": "Bills",
     "home_lesson_url": "https://example.com/course/two"},
    {"id": "dddddddd-0000-0000-0000-000000000007", "name": "Water",
     "home_lesson_url": "https://example.com/course/five"}]'::jsonb,
  'course_lesson_map gives each live topic with a home lesson, and no merged or retired topic'
);

-- No pair comes from the mentions links of Birds and Bills, the old link of Water, or the links of Wings and Mud.
select is(
  public.course_lesson_map('cccccccc-0000-0000-0000-000000000001') -> 'explains',
  '[{"lesson_url": "https://example.com/course/five", "topic_id": "dddddddd-0000-0000-0000-000000000001"},
    {"lesson_url": "https://example.com/course/one", "topic_id": "dddddddd-0000-0000-0000-000000000001"},
    {"lesson_url": "https://example.com/course/one", "topic_id": "dddddddd-0000-0000-0000-000000000002"},
    {"lesson_url": "https://example.com/course/two", "topic_id": "dddddddd-0000-0000-0000-000000000003"}]'::jsonb,
  'course_lesson_map gives each pair of a lesson and a live topic with a current explains link once'
);

-- No pair comes from the part_of relation, the relation from the merged Wings, or the relation to the retired Mud.
select is(
  public.course_lesson_map('cccccccc-0000-0000-0000-000000000001') -> 'prerequisites',
  '[{"from_topic_id": "dddddddd-0000-0000-0000-000000000001",
     "to_topic_id": "dddddddd-0000-0000-0000-000000000003"},
    {"from_topic_id": "dddddddd-0000-0000-0000-000000000004",
     "to_topic_id": "dddddddd-0000-0000-0000-000000000002"}]'::jsonb,
  'course_lesson_map gives each prerequisite pair of live topics once'
);

select is(
  public.course_lesson_map('cccccccc-0000-0000-0000-000000000001') -> 'merged',
  '[{"id": "dddddddd-0000-0000-0000-000000000005", "merged_into": "dddddddd-0000-0000-0000-000000000001"}]'::jsonb,
  'course_lesson_map gives each merged topic of the course with the topic that replaces it'
);

-- The second learner gets no map of the first learner.
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is(
  public.course_lesson_map('cccccccc-0000-0000-0000-000000000001'),
  null::jsonb,
  'course_lesson_map gives null for the course of a different learner'
);

-- Rule 6: the function reads no learner table and calls no function that reads one.
-- The header comment of the migration is not a part of the function, so only the body counts.
reset role;

select doesnt_match(
  pg_get_functiondef('public.course_lesson_map(uuid)'::regprocedure),
  'learner_events|learner_course_events',
  'course_lesson_map reads no learner table and calls no learner function, so rule 6 holds'
);

select * from finish();

rollback;
