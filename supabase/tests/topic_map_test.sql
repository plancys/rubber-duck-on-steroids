-- This test proves the access rules and the functions of the topic map.
-- A learner reads only their own rows of the knowledge tables and writes none. Anonymous users get nothing.
-- Only the worker executes the worker functions. Only a signed-in learner executes the functions for the pages.
-- Each query reads only the fixed users and courses of this test, so local data does not change a result.
-- The test runs in one transaction and rolls back at the end.

begin;

create extension if not exists pgtap with schema extensions;

select plan(73);

-- Create two users as the superuser.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'first@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'second@example.com');

-- Course 1 is a ready crawl course of the first learner with 3 loaded lessons and 1 failed lesson.
-- Course 2 is a ready crawl course of the second learner with 1 loaded lesson.
-- Course 3 is a crawl course of the first learner that loads.
-- Course 4 is a ready extension course of the first learner. It shares one topic with course 1 later.
insert into public.courses (id, user_id, source_url, title, source_kind, status, loaded_at)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course', 'Course one', 'crawl', 'ready', now()),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'https://example.com/course', 'Course two', 'crawl', 'ready', now()),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'https://example.com/loading', 'Course that loads', 'crawl', 'loading', null),
  ('cccccccc-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'https://blocked.example.com/course', 'Extension course', 'extension', 'ready', null);

insert into public.lessons (course_id, user_id, position, title, url, markdown, status, error)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 1, 'One',
   'https://example.com/course/one', '# One Ducks swim. Water is wet.', 'loaded', null),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 2, 'Two',
   'https://example.com/course/two', '# Two A duck has feathers.', 'loaded', null),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 3, 'Three',
   'https://example.com/course/three', '# Three', 'loaded', null),
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 4, 'Missing',
   'https://example.com/course/missing', null, 'failed', 'The page answered 404.'),
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 1, 'Second one',
   'https://example.com/course/second-one', '# Second one Ponds have reeds.', 'loaded', null);

-- The map states that the worker functions get. service_role reads them.
create temp table test_states (name text primary key, state jsonb not null);
grant select on test_states to service_role;

insert into test_states (name, state)
values
  -- The first map of course 1. Ducks and Water have lesson one as home, Feathers has lesson two.
  ('first', '{
     "topics": [
       {"id": "dddddddd-0000-0000-0000-000000000001", "name": "Ducks", "description": "A water bird.",
        "aliases": [{"alias": "Ducks", "normalized": "ducks"}, {"alias": "Duck", "normalized": "duck"}],
        "home_lesson_url": "https://example.com/course/one", "merged_into": null, "retired": false},
       {"id": "dddddddd-0000-0000-0000-000000000002", "name": "Water", "description": "A liquid.",
        "aliases": [{"alias": "Water", "normalized": "water"}],
        "home_lesson_url": "https://example.com/course/one", "merged_into": null, "retired": false},
       {"id": "dddddddd-0000-0000-0000-000000000003", "name": "Feathers", "description": "The cover of a bird.",
        "aliases": [{"alias": "Feathers", "normalized": "feathers"}],
        "home_lesson_url": "https://example.com/course/two", "merged_into": null, "retired": false}
     ],
     "links": [
       {"topic_id": "dddddddd-0000-0000-0000-000000000001", "lesson_url": "https://example.com/course/one",
        "position": 1, "role": "explains", "quote": "Ducks swim.", "quote_start": 0},
       {"topic_id": "dddddddd-0000-0000-0000-000000000002", "lesson_url": "https://example.com/course/one",
        "position": 2, "role": "mentions", "quote": "Water is wet.", "quote_start": 0},
       {"topic_id": "dddddddd-0000-0000-0000-000000000003", "lesson_url": "https://example.com/course/two",
        "position": 1, "role": "explains", "quote": "A duck has feathers.", "quote_start": 0},
       {"topic_id": "dddddddd-0000-0000-0000-000000000001", "lesson_url": "https://example.com/course/two",
        "position": 1, "role": "mentions", "quote": "A duck", "quote_start": 0}
     ],
     "relations": [
       {"kind": "prerequisite", "from_topic_id": "dddddddd-0000-0000-0000-000000000002",
        "to_topic_id": "dddddddd-0000-0000-0000-000000000001", "reason": "Ducks need water.",
        "lesson_url": "https://example.com/course/one", "position": 2},
       {"kind": "part_of", "from_topic_id": "dddddddd-0000-0000-0000-000000000003",
        "to_topic_id": "dddddddd-0000-0000-0000-000000000001", "reason": "Feathers are a part of a duck.",
        "lesson_url": "https://example.com/course/two", "position": 1}
     ],
     "overview": {"lessons": 3},
     "report": {"analysed": 3}
   }'),
  -- The second map of course 1. Feathers merges into Ducks, and Water has no link left.
  ('second', '{
     "topics": [
       {"id": "dddddddd-0000-0000-0000-000000000001", "name": "Ducks", "description": "A water bird.",
        "aliases": [{"alias": "Ducks", "normalized": "ducks"}, {"alias": "Feathers", "normalized": "feathers"}],
        "home_lesson_url": "https://example.com/course/one", "merged_into": null, "retired": false},
       {"id": "dddddddd-0000-0000-0000-000000000002", "name": "Water", "description": "A liquid.",
        "aliases": [{"alias": "Water", "normalized": "water"}],
        "home_lesson_url": null, "merged_into": null, "retired": true},
       {"id": "dddddddd-0000-0000-0000-000000000003", "name": "Feathers", "description": "The cover of a bird.",
        "aliases": [],
        "home_lesson_url": null, "merged_into": "dddddddd-0000-0000-0000-000000000001", "retired": true}
     ],
     "links": [
       {"topic_id": "dddddddd-0000-0000-0000-000000000001", "lesson_url": "https://example.com/course/one",
        "position": 1, "role": "explains", "quote": "Ducks swim.", "quote_start": 0},
       {"topic_id": "dddddddd-0000-0000-0000-000000000001", "lesson_url": "https://example.com/course/two",
        "position": 1, "role": "explains", "quote": "A duck has feathers.", "quote_start": 0}
     ],
     "relations": [],
     "overview": {"lessons": 2},
     "report": {"analysed": 2}
   }'),
  -- A map with a link to the passage of lesson three, which is gone at the time of the call.
  ('gone_passage', '{
     "topics": [],
     "links": [
       {"topic_id": "dddddddd-0000-0000-0000-000000000001", "lesson_url": "https://example.com/course/three",
        "position": 1, "role": "explains", "quote": "Three", "quote_start": 0}
     ],
     "relations": []
   }'),
  -- The map of course 4. It holds Ducks, so Ducks belongs to two courses.
  ('extension', '{
     "topics": [
       {"id": "dddddddd-0000-0000-0000-000000000001", "name": "Ducks", "description": "A water bird.",
        "aliases": [{"alias": "Ducks", "normalized": "ducks"}],
        "home_lesson_url": null, "merged_into": null, "retired": false}
     ],
     "links": [],
     "relations": []
   }'),
  -- The map of course 2 of the second learner.
  ('second_learner', '{
     "topics": [
       {"id": "dddddddd-0000-0000-0000-000000000005", "name": "Ponds", "description": "Small lakes.",
        "aliases": [{"alias": "Ponds", "normalized": "ponds"}],
        "home_lesson_url": "https://example.com/course/second-one", "merged_into": null, "retired": false},
       {"id": "dddddddd-0000-0000-0000-000000000006", "name": "Reeds", "description": "Tall grass.",
        "aliases": [{"alias": "Reeds", "normalized": "reeds"}],
        "home_lesson_url": "https://example.com/course/second-one", "merged_into": null, "retired": false}
     ],
     "links": [
       {"topic_id": "dddddddd-0000-0000-0000-000000000005", "lesson_url": "https://example.com/course/second-one",
        "position": 1, "role": "explains", "quote": "Ponds", "quote_start": 0},
       {"topic_id": "dddddddd-0000-0000-0000-000000000006", "lesson_url": "https://example.com/course/second-one",
        "position": 1, "role": "mentions", "quote": "reeds", "quote_start": 0}
     ],
     "relations": [
       {"kind": "prerequisite", "from_topic_id": "dddddddd-0000-0000-0000-000000000005",
        "to_topic_id": "dddddddd-0000-0000-0000-000000000006", "reason": "Reeds grow in ponds.",
        "lesson_url": "https://example.com/course/second-one", "position": 1}
     ],
     "overview": {"lessons": 1},
     "report": {"analysed": 1}
   }');

-- The access rules of the knowledge tables.
select results_eq(
  $$ select count(*)::integer
     from pg_class
     where relnamespace = 'public'::regnamespace
       and relname in ('passages', 'topics', 'topic_aliases', 'course_topics', 'topic_links', 'topic_relations',
                       'lesson_analyses', 'course_maps')
       and relrowsecurity $$,
  $$ values (8) $$,
  'row-level security is on for each of the 8 knowledge tables'
);

select is_empty(
  $$ select t.name
     from unnest(array['passages', 'topics', 'topic_aliases', 'course_topics', 'topic_links', 'topic_relations',
                       'lesson_analyses', 'course_maps']) as t(name)
     where not has_table_privilege('authenticated', 'public.' || t.name, 'SELECT') $$,
  'authenticated can select each knowledge table'
);

select is_empty(
  $$ select t.name, p.privilege
     from unnest(array['passages', 'topics', 'topic_aliases', 'course_topics', 'topic_links', 'topic_relations',
                       'lesson_analyses', 'course_maps']) as t(name)
     cross join unnest(array['INSERT', 'UPDATE', 'REFERENCES']) as p(privilege)
     where has_any_column_privilege('authenticated', 'public.' || t.name, p.privilege)
     union all
     select t.name, p.privilege
     from unnest(array['passages', 'topics', 'topic_aliases', 'course_topics', 'topic_links', 'topic_relations',
                       'lesson_analyses', 'course_maps']) as t(name)
     cross join unnest(array['DELETE', 'TRUNCATE', 'TRIGGER']) as p(privilege)
     where has_table_privilege('authenticated', 'public.' || t.name, p.privilege) $$,
  'authenticated has no write right on a knowledge table'
);

select is_empty(
  $$ select t.name, p.privilege
     from unnest(array['passages', 'topics', 'topic_aliases', 'course_topics', 'topic_links', 'topic_relations',
                       'lesson_analyses', 'course_maps']) as t(name)
     cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as p(privilege)
     where has_any_column_privilege('anon', 'public.' || t.name, p.privilege)
     union all
     select t.name, p.privilege
     from unnest(array['passages', 'topics', 'topic_aliases', 'course_topics', 'topic_links', 'topic_relations',
                       'lesson_analyses', 'course_maps']) as t(name)
     cross join unnest(array['DELETE', 'TRUNCATE', 'TRIGGER']) as p(privilege)
     where has_table_privilege('anon', 'public.' || t.name, p.privilege) $$,
  'anon has no right on a knowledge table'
);

-- The rights on the functions.
select is_empty(
  $$ select r.name, f.name
     from unnest(array['anon', 'authenticated']) as r(name)
     cross join unnest(array[
       'public.start_topic_map(uuid)',
       'public.read_lesson_text(uuid, text)',
       'public.save_lesson_analysis(uuid, text, text, text, uuid, text, text, text, text, integer, integer, jsonb, jsonb)',
       'public.finish_topic_map(uuid, uuid, jsonb)'
     ]) as f(name)
     where has_function_privilege(r.name, f.name, 'EXECUTE') $$,
  'anon and authenticated cannot execute a worker function'
);

select is_empty(
  $$ select f.name
     from unnest(array[
       'public.start_topic_map(uuid)',
       'public.read_lesson_text(uuid, text)',
       'public.save_lesson_analysis(uuid, text, text, text, uuid, text, text, text, text, integer, integer, jsonb, jsonb)',
       'public.finish_topic_map(uuid, uuid, jsonb)'
     ]) as f(name)
     where not has_function_privilege('service_role', f.name, 'EXECUTE') $$,
  'service_role can execute each worker function'
);

select is_empty(
  $$ select r.name, f.name
     from unnest(array['anon', 'service_role']) as r(name)
     cross join unnest(array['public.topic_map_state(uuid)', 'public.topic_map_lesson(uuid, text)']) as f(name)
     where has_function_privilege(r.name, f.name, 'EXECUTE') $$,
  'anon and service_role cannot execute a page function'
);

select is_empty(
  $$ select f.name
     from unnest(array['public.topic_map_state(uuid)', 'public.topic_map_lesson(uuid, text)']) as f(name)
     where not has_function_privilege('authenticated', f.name, 'EXECUTE') $$,
  'authenticated can execute each page function'
);

-- The content hash of a lesson.
select results_eq(
  $$ select position, content_hash
     from public.lessons
     where course_id = 'cccccccc-0000-0000-0000-000000000001'
     order by position $$,
  $$ values
       (1, md5('# One Ducks swim. Water is wet.')),
       (2, md5('# Two A duck has feathers.')),
       (3, md5('# Three')),
       (4, null::text) $$,
  'content_hash is the MD5 of the lesson text, and null for a lesson with no text'
);

update public.lessons
set markdown = '# Three And more text.'
where course_id = 'cccccccc-0000-0000-0000-000000000001'
  and position = 3;

select is(
  (select content_hash
   from public.lessons
   where course_id = 'cccccccc-0000-0000-0000-000000000001'
     and position = 3),
  md5('# Three And more text.'),
  'content_hash changes with the lesson text'
);

-- The rules of a build_topic_map job.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$ insert into public.jobs (type, payload)
     values ('build_topic_map', '{"courseId": "cccccccc-0000-0000-0000-000000000001"}') $$,
  '23514',
  null,
  'a learner cannot insert a topic job for the course of a different learner'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$ insert into public.jobs (type, payload)
     values ('build_topic_map', '{"courseId": "cccccccc-0000-0000-0000-000000000003"}') $$,
  '23514',
  null,
  'a learner cannot insert a topic job for a course that is not ready'
);

select throws_ok(
  $$ insert into public.jobs (type, payload) values ('build_topic_map', '{"courseId": "not-a-uuid"}') $$,
  '23514',
  null,
  'a topic job with a courseId that is not a uuid is rejected'
);

select throws_ok(
  $$ insert into public.jobs (type, payload) values ('build_topic_map', '{}') $$,
  '23514',
  null,
  'a topic job without a courseId is rejected'
);

select lives_ok(
  $$ insert into public.jobs (type, payload)
     values ('build_topic_map', '{"courseId": "cccccccc-0000-0000-0000-000000000001"}') $$,
  'a learner can insert a topic job for their own ready course'
);

-- A learner starts at most 5 topic map builds in one hour. The first learner gets 4 more jobs from the last hour.
reset role;

update public.jobs
set status = 'done'
where user_id = '11111111-1111-1111-1111-111111111111'
  and type = 'build_topic_map';

insert into public.jobs (user_id, type, payload, status)
select '11111111-1111-1111-1111-111111111111', 'build_topic_map',
       '{"courseId": "cccccccc-0000-0000-0000-000000000001"}', 'done'
from generate_series(1, 4);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$ insert into public.jobs (type, payload)
     values ('build_topic_map', '{"courseId": "cccccccc-0000-0000-0000-000000000001"}') $$,
  'RD004',
  null,
  'a learner cannot start a sixth topic map build in one hour'
);

-- A crawl load that ends ready starts a topic job. Each learner has a load job that runs with a known lease.
reset role;

insert into public.jobs (id, user_id, type, payload, status, attempts, lease_id, lease_expires_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'load_course',
   '{"courseId": "cccccccc-0000-0000-0000-000000000001"}', 'running', 1,
   'bbbbbbbb-0000-0000-0000-000000000001', now() + interval '1 minute'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'load_course',
   '{"courseId": "cccccccc-0000-0000-0000-000000000002"}', 'running', 1,
   'bbbbbbbb-0000-0000-0000-000000000002', now() + interval '1 minute');

set local role service_role;

select ok(
  public.complete_job('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
    '{"courseId": "cccccccc-0000-0000-0000-000000000002", "outcome": "ready"}'),
  'complete_job ends a load job that ends ready'
);

reset role;

select results_eq(
  $$ select type, status, payload ->> 'courseId'
     from public.jobs
     where user_id = '22222222-2222-2222-2222-222222222222'
     order by type $$,
  $$ values
       ('build_topic_map'::text, 'waiting'::text, 'cccccccc-0000-0000-0000-000000000002'::text),
       ('load_course'::text, 'done'::text, 'cccccccc-0000-0000-0000-000000000002'::text) $$,
  'a load job that ends done with ready gives one waiting topic job'
);

-- The first learner has 5 topic jobs from the last hour, so the insert of the trigger fails on the quota.
set local role service_role;

select ok(
  public.complete_job('aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
    '{"courseId": "cccccccc-0000-0000-0000-000000000001", "outcome": "ready"}'),
  'complete_job ends a load job when the topic quota is full'
);

reset role;

select results_eq(
  $$ select
       (select status from public.jobs where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
       (select count(*)
        from public.jobs
        where user_id = '11111111-1111-1111-1111-111111111111'
          and type = 'build_topic_map'
          and status in ('waiting', 'running')) $$,
  $$ values ('done'::text, 0::bigint) $$,
  'a full quota leaves the load job done and inserts no topic job'
);

-- retry_job refuses a build_topic_map job, so a retry cannot pass the limit of topic jobs in one hour.
-- The topic job of the second learner fails first.
update public.jobs
set status = 'failed', error = 'No lesson of the course could be analysed.', finished_at = now()
where user_id = '22222222-2222-2222-2222-222222222222'
  and type = 'build_topic_map';

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is(
  (select public.retry_job(j.id)
   from public.jobs as j
   where j.user_id = '22222222-2222-2222-2222-222222222222'
     and j.type = 'build_topic_map'),
  false,
  'retry_job refuses the failed build_topic_map job of the caller'
);

reset role;

select results_eq(
  $$ select status, attempts
     from public.jobs
     where user_id = '22222222-2222-2222-2222-222222222222'
       and type = 'build_topic_map' $$,
  $$ values ('failed'::text, 0) $$,
  'a refused retry leaves the build_topic_map job failed'
);

-- The worker functions.
set local role service_role;

select results_eq(
  $$ select
       s -> 'course' ->> 'id',
       jsonb_array_length(s -> 'lessons'),
       (select bool_or(l ? 'markdown') from jsonb_array_elements(s -> 'lessons') as l),
       s -> 'lessons' -> 0 ->> 'content_hash',
       jsonb_array_length(s -> 'analyses'),
       jsonb_array_length(s -> 'topics')
     from (select public.start_topic_map('cccccccc-0000-0000-0000-000000000001') as s) as x $$,
  $$ values ('cccccccc-0000-0000-0000-000000000001'::text, 3, false, md5('# One Ducks swim. Water is wet.'), 0, 0) $$,
  'start_topic_map returns the course and its loaded lessons with no text'
);

select is(
  public.start_topic_map('cccccccc-0000-0000-0000-000000000099'),
  null::jsonb,
  'start_topic_map returns null for a course that does not exist'
);

select is(
  public.read_lesson_text('cccccccc-0000-0000-0000-000000000001', 'https://example.com/course/one'),
  '# One Ducks swim. Water is wet.',
  'read_lesson_text returns the Markdown of one lesson'
);

select is(
  public.read_lesson_text('cccccccc-0000-0000-0000-000000000001', 'https://example.com/course/missing'),
  null::text,
  'read_lesson_text returns null for a lesson with no text'
);

select ok(
  public.save_lesson_analysis(
    course_id => 'cccccccc-0000-0000-0000-000000000001',
    lesson_url => 'https://example.com/course/one',
    content_hash => md5('# One Ducks swim. Water is wet.'),
    status => 'analysed',
    run_id => 'eeeeeeee-0000-0000-0000-000000000001',
    engine => 'cognee-extract/1',
    prompt_version => '1',
    model => 'claude-haiku-5-5',
    input_tokens => 100,
    output_tokens => 50,
    result => '{"topics": [], "relations": []}',
    passages => '[{"position": 1, "heading_path": ["One"], "start_offset": 6, "end_offset": 17, "content_hash": "one-1"},
                  {"position": 2, "heading_path": ["One"], "start_offset": 18, "end_offset": 31, "content_hash": "one-2"}]'
  ),
  'save_lesson_analysis stores an analysed lesson with its passages'
);

select ok(
  public.save_lesson_analysis(
    course_id => 'cccccccc-0000-0000-0000-000000000001',
    lesson_url => 'https://example.com/course/two',
    content_hash => md5('# Two A duck has feathers.'),
    status => 'analysed',
    run_id => 'eeeeeeee-0000-0000-0000-000000000001',
    engine => 'cognee-extract/1',
    prompt_version => '1',
    model => 'claude-haiku-5-5',
    result => '{"topics": [], "relations": []}',
    passages => '[{"position": 1, "heading_path": ["Two"], "start_offset": 6, "end_offset": 26, "content_hash": "two-1"}]'
  ),
  'save_lesson_analysis stores a second lesson'
);

select ok(
  public.save_lesson_analysis(
    course_id => 'cccccccc-0000-0000-0000-000000000001',
    lesson_url => 'https://example.com/course/three',
    content_hash => md5('# Three And more text.'),
    status => 'analysed',
    run_id => 'eeeeeeee-0000-0000-0000-000000000001',
    result => '{"topics": [], "relations": []}',
    passages => '[{"position": 1, "heading_path": [], "start_offset": 0, "end_offset": 22, "content_hash": "three-1"}]'
  ),
  'save_lesson_analysis stores a third lesson'
);

select is(
  public.save_lesson_analysis(
    course_id => 'cccccccc-0000-0000-0000-000000000001',
    lesson_url => 'https://example.com/course/missing',
    content_hash => 'none',
    status => 'analysed',
    run_id => 'eeeeeeee-0000-0000-0000-000000000001',
    result => '{}',
    passages => '[]'
  ),
  false,
  'save_lesson_analysis returns false for a lesson with no text'
);

select throws_ok(
  $$ select public.save_lesson_analysis(
       course_id => 'cccccccc-0000-0000-0000-000000000001',
       lesson_url => 'https://example.com/course/one',
       content_hash => 'hash',
       status => 'analysed',
       run_id => 'eeeeeeee-0000-0000-0000-000000000001',
       result => '{}'
     ) $$,
  '23514',
  null,
  'save_lesson_analysis rejects an analysed lesson without a passage list'
);

-- The map of the second learner, so both learners have rows in each knowledge table.
select ok(
  public.save_lesson_analysis(
    course_id => 'cccccccc-0000-0000-0000-000000000002',
    lesson_url => 'https://example.com/course/second-one',
    content_hash => md5('# Second one Ponds have reeds.'),
    status => 'analysed',
    run_id => 'eeeeeeee-0000-0000-0000-000000000002',
    result => '{"topics": [], "relations": []}',
    passages => '[{"position": 1, "heading_path": ["Second one"], "start_offset": 13, "end_offset": 30,
                   "content_hash": "second-1"}]'
  ),
  'save_lesson_analysis stores the lesson of the second learner'
);

select ok(
  public.finish_topic_map('cccccccc-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000002',
    (select state from test_states where name = 'second_learner')),
  'finish_topic_map writes the map of the second learner'
);

-- The first map of course 1.
select ok(
  public.finish_topic_map('cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
    (select state from test_states where name = 'first')),
  'finish_topic_map writes the first map of a course'
);

reset role;

select results_eq(
  $$ select t.id, t.user_id, t.name, ct.home_lesson_url, t.merged_into, t.retired_at, t.created_by_run
     from public.course_topics as ct
     join public.topics as t on t.id = ct.topic_id
     where ct.course_id = 'cccccccc-0000-0000-0000-000000000001'
     order by t.id $$,
  $$ values
       ('dddddddd-0000-0000-0000-000000000001'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Ducks'::text,
        'https://example.com/course/one'::text, null::uuid, null::timestamptz,
        'eeeeeeee-0000-0000-0000-000000000001'::uuid),
       ('dddddddd-0000-0000-0000-000000000002'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Water'::text,
        'https://example.com/course/one'::text, null::uuid, null::timestamptz,
        'eeeeeeee-0000-0000-0000-000000000001'::uuid),
       ('dddddddd-0000-0000-0000-000000000003'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Feathers'::text,
        'https://example.com/course/two'::text, null::uuid, null::timestamptz,
        'eeeeeeee-0000-0000-0000-000000000001'::uuid) $$,
  'finish_topic_map inserts the new topics with their ids and home lessons'
);

select results_eq(
  $$ select k.topic_id, p.lesson_url, p.position, k.role, k.passage_hash = p.content_hash
     from public.topic_links as k
     join public.passages as p on p.id = k.passage_id
     where p.course_id = 'cccccccc-0000-0000-0000-000000000001'
     order by k.topic_id, p.lesson_url, p.position $$,
  $$ values
       ('dddddddd-0000-0000-0000-000000000001'::uuid, 'https://example.com/course/one'::text, 1, 'explains'::text, true),
       ('dddddddd-0000-0000-0000-000000000001'::uuid, 'https://example.com/course/two'::text, 1, 'mentions'::text, true),
       ('dddddddd-0000-0000-0000-000000000002'::uuid, 'https://example.com/course/one'::text, 2, 'mentions'::text, true),
       ('dddddddd-0000-0000-0000-000000000003'::uuid, 'https://example.com/course/two'::text, 1, 'explains'::text, true) $$,
  'finish_topic_map writes the links with the content hash of each passage'
);

select results_eq(
  $$ select
       (select count(*)
        from public.topic_relations as r
        join public.passages as p on p.id = r.source_passage_id
        where p.course_id = 'cccccccc-0000-0000-0000-000000000001'),
       (select count(*)
        from public.topic_aliases
        where user_id = '11111111-1111-1111-1111-111111111111'),
       (select run_id
        from public.course_maps
        where course_id = 'cccccccc-0000-0000-0000-000000000001') $$,
  $$ values (2::bigint, 4::bigint, 'eeeeeeee-0000-0000-0000-000000000001'::uuid) $$,
  'finish_topic_map writes the relations, the alias names and the course_maps row'
);

-- A learner reads only their own rows in each knowledge table, and both learners have rows in each table.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select 'passages', count(*) > 0, count(*) filter (where user_id <> (select auth.uid())) from public.passages
     union all
     select 'topics', count(*) > 0, count(*) filter (where user_id <> (select auth.uid())) from public.topics
     union all
     select 'topic_aliases', count(*) > 0, count(*) filter (where user_id <> (select auth.uid()))
     from public.topic_aliases
     union all
     select 'course_topics', count(*) > 0, count(*) filter (where user_id <> (select auth.uid()))
     from public.course_topics
     union all
     select 'topic_links', count(*) > 0, count(*) filter (where user_id <> (select auth.uid())) from public.topic_links
     union all
     select 'topic_relations', count(*) > 0, count(*) filter (where user_id <> (select auth.uid()))
     from public.topic_relations
     union all
     select 'lesson_analyses', count(*) > 0, count(*) filter (where user_id <> (select auth.uid()))
     from public.lesson_analyses
     union all
     select 'course_maps', count(*) > 0, count(*) filter (where user_id <> (select auth.uid())) from public.course_maps $$,
  $$ values
       ('passages', true, 0::bigint), ('topics', true, 0::bigint), ('topic_aliases', true, 0::bigint),
       ('course_topics', true, 0::bigint), ('topic_links', true, 0::bigint), ('topic_relations', true, 0::bigint),
       ('lesson_analyses', true, 0::bigint), ('course_maps', true, 0::bigint) $$,
  'the first learner reads only their own rows in each knowledge table'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select results_eq(
  $$ select 'passages', count(*) > 0, count(*) filter (where user_id <> (select auth.uid())) from public.passages
     union all
     select 'topics', count(*) > 0, count(*) filter (where user_id <> (select auth.uid())) from public.topics
     union all
     select 'topic_aliases', count(*) > 0, count(*) filter (where user_id <> (select auth.uid()))
     from public.topic_aliases
     union all
     select 'course_topics', count(*) > 0, count(*) filter (where user_id <> (select auth.uid()))
     from public.course_topics
     union all
     select 'topic_links', count(*) > 0, count(*) filter (where user_id <> (select auth.uid())) from public.topic_links
     union all
     select 'topic_relations', count(*) > 0, count(*) filter (where user_id <> (select auth.uid()))
     from public.topic_relations
     union all
     select 'lesson_analyses', count(*) > 0, count(*) filter (where user_id <> (select auth.uid()))
     from public.lesson_analyses
     union all
     select 'course_maps', count(*) > 0, count(*) filter (where user_id <> (select auth.uid())) from public.course_maps $$,
  $$ values
       ('passages', true, 0::bigint), ('topics', true, 0::bigint), ('topic_aliases', true, 0::bigint),
       ('course_topics', true, 0::bigint), ('topic_links', true, 0::bigint), ('topic_relations', true, 0::bigint),
       ('lesson_analyses', true, 0::bigint), ('course_maps', true, 0::bigint) $$,
  'the second learner reads only their own rows in each knowledge table'
);

-- A learner writes no knowledge row.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$ insert into public.topics (user_id, name) values ('11111111-1111-1111-1111-111111111111', 'Mine') $$,
  '42501',
  null,
  'a learner cannot insert a topic'
);

select throws_ok(
  $$ update public.passages set content_hash = 'changed' $$,
  '42501',
  null,
  'a learner cannot update a passage'
);

select throws_ok(
  $$ delete from public.course_maps $$,
  '42501',
  null,
  'a learner cannot delete a course map'
);

select throws_ok(
  $$ select public.save_lesson_analysis(
       course_id => 'cccccccc-0000-0000-0000-000000000001',
       lesson_url => 'https://example.com/course/one',
       content_hash => 'hash',
       status => 'failed',
       run_id => 'eeeeeeee-0000-0000-0000-000000000001',
       error => 'Reason'
     ) $$,
  '42501',
  null,
  'a learner cannot execute save_lesson_analysis'
);

-- The state of a current map.
select results_eq(
  $$ select built_at is not null, loaded_lessons, analysed_lessons, failed_lessons, changed_lessons, gone_lessons,
            topic_count
     from public.topic_map_state('cccccccc-0000-0000-0000-000000000001') $$,
  $$ values (true, 3, 3, 0, 0, 0, 3) $$,
  'topic_map_state gives the counts of a current map'
);

-- One lesson of the map.
select results_eq(
  $$ select
       m -> 'lesson' ->> 'title',
       (select jsonb_agg(t ->> 'name') from jsonb_array_elements(m -> 'topics') as t),
       jsonb_array_length(m -> 'relations'),
       (select jsonb_agg(o ->> 'name') from jsonb_array_elements(m -> 'others') as o)
     from (select public.topic_map_lesson('cccccccc-0000-0000-0000-000000000001',
                                          'https://example.com/course/one') as m) as x $$,
  $$ values ('One'::text, '["Ducks", "Water"]'::jsonb, 2, '["Feathers"]'::jsonb) $$,
  'topic_map_lesson returns the topics of the lesson, its relations and the topics at the other end'
);

select results_eq(
  $$ select l ->> 'lesson_title', l ->> 'role', l ->> 'quote', l -> 'heading_path'
     from jsonb_array_elements(
       public.topic_map_lesson('cccccccc-0000-0000-0000-000000000001', 'https://example.com/course/one')
         -> 'topics' -> 0 -> 'links') as l $$,
  $$ values
       ('One'::text, 'explains'::text, 'Ducks swim.'::text, '["One"]'::jsonb),
       ('Two'::text, 'mentions'::text, 'A duck'::text, '["Two"]'::jsonb) $$,
  'topic_map_lesson returns each link of a topic with its lesson, role, quote and heading path'
);

select results_eq(
  $$ select t ->> 'name', t -> 'parent' ->> 'name', t -> 'parent' ->> 'home_lesson_url'
     from jsonb_array_elements(
       public.topic_map_lesson('cccccccc-0000-0000-0000-000000000001', 'https://example.com/course/two')
         -> 'topics') as t $$,
  $$ values ('Feathers'::text, 'Ducks'::text, 'https://example.com/course/one'::text) $$,
  'topic_map_lesson returns the parent of a topic with its home lesson'
);

-- The second learner gets no data of the first learner.
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is(
  public.topic_map_lesson('cccccccc-0000-0000-0000-000000000001', 'https://example.com/course/one'),
  null::jsonb,
  'topic_map_lesson returns null for the course of a different learner'
);

select is_empty(
  $$ select * from public.topic_map_state('cccccccc-0000-0000-0000-000000000001') $$,
  'topic_map_state returns no row for the course of a different learner'
);

-- anon reads nothing.
reset role;
set local role anon;

select throws_ok(
  $$ select * from public.topics $$,
  '42501',
  null,
  'anon cannot select topics'
);

-- A second call with the same state changes no row. The physical place of each row stays the same.
reset role;

create temp table rows_before as
select 'topics' as kind, ctid::text as place from public.topics
where user_id = '11111111-1111-1111-1111-111111111111'
union all
select 'topic_aliases', ctid::text from public.topic_aliases
where user_id = '11111111-1111-1111-1111-111111111111'
union all
select 'course_topics', ctid::text from public.course_topics
where user_id = '11111111-1111-1111-1111-111111111111'
union all
select 'topic_links', ctid::text from public.topic_links
where user_id = '11111111-1111-1111-1111-111111111111'
union all
select 'topic_relations', ctid::text from public.topic_relations
where user_id = '11111111-1111-1111-1111-111111111111'
union all
select 'course_maps', ctid::text from public.course_maps
where user_id = '11111111-1111-1111-1111-111111111111';

set local role service_role;

select ok(
  public.finish_topic_map('cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
    (select state from test_states where name = 'first')),
  'finish_topic_map accepts a second call with the same state'
);

reset role;

select results_eq(
  $$ select kind, place from (
       select 'topics' as kind, ctid::text as place from public.topics
       where user_id = '11111111-1111-1111-1111-111111111111'
       union all
       select 'topic_aliases', ctid::text from public.topic_aliases
       where user_id = '11111111-1111-1111-1111-111111111111'
       union all
       select 'course_topics', ctid::text from public.course_topics
       where user_id = '11111111-1111-1111-1111-111111111111'
       union all
       select 'topic_links', ctid::text from public.topic_links
       where user_id = '11111111-1111-1111-1111-111111111111'
       union all
       select 'topic_relations', ctid::text from public.topic_relations
       where user_id = '11111111-1111-1111-1111-111111111111'
       union all
       select 'course_maps', ctid::text from public.course_maps
       where user_id = '11111111-1111-1111-1111-111111111111'
     ) as now_rows
     order by kind, place $$,
  $$ select kind, place from rows_before order by kind, place $$,
  'a second call with the same state keeps each topic id and changes no row'
);

-- A new analysis of a lesson replaces the passages of that lesson only.
-- The passage at position 1 keeps its id. The passage at position 2 is gone, and its link goes with it.
set local role service_role;

select ok(
  public.save_lesson_analysis(
    course_id => 'cccccccc-0000-0000-0000-000000000001',
    lesson_url => 'https://example.com/course/one',
    content_hash => md5('# One Ducks swim. Water is wet.'),
    status => 'analysed',
    run_id => 'eeeeeeee-0000-0000-0000-000000000003',
    result => '{"topics": [], "relations": []}',
    passages => '[{"position": 1, "heading_path": ["One"], "start_offset": 6, "end_offset": 31,
                   "content_hash": "one-1-new"}]'
  ),
  'save_lesson_analysis stores a new analysis of a lesson'
);

reset role;

select results_eq(
  $$ select lesson_url, position, content_hash
     from public.passages
     where course_id = 'cccccccc-0000-0000-0000-000000000001'
     order by lesson_url, position $$,
  $$ values
       ('https://example.com/course/one'::text, 1, 'one-1-new'::text),
       ('https://example.com/course/three'::text, 1, 'three-1'::text),
       ('https://example.com/course/two'::text, 1, 'two-1'::text) $$,
  'save_lesson_analysis replaces the passages of one lesson only'
);

select results_eq(
  $$ select k.topic_id, k.passage_hash, p.content_hash
     from public.topic_links as k
     join public.passages as p on p.id = k.passage_id
     where p.course_id = 'cccccccc-0000-0000-0000-000000000001'
       and p.lesson_url = 'https://example.com/course/one'
     order by k.topic_id $$,
  $$ values ('dddddddd-0000-0000-0000-000000000001'::uuid, 'one-1'::text, 'one-1-new'::text) $$,
  'a link keeps its passage and the hash of the old passage text until the next map'
);

-- The page does not show that link, because its passage has a new text. Ducks keeps its link in lesson two.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select l ->> 'lesson_title', l ->> 'quote'
     from jsonb_array_elements(
       public.topic_map_lesson('cccccccc-0000-0000-0000-000000000001', 'https://example.com/course/one')
         -> 'topics' -> 0 -> 'links') as l $$,
  $$ values ('Two'::text, 'A duck'::text) $$,
  'topic_map_lesson hides a link whose passage has a new text'
);

reset role;

-- A changed lesson text.
update public.lessons
set markdown = '# Three Changed again.'
where course_id = 'cccccccc-0000-0000-0000-000000000001'
  and url = 'https://example.com/course/three';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select loaded_lessons, analysed_lessons, failed_lessons, changed_lessons, gone_lessons, topic_count
     from public.topic_map_state('cccccccc-0000-0000-0000-000000000001') $$,
  $$ values (3, 3, 0, 1, 0, 3) $$,
  'topic_map_state counts a lesson with a new hash'
);

-- An analysis that is newer than the map also counts as a change: a build stored it, and no finish followed.
-- The test runs in one transaction, where now() does not move, so the analysis of lesson one gets a later time.
reset role;

update public.lesson_analyses
set analysed_at = analysed_at + interval '1 minute'
where course_id = 'cccccccc-0000-0000-0000-000000000001'
  and lesson_url = 'https://example.com/course/one';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select changed_lessons
     from public.topic_map_state('cccccccc-0000-0000-0000-000000000001') $$,
  $$ values (2) $$,
  'topic_map_state counts a lesson whose analysis is newer than the map'
);

reset role;

update public.lesson_analyses
set analysed_at = analysed_at - interval '1 minute'
where course_id = 'cccccccc-0000-0000-0000-000000000001'
  and lesson_url = 'https://example.com/course/one';

-- A failed analysis keeps the passages and the last result of the lesson.
reset role;
set local role service_role;

select ok(
  public.save_lesson_analysis(
    course_id => 'cccccccc-0000-0000-0000-000000000001',
    lesson_url => 'https://example.com/course/two',
    content_hash => md5('# Two A duck has feathers.'),
    status => 'failed',
    run_id => 'eeeeeeee-0000-0000-0000-000000000003',
    error => 'The engine gave no valid answer.'
  ),
  'save_lesson_analysis stores a failed lesson'
);

reset role;

select results_eq(
  $$ select a.status, a.error, a.result is not null, a.engine, a.run_id,
            (select count(*) from public.passages as p where p.course_id = a.course_id and p.lesson_url = a.lesson_url)
     from public.lesson_analyses as a
     where a.course_id = 'cccccccc-0000-0000-0000-000000000001'
       and a.lesson_url = 'https://example.com/course/two' $$,
  $$ values ('failed'::text, 'The engine gave no valid answer.'::text, true, 'cognee-extract/1'::text,
             'eeeeeeee-0000-0000-0000-000000000003'::uuid, 1::bigint) $$,
  'a failed lesson keeps its passages and its last result, and gets the status failed with the reason'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select loaded_lessons, analysed_lessons, failed_lessons, changed_lessons, gone_lessons, topic_count
     from public.topic_map_state('cccccccc-0000-0000-0000-000000000001') $$,
  $$ values (3, 2, 1, 1, 0, 3) $$,
  'topic_map_state counts a failed lesson of a partial map'
);

-- A reload that no longer finds lesson three.
reset role;

delete from public.lessons
where course_id = 'cccccccc-0000-0000-0000-000000000001'
  and url = 'https://example.com/course/three';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select loaded_lessons, analysed_lessons, failed_lessons, changed_lessons, gone_lessons, topic_count
     from public.topic_map_state('cccccccc-0000-0000-0000-000000000001') $$,
  $$ values (2, 1, 1, 0, 1, 3) $$,
  'topic_map_state counts a lesson that is gone'
);

-- The second map merges Feathers into Ducks and retires Water. It removes the rows of lesson three.
reset role;
set local role service_role;

select ok(
  public.finish_topic_map('cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000003',
    (select state from test_states where name = 'second')),
  'finish_topic_map writes the second map of a course'
);

reset role;

select results_eq(
  $$ select t.id, t.merged_into, t.retired_at, ct.home_lesson_url
     from public.course_topics as ct
     join public.topics as t on t.id = ct.topic_id
     where ct.course_id = 'cccccccc-0000-0000-0000-000000000001'
     order by t.id $$,
  $$ values
       ('dddddddd-0000-0000-0000-000000000001'::uuid, null::uuid, null::timestamptz,
        'https://example.com/course/one'::text),
       ('dddddddd-0000-0000-0000-000000000002'::uuid, null::uuid, now(), null::text),
       ('dddddddd-0000-0000-0000-000000000003'::uuid, 'dddddddd-0000-0000-0000-000000000001'::uuid, now(),
        null::text) $$,
  'finish_topic_map keeps each topic id and sets merged_into and retired_at'
);

select results_eq(
  $$ select
       (select count(*)
        from public.passages
        where course_id = 'cccccccc-0000-0000-0000-000000000001'
          and lesson_url = 'https://example.com/course/three'),
       (select count(*)
        from public.lesson_analyses
        where course_id = 'cccccccc-0000-0000-0000-000000000001'
          and lesson_url = 'https://example.com/course/three'),
       (select count(*)
        from public.topic_links as k
        join public.passages as p on p.id = k.passage_id
        where p.course_id = 'cccccccc-0000-0000-0000-000000000001'),
       (select count(*)
        from public.topic_relations as r
        join public.passages as p on p.id = r.source_passage_id
        where p.course_id = 'cccccccc-0000-0000-0000-000000000001') $$,
  $$ values (0::bigint, 0::bigint, 2::bigint, 0::bigint) $$,
  'finish_topic_map removes the rows of a lesson that is gone and replaces the links and the relations'
);

select results_eq(
  $$ select topic_id, alias
     from public.topic_aliases
     where user_id = '11111111-1111-1111-1111-111111111111'
     order by topic_id, normalized $$,
  $$ values
       ('dddddddd-0000-0000-0000-000000000001'::uuid, 'Ducks'::text),
       ('dddddddd-0000-0000-0000-000000000001'::uuid, 'Feathers'::text),
       ('dddddddd-0000-0000-0000-000000000002'::uuid, 'Water'::text) $$,
  'finish_topic_map replaces the alias names of the topics'
);

set local role service_role;

select throws_ok(
  $$ select public.finish_topic_map('cccccccc-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000004',
       (select state from test_states where name = 'gone_passage')) $$,
  '23514',
  null,
  'finish_topic_map rejects a link to a passage that does not exist'
);

select is(
  public.finish_topic_map('cccccccc-0000-0000-0000-000000000099', 'eeeeeeee-0000-0000-0000-000000000004',
    (select state from test_states where name = 'second')),
  false,
  'finish_topic_map returns false for a course that does not exist'
);

-- Ducks also belongs to course 4. A delete of course 1 keeps Ducks and removes the topics of course 1 only.
select ok(
  public.finish_topic_map('cccccccc-0000-0000-0000-000000000004', 'eeeeeeee-0000-0000-0000-000000000005',
    (select state from test_states where name = 'extension')),
  'finish_topic_map adds a known topic to a second course'
);

reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ delete from public.courses where id = 'cccccccc-0000-0000-0000-000000000001' returning id $$,
  $$ values ('cccccccc-0000-0000-0000-000000000001'::uuid) $$,
  'a learner can delete a course with a topic map'
);

reset role;

select results_eq(
  $$ select
       (select count(*) from public.passages where course_id = 'cccccccc-0000-0000-0000-000000000001'),
       (select count(*) from public.course_topics where course_id = 'cccccccc-0000-0000-0000-000000000001'),
       (select count(*) from public.lesson_analyses where course_id = 'cccccccc-0000-0000-0000-000000000001'),
       (select count(*) from public.course_maps where course_id = 'cccccccc-0000-0000-0000-000000000001'),
       (select count(*) from public.topic_links where user_id = '11111111-1111-1111-1111-111111111111'),
       (select count(*) from public.topic_relations where user_id = '11111111-1111-1111-1111-111111111111') $$,
  $$ values (0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint) $$,
  'a deleted course removes its rows in each knowledge table'
);

select results_eq(
  $$ select t.id, (select count(*) from public.topic_aliases as ta where ta.topic_id = t.id)
     from public.topics as t
     where t.user_id = '11111111-1111-1111-1111-111111111111'
     order by t.id $$,
  $$ values ('dddddddd-0000-0000-0000-000000000001'::uuid, 1::bigint) $$,
  'a deleted course removes its own topics and keeps a topic of another course'
);

select results_eq(
  $$ select count(*)
     from public.topics
     where user_id = '22222222-2222-2222-2222-222222222222' $$,
  $$ values (2::bigint) $$,
  'a deleted course keeps the topics of a different learner'
);

select * from finish();

rollback;
