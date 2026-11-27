-- The topic map of a course. The worker cuts each lesson into passages, asks the engine for the topics of each lesson,
-- and stores the map of the course in the knowledge tables below. These tables are the system of record of the map.
--
-- The rules of the knowledge tables:
-- 1. A knowledge table holds no learner state. No knowledge table points at a learner state table.
-- 2. A topic id has no meaning. Each name of a topic is an alias name.
--    A merged topic keeps its row and points at the topic that replaces it.
-- 3. A link from a topic to a passage holds the content hash of the passage.
-- 4. Each row holds the owner of its course in user_id. A learner reads only their own rows and writes none.
--    The worker writes through the worker functions below. Anonymous users get no access.
-- 5. No view and no function joins the map with learner data.
--
-- The jobs table gets the type build_topic_map. Its payload is { "courseId": "<uuid>" }.
-- A crawl load that ends ready starts a topic job in the same transaction.
--
-- The functions raise these SQLSTATE codes. The web app maps each code to an error key.
--   RD004: the learner started 5 topic map builds in the last hour.

-- The MD5 of the lesson text. The product compares it with the hash of the last analysis, so it sees a changed lesson.
-- Both load paths write the markdown column, so the hash needs no change of the load functions.
-- A lesson with no text has no hash.
alter table public.lessons
add column content_hash text generated always as (md5(markdown)) stored;

-- The passages of each analysed lesson. A passage is one heading section of the lesson text.
-- The row holds no text. The text of a passage is the part of the lesson text from start_offset to end_offset.
-- lesson_url is the stable key of a lesson in a course, because a reload gives the lesson rows new ids.
create table public.passages (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null,
  -- The owner of the course. Row-level security reads it.
  user_id uuid not null,
  lesson_url text not null,
  -- The content hash of the lesson text that the passages come from.
  lesson_hash text not null,
  -- The place of the passage in the lesson. The first passage has position 1.
  position integer not null constraint passages_position_check check (position >= 1),
  -- The titles of the headings above the passage, from level 1 down. Empty for the text before the first heading.
  heading_path text[] not null default '{}',
  start_offset integer not null,
  end_offset integer not null,
  -- The SHA-256 of the passage text, as hex.
  content_hash text not null,
  constraint passages_offsets_check check (start_offset >= 0 and end_offset >= start_offset),
  constraint passages_course_fkey foreign key (course_id, user_id)
    references public.courses (id, user_id) on delete cascade,
  constraint passages_course_lesson_position_key unique (course_id, lesson_url, position),
  -- The links and the relations refer to this pair, so they always have the owner of the passage.
  constraint passages_id_user_key unique (id, user_id)
);

-- The topics of a learner. A topic has no course column. course_topics holds the topics of each course.
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The name that the map shows.
  name text not null constraint topics_name_check check (btrim(name) <> ''),
  -- One sentence from the engine.
  description text,
  -- The topic that replaces this topic after a merge. A delete of that topic clears the column.
  merged_into uuid,
  -- The time when the topic lost its last link. A retired topic keeps its row and its id.
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  -- The run of finish_topic_map that created the topic.
  created_by_run uuid,
  constraint topics_merged_into_check check (merged_into <> id),
  -- The other knowledge tables refer to this pair, so they always have the owner of the topic.
  constraint topics_id_user_key unique (id, user_id),
  -- A topic merges only into a topic of the same learner.
  constraint topics_merged_into_fkey foreign key (merged_into, user_id)
    references public.topics (id, user_id) on delete set null (merged_into)
);

-- The alias names of each topic. The name rule of the worker gives the normalized form.
-- Two names with the same normalized form are one name of the topic.
create table public.topic_aliases (
  topic_id uuid not null,
  user_id uuid not null,
  alias text not null,
  normalized text not null,
  constraint topic_aliases_pkey primary key (topic_id, normalized),
  constraint topic_aliases_topic_fkey foreign key (topic_id, user_id)
    references public.topics (id, user_id) on delete cascade
);

-- The topics of each course. The home lesson is the lesson where the map shows the topic.
-- home_lesson_url is null when the topic has no link in the course, for example a retired topic.
create table public.course_topics (
  course_id uuid not null,
  topic_id uuid not null,
  user_id uuid not null,
  home_lesson_url text,
  constraint course_topics_pkey primary key (course_id, topic_id),
  constraint course_topics_course_fkey foreign key (course_id, user_id)
    references public.courses (id, user_id) on delete cascade,
  constraint course_topics_topic_fkey foreign key (topic_id, user_id)
    references public.topics (id, user_id) on delete cascade
);

-- The evidence of a topic: one quote from one passage.
-- passage_hash is the content hash of the passage when the link was written.
-- A passage with a different hash shows that the link points at an old text.
create table public.topic_links (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null,
  passage_id uuid not null,
  user_id uuid not null,
  passage_hash text not null,
  -- explains: the passage teaches the topic. mentions: the passage uses the topic.
  role text not null constraint topic_links_role_check check (role in ('explains', 'mentions')),
  -- An exact extract of the passage. The quote check of the worker proves it.
  quote text not null,
  -- The start offset of the quote in the passage text.
  quote_start integer not null constraint topic_links_quote_start_check check (quote_start >= 0),
  -- The run of finish_topic_map that wrote the link last.
  run_id uuid,
  constraint topic_links_topic_passage_key unique (topic_id, passage_id),
  constraint topic_links_topic_fkey foreign key (topic_id, user_id)
    references public.topics (id, user_id) on delete cascade,
  constraint topic_links_passage_fkey foreign key (passage_id, user_id)
    references public.passages (id, user_id) on delete cascade
);

-- A relation between two topics, with the passage that gives it.
-- prerequisite: the from topic comes before the to topic. part_of: the from topic is a part of the to topic.
create table public.topic_relations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null constraint topic_relations_kind_check check (kind in ('prerequisite', 'part_of')),
  from_topic_id uuid not null,
  to_topic_id uuid not null,
  reason text,
  source_passage_id uuid not null,
  -- The run of finish_topic_map that wrote the relation last.
  run_id uuid,
  constraint topic_relations_self_check check (from_topic_id <> to_topic_id),
  constraint topic_relations_kind_from_to_source_key unique (kind, from_topic_id, to_topic_id, source_passage_id),
  constraint topic_relations_from_topic_fkey foreign key (from_topic_id, user_id)
    references public.topics (id, user_id) on delete cascade,
  constraint topic_relations_to_topic_fkey foreign key (to_topic_id, user_id)
    references public.topics (id, user_id) on delete cascade,
  constraint topic_relations_source_passage_fkey foreign key (source_passage_id, user_id)
    references public.passages (id, user_id) on delete cascade
);

-- The last analysis of each lesson of a course. A new start of a topic job reads these rows,
-- so it continues where the last start stopped.
-- content_hash is the hash of the lesson text that the last analysis read.
-- A failed analysis keeps the result, the engine fields and the passages of the last good analysis.
create table public.lesson_analyses (
  course_id uuid not null,
  user_id uuid not null,
  lesson_url text not null,
  content_hash text not null,
  status text not null constraint lesson_analyses_status_check check (status in ('analysed', 'failed')),
  -- A short reason that is safe to show to the learner. Only a failed analysis has one.
  error text,
  engine text,
  prompt_version text,
  model text,
  input_tokens integer,
  output_tokens integer,
  -- The engine answer after the checks of the worker.
  result jsonb,
  analysed_at timestamptz not null default now(),
  run_id uuid,
  constraint lesson_analyses_pkey primary key (course_id, lesson_url),
  constraint lesson_analyses_error_check check ((status = 'failed') = (error is not null)),
  constraint lesson_analyses_course_fkey foreign key (course_id, user_id)
    references public.courses (id, user_id) on delete cascade
);

-- The last map build of each course.
-- overview holds the lesson boxes and the arrows between lessons. report holds the counts of the build.
create table public.course_maps (
  course_id uuid not null,
  user_id uuid not null,
  built_at timestamptz not null default now(),
  run_id uuid,
  overview jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  constraint course_maps_pkey primary key (course_id),
  constraint course_maps_course_fkey foreign key (course_id, user_id)
    references public.courses (id, user_id) on delete cascade
);

-- The reads by course and lesson use the unique keys and the primary keys above.
-- These indexes cover the reads by topic and by passage, and the deletes that cascade.
create index topics_user_idx on public.topics (user_id);
create index topics_merged_into_idx on public.topics (merged_into) where merged_into is not null;
create index course_topics_topic_idx on public.course_topics (topic_id);
create index course_topics_home_lesson_idx on public.course_topics (course_id, home_lesson_url);
create index topic_links_passage_idx on public.topic_links (passage_id);
create index topic_relations_from_topic_idx on public.topic_relations (from_topic_id);
create index topic_relations_to_topic_idx on public.topic_relations (to_topic_id);
create index topic_relations_source_passage_idx on public.topic_relations (source_passage_id);

alter table public.passages enable row level security;
alter table public.topics enable row level security;
alter table public.topic_aliases enable row level security;
alter table public.course_topics enable row level security;
alter table public.topic_links enable row level security;
alter table public.topic_relations enable row level security;
alter table public.lesson_analyses enable row level security;
alter table public.course_maps enable row level security;

create policy "Authenticated users can select their own passages"
on public.passages
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can select their own topics"
on public.topics
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can select their own topic aliases"
on public.topic_aliases
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can select their own course topics"
on public.course_topics
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can select their own topic links"
on public.topic_links
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can select their own topic relations"
on public.topic_relations
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can select their own lesson analyses"
on public.lesson_analyses
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can select their own course maps"
on public.course_maps
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Anonymous users get no access to the knowledge tables.
-- Signed-in users can only read them. The worker functions write them.
revoke all on public.passages from anon, authenticated;
revoke all on public.topics from anon, authenticated;
revoke all on public.topic_aliases from anon, authenticated;
revoke all on public.course_topics from anon, authenticated;
revoke all on public.topic_links from anon, authenticated;
revoke all on public.topic_relations from anon, authenticated;
revoke all on public.lesson_analyses from anon, authenticated;
revoke all on public.course_maps from anon, authenticated;

grant select on public.passages to authenticated;
grant select on public.topics to authenticated;
grant select on public.topic_aliases to authenticated;
grant select on public.course_topics to authenticated;
grant select on public.topic_links to authenticated;
grant select on public.topic_relations to authenticated;
grant select on public.lesson_analyses to authenticated;
grant select on public.course_maps to authenticated;

-- A delete of a course removes the topics that belong to no other course. The cascade removes their alias names.
-- The cascades of the course remove the rows of the other knowledge tables.
-- The function runs as its owner, because a learner has no delete right on topics.
-- It deletes only topics of the owner of the course.
-- The learner state slice (S-03) must look at this rule again, because learner state will point at topic ids.
create function public.delete_course_topics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.topics as t
  where t.user_id = old.user_id
    and exists (
      select 1
      from public.course_topics as ct
      where ct.topic_id = t.id
        and ct.course_id = old.id
    )
    and not exists (
      select 1
      from public.course_topics as other
      where other.topic_id = t.id
        and other.course_id <> old.id
    );

  return old;
end;
$$;

revoke execute on function public.delete_course_topics() from public, anon, authenticated, service_role;

create trigger courses_delete_topics
before delete on public.courses
for each row
execute function public.delete_course_topics();

-- The jobs table can now hold topic map builds. The payload of a build_topic_map job is { "courseId": "<uuid>" }.
alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type in ('demo', 'load_course', 'build_topic_map'));

-- A learner can insert a job through the Supabase API, so the database checks each build_topic_map job.
-- The course must belong to the owner of the job row and must be ready.
-- The check reads the user_id of the row, not auth.uid(), because the worker inserts the job after a crawl.
-- A learner starts at most 5 build_topic_map jobs in one hour. Each job makes one model call for each changed lesson.
-- The function runs as the caller. A learner sees only their own courses and jobs, so the checks hold for each caller.
create function public.check_topic_map_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  course_id text;
begin
  if jsonb_typeof(new.payload -> 'courseId') is distinct from 'string' then
    raise exception 'A build_topic_map job needs a courseId.' using errcode = 'check_violation';
  end if;

  course_id := new.payload ->> 'courseId';

  if course_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A build_topic_map job needs a courseId.' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.courses as c
    where c.id = course_id::uuid
      and c.user_id = new.user_id
      and c.status = 'ready'
  ) then
    raise exception 'A build_topic_map job needs a ready course of the same learner.' using errcode = 'check_violation';
  end if;

  if (
    select count(*)
    from public.jobs as j
    where j.user_id = new.user_id
      and j.type = 'build_topic_map'
      and j.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'A learner can start at most 5 topic map builds in one hour.' using errcode = 'RD004';
  end if;

  return new;
end;
$$;

create trigger jobs_check_topic_map_payload
before insert on public.jobs
for each row
when (new.type = 'build_topic_map')
execute function public.check_topic_map_payload();

-- Start the topic job when a crawl load ends ready. The insert runs in the transaction of complete_job.
-- A refusal of the insert must not fail the load job. These refusals insert nothing, and the load job stays done:
-- the quota (RD004), a course that is not ready (check_violation), and a job in progress (unique_violation).
-- The function runs as the caller. Only the worker functions set a job done, with the service key.
create function public.start_topic_map_after_load()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  begin
    insert into public.jobs (user_id, type, payload)
    values (new.user_id, 'build_topic_map', jsonb_build_object('courseId', new.payload -> 'courseId'));
  exception
    when sqlstate 'RD004' or check_violation or unique_violation then
      null;
  end;

  return null;
end;
$$;

create trigger jobs_start_topic_map
after update on public.jobs
for each row
when (
  new.type = 'load_course'
  and new.status = 'done'
  and old.status <> 'done'
  and new.result ->> 'outcome' = 'ready'
)
execute function public.start_topic_map_after_load();

-- The worker functions follow. The worker calls them with the service key.
-- Row-level security does not apply to service_role, so these functions run as the caller.

-- Return the input of a topic job as one JSON document, or null when the course is gone:
-- course: { id, user_id, title, source_url, source_kind, status }
-- lessons: the loaded lessons in course order, as { url, position, title, content_hash }, with no text
-- analyses: the lesson analyses of the course, as { lesson_url, content_hash, status, error, engine, prompt_version,
--   model, input_tokens, output_tokens, result, analysed_at, run_id }
-- topics: the topics of the course, as { id, name, description, merged_into, retired_at, created_at,
--   home_lesson_url, aliases: [{ alias, normalized }] }
create function public.start_topic_map(course_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'course', jsonb_build_object(
      'id', c.id,
      'user_id', c.user_id,
      'title', c.title,
      'source_url', c.source_url,
      'source_kind', c.source_kind,
      'status', c.status
    ),
    'lessons', coalesce((
      select jsonb_agg(
        jsonb_build_object('url', l.url, 'position', l.position, 'title', l.title, 'content_hash', l.content_hash)
        order by l.position
      )
      from public.lessons as l
      where l.course_id = c.id
        and l.status = 'loaded'
    ), '[]'::jsonb),
    'analyses', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lesson_url', a.lesson_url,
          'content_hash', a.content_hash,
          'status', a.status,
          'error', a.error,
          'engine', a.engine,
          'prompt_version', a.prompt_version,
          'model', a.model,
          'input_tokens', a.input_tokens,
          'output_tokens', a.output_tokens,
          'result', a.result,
          'analysed_at', a.analysed_at,
          'run_id', a.run_id
        )
        order by a.lesson_url
      )
      from public.lesson_analyses as a
      where a.course_id = c.id
    ), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'description', t.description,
          'merged_into', t.merged_into,
          'retired_at', t.retired_at,
          'created_at', t.created_at,
          'home_lesson_url', ct.home_lesson_url,
          'aliases', coalesce((
            select jsonb_agg(jsonb_build_object('alias', ta.alias, 'normalized', ta.normalized) order by ta.normalized)
            from public.topic_aliases as ta
            where ta.topic_id = t.id
          ), '[]'::jsonb)
        )
        order by t.created_at, t.id
      )
      from public.course_topics as ct
      join public.topics as t on t.id = ct.topic_id
      where ct.course_id = c.id
    ), '[]'::jsonb)
  )
  from public.courses as c
  where c.id = start_topic_map.course_id;
$$;

-- Return the Markdown of one loaded lesson, or null when the course has no loaded lesson with this URL.
create function public.read_lesson_text(course_id uuid, lesson_url text)
returns text
language sql
stable
set search_path = ''
as $$
  select l.markdown
  from public.lessons as l
  where l.course_id = read_lesson_text.course_id
    and l.url = read_lesson_text.lesson_url
    and l.status = 'loaded';
$$;

-- Store the result of one lesson. The passages of the lesson change in the same transaction.
-- status is analysed or failed. content_hash is the hash of the lesson text that the worker read.
-- passages is an array of { position, heading_path, start_offset, end_offset, content_hash }.
-- An analysed lesson replaces its passages. A passage keeps its id when its position stays, so the links of the
-- current map stay until finish_topic_map writes the new map. A passage at a position that is gone goes with its links.
-- A failed lesson keeps its passages, its last result and the engine fields of that result.
-- It gets the status failed, the reason, the hash of the text that failed, the run and the time.
-- Returns false when the course is gone or has no loaded lesson with this URL.
create function public.save_lesson_analysis(
  course_id uuid,
  lesson_url text,
  content_hash text,
  status text,
  run_id uuid,
  error text default null,
  engine text default null,
  prompt_version text default null,
  model text default null,
  input_tokens integer default null,
  output_tokens integer default null,
  result jsonb default null,
  passages jsonb default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  select c.user_id
  into owner_id
  from public.courses as c
  join public.lessons as l on l.course_id = c.id
  where c.id = save_lesson_analysis.course_id
    and l.url = save_lesson_analysis.lesson_url
    and l.status = 'loaded';

  if not found then
    return false;
  end if;

  if save_lesson_analysis.status = 'failed' then
    insert into public.lesson_analyses as a (
      course_id, user_id, lesson_url, content_hash, status, error,
      engine, prompt_version, model, input_tokens, output_tokens, result, analysed_at, run_id
    )
    values (
      save_lesson_analysis.course_id,
      owner_id,
      save_lesson_analysis.lesson_url,
      save_lesson_analysis.content_hash,
      'failed',
      left(save_lesson_analysis.error, 300),
      save_lesson_analysis.engine,
      save_lesson_analysis.prompt_version,
      save_lesson_analysis.model,
      save_lesson_analysis.input_tokens,
      save_lesson_analysis.output_tokens,
      save_lesson_analysis.result,
      now(),
      save_lesson_analysis.run_id
    )
    on conflict on constraint lesson_analyses_pkey do update
    set content_hash = excluded.content_hash,
        status = excluded.status,
        error = excluded.error,
        analysed_at = excluded.analysed_at,
        run_id = excluded.run_id;

    return true;
  end if;

  if save_lesson_analysis.status is distinct from 'analysed'
    or save_lesson_analysis.result is null
    or jsonb_typeof(save_lesson_analysis.passages) is distinct from 'array' then
    raise exception 'An analysed lesson needs a result and a passage list.' using errcode = 'check_violation';
  end if;

  delete from public.passages as p
  where p.course_id = save_lesson_analysis.course_id
    and p.lesson_url = save_lesson_analysis.lesson_url
    and not exists (
      select 1
      from jsonb_to_recordset(save_lesson_analysis.passages) as x(position integer)
      where x.position = p.position
    );

  insert into public.passages as p (
    course_id, user_id, lesson_url, lesson_hash, position, heading_path, start_offset, end_offset, content_hash
  )
  select
    save_lesson_analysis.course_id,
    owner_id,
    save_lesson_analysis.lesson_url,
    save_lesson_analysis.content_hash,
    x.position,
    coalesce(x.heading_path, '{}'),
    x.start_offset,
    x.end_offset,
    x.content_hash
  from jsonb_to_recordset(save_lesson_analysis.passages)
    as x(position integer, heading_path text[], start_offset integer, end_offset integer, content_hash text)
  on conflict on constraint passages_course_lesson_position_key do update
  set lesson_hash = excluded.lesson_hash,
      heading_path = excluded.heading_path,
      start_offset = excluded.start_offset,
      end_offset = excluded.end_offset,
      content_hash = excluded.content_hash
  where (p.lesson_hash, p.heading_path, p.start_offset, p.end_offset, p.content_hash)
    is distinct from (excluded.lesson_hash, excluded.heading_path, excluded.start_offset, excluded.end_offset,
                      excluded.content_hash);

  insert into public.lesson_analyses as a (
    course_id, user_id, lesson_url, content_hash, status, error,
    engine, prompt_version, model, input_tokens, output_tokens, result, analysed_at, run_id
  )
  values (
    save_lesson_analysis.course_id,
    owner_id,
    save_lesson_analysis.lesson_url,
    save_lesson_analysis.content_hash,
    'analysed',
    null,
    save_lesson_analysis.engine,
    save_lesson_analysis.prompt_version,
    save_lesson_analysis.model,
    save_lesson_analysis.input_tokens,
    save_lesson_analysis.output_tokens,
    save_lesson_analysis.result,
    now(),
    save_lesson_analysis.run_id
  )
  on conflict on constraint lesson_analyses_pkey do update
  set content_hash = excluded.content_hash,
      status = excluded.status,
      error = excluded.error,
      engine = excluded.engine,
      prompt_version = excluded.prompt_version,
      model = excluded.model,
      input_tokens = excluded.input_tokens,
      output_tokens = excluded.output_tokens,
      result = excluded.result,
      analysed_at = excluded.analysed_at,
      run_id = excluded.run_id;

  return true;
end;
$$;

-- Write the map of a course in one transaction, so the map never shows a mix of two runs.
-- state is { topics, links, relations, overview, report }:
--   topics: [{ id, name, description, aliases: [{ alias, normalized }], home_lesson_url, merged_into, retired }]
--     id is the id of a stored topic, or a new id that the worker makes for a new topic.
--     merged_into is the id of the topic that replaces this topic, or null.
--     retired is true for a topic with no link left in the course.
--   links: [{ topic_id, lesson_url, position, role, quote, quote_start }]
--   relations: [{ kind, from_topic_id, to_topic_id, reason, lesson_url, position }]
--     lesson_url and position name the passage of a link, or the source passage of a relation.
--   overview, report: the JSON documents of course_maps.
-- The function keeps each topic id that the state names, and inserts each topic that does not exist yet.
-- It replaces the alias names of these topics, and the links, the relations and the course_topics rows of the course.
-- A topic that the state does not name leaves the course. Its row stays.
-- It removes the analyses and the passages of each lesson that is no longer a loaded lesson of the course.
-- It writes the course_maps row. The function writes no row that stays the same,
-- so a second call with the same state changes no row.
-- A link or a relation with a passage that does not exist raises check_violation, and the old map stays.
-- Returns false when the course is gone.
create function public.finish_topic_map(course_id uuid, run_id uuid, state jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  -- The lock makes two calls for the same course write one after the other.
  select c.user_id
  into owner_id
  from public.courses as c
  where c.id = finish_topic_map.course_id
  for update;

  if not found then
    return false;
  end if;

  if jsonb_typeof(finish_topic_map.state -> 'topics') is distinct from 'array'
    or jsonb_typeof(finish_topic_map.state -> 'links') is distinct from 'array'
    or jsonb_typeof(finish_topic_map.state -> 'relations') is distinct from 'array' then
    raise exception 'The state needs the arrays topics, links and relations.' using errcode = 'check_violation';
  end if;

  -- The analyses and the passages of the lessons that are gone. The links and the relations of a passage go with it.
  delete from public.passages as p
  where p.course_id = finish_topic_map.course_id
    and not exists (
      select 1
      from public.lessons as l
      where l.course_id = p.course_id
        and l.url = p.lesson_url
        and l.status = 'loaded'
    );

  delete from public.lesson_analyses as a
  where a.course_id = finish_topic_map.course_id
    and not exists (
      select 1
      from public.lessons as l
      where l.course_id = a.course_id
        and l.url = a.lesson_url
        and l.status = 'loaded'
    );

  if exists (
    select 1
    from jsonb_to_recordset(finish_topic_map.state -> 'links') as x(lesson_url text, position integer)
    where not exists (
      select 1
      from public.passages as p
      where p.course_id = finish_topic_map.course_id
        and p.lesson_url = x.lesson_url
        and p.position = x.position
    )
  ) or exists (
    select 1
    from jsonb_to_recordset(finish_topic_map.state -> 'relations') as x(lesson_url text, position integer)
    where not exists (
      select 1
      from public.passages as p
      where p.course_id = finish_topic_map.course_id
        and p.lesson_url = x.lesson_url
        and p.position = x.position
    )
  ) then
    raise exception 'A link or a relation names a passage that does not exist.' using errcode = 'check_violation';
  end if;

  -- The topics. A new topic gets its id from the state. The insert skips each topic that exists.
  -- An id of a topic of another learner stops at the owner check of course_topics below.
  insert into public.topics as t (id, user_id, name, description, merged_into, retired_at, created_by_run)
  select
    x.id,
    owner_id,
    x.name,
    x.description,
    x.merged_into,
    case when coalesce(x.retired, false) then now() end,
    finish_topic_map.run_id
  from jsonb_to_recordset(finish_topic_map.state -> 'topics')
    as x(id uuid, name text, description text, merged_into uuid, retired boolean)
  on conflict on constraint topics_pkey do nothing;

  -- A retired topic keeps the time when it retired first.
  update public.topics as t
  set name = x.name,
      description = x.description,
      merged_into = x.merged_into,
      retired_at = case when coalesce(x.retired, false) then coalesce(t.retired_at, now()) end
  from jsonb_to_recordset(finish_topic_map.state -> 'topics')
    as x(id uuid, name text, description text, merged_into uuid, retired boolean)
  where t.id = x.id
    and t.user_id = owner_id
    and (t.name, t.description, t.merged_into, t.retired_at is not null)
      is distinct from (x.name, x.description, x.merged_into, coalesce(x.retired, false));

  -- The alias names of the topics in the state.
  delete from public.topic_aliases as ta
  where ta.user_id = owner_id
    and ta.topic_id in (
      select x.id
      from jsonb_to_recordset(finish_topic_map.state -> 'topics') as x(id uuid)
    )
    and not exists (
      select 1
      from jsonb_to_recordset(finish_topic_map.state -> 'topics') as x(id uuid, aliases jsonb)
      cross join lateral jsonb_to_recordset(coalesce(x.aliases, '[]'::jsonb)) as y(normalized text)
      where x.id = ta.topic_id
        and y.normalized = ta.normalized
    );

  insert into public.topic_aliases as ta (topic_id, user_id, alias, normalized)
  select distinct on (x.id, y.normalized) x.id, owner_id, y.alias, y.normalized
  from jsonb_to_recordset(finish_topic_map.state -> 'topics') as x(id uuid, aliases jsonb)
  cross join lateral jsonb_to_recordset(coalesce(x.aliases, '[]'::jsonb)) as y(alias text, normalized text)
  order by x.id, y.normalized, y.alias
  on conflict on constraint topic_aliases_pkey do update
  set alias = excluded.alias
  where ta.alias is distinct from excluded.alias;

  -- The topics of the course and their home lessons.
  delete from public.course_topics as ct
  where ct.course_id = finish_topic_map.course_id
    and not exists (
      select 1
      from jsonb_to_recordset(finish_topic_map.state -> 'topics') as x(id uuid)
      where x.id = ct.topic_id
    );

  insert into public.course_topics as ct (course_id, topic_id, user_id, home_lesson_url)
  select distinct on (x.id) finish_topic_map.course_id, x.id, owner_id, x.home_lesson_url
  from jsonb_to_recordset(finish_topic_map.state -> 'topics') as x(id uuid, home_lesson_url text)
  order by x.id
  on conflict on constraint course_topics_pkey do update
  set home_lesson_url = excluded.home_lesson_url
  where ct.home_lesson_url is distinct from excluded.home_lesson_url;

  -- The links of the course: the links to a passage of the course.
  delete from public.topic_links as k
  using public.passages as p
  where p.id = k.passage_id
    and p.course_id = finish_topic_map.course_id
    and not exists (
      select 1
      from jsonb_to_recordset(finish_topic_map.state -> 'links')
        as x(topic_id uuid, lesson_url text, position integer)
      where x.topic_id = k.topic_id
        and x.lesson_url = p.lesson_url
        and x.position = p.position
    );

  insert into public.topic_links as k (topic_id, passage_id, user_id, passage_hash, role, quote, quote_start, run_id)
  select distinct on (x.topic_id, p.id)
    x.topic_id,
    p.id,
    owner_id,
    p.content_hash,
    x.role,
    x.quote,
    x.quote_start,
    finish_topic_map.run_id
  from jsonb_to_recordset(finish_topic_map.state -> 'links')
    as x(topic_id uuid, lesson_url text, position integer, role text, quote text, quote_start integer)
  join public.passages as p
    on p.course_id = finish_topic_map.course_id
    and p.lesson_url = x.lesson_url
    and p.position = x.position
  order by x.topic_id, p.id
  on conflict on constraint topic_links_topic_passage_key do update
  set passage_hash = excluded.passage_hash,
      role = excluded.role,
      quote = excluded.quote,
      quote_start = excluded.quote_start,
      run_id = excluded.run_id
  where (k.passage_hash, k.role, k.quote, k.quote_start)
    is distinct from (excluded.passage_hash, excluded.role, excluded.quote, excluded.quote_start);

  -- The relations of the course: the relations with a source passage of the course.
  delete from public.topic_relations as r
  using public.passages as p
  where p.id = r.source_passage_id
    and p.course_id = finish_topic_map.course_id
    and not exists (
      select 1
      from jsonb_to_recordset(finish_topic_map.state -> 'relations')
        as x(kind text, from_topic_id uuid, to_topic_id uuid, lesson_url text, position integer)
      where x.kind = r.kind
        and x.from_topic_id = r.from_topic_id
        and x.to_topic_id = r.to_topic_id
        and x.lesson_url = p.lesson_url
        and x.position = p.position
    );

  insert into public.topic_relations as r (user_id, kind, from_topic_id, to_topic_id, reason, source_passage_id, run_id)
  select distinct on (x.kind, x.from_topic_id, x.to_topic_id, p.id)
    owner_id,
    x.kind,
    x.from_topic_id,
    x.to_topic_id,
    x.reason,
    p.id,
    finish_topic_map.run_id
  from jsonb_to_recordset(finish_topic_map.state -> 'relations')
    as x(kind text, from_topic_id uuid, to_topic_id uuid, reason text, lesson_url text, position integer)
  join public.passages as p
    on p.course_id = finish_topic_map.course_id
    and p.lesson_url = x.lesson_url
    and p.position = x.position
  order by x.kind, x.from_topic_id, x.to_topic_id, p.id
  on conflict on constraint topic_relations_kind_from_to_source_key do update
  set reason = excluded.reason,
      run_id = excluded.run_id
  where r.reason is distinct from excluded.reason;

  insert into public.course_maps as m (course_id, user_id, built_at, run_id, overview, report)
  values (
    finish_topic_map.course_id,
    owner_id,
    now(),
    finish_topic_map.run_id,
    coalesce(finish_topic_map.state -> 'overview', '{}'::jsonb),
    coalesce(finish_topic_map.state -> 'report', '{}'::jsonb)
  )
  on conflict on constraint course_maps_pkey do update
  set built_at = excluded.built_at,
      run_id = excluded.run_id,
      overview = excluded.overview,
      report = excluded.report
  where (m.run_id, m.overview, m.report) is distinct from (excluded.run_id, excluded.overview, excluded.report);

  return true;
end;
$$;

-- Only the worker can call the worker functions.
revoke execute on function public.start_topic_map(uuid) from public, anon, authenticated;
revoke execute on function public.read_lesson_text(uuid, text) from public, anon, authenticated;
revoke execute on function public.save_lesson_analysis(
  uuid, text, text, text, uuid, text, text, text, text, integer, integer, jsonb, jsonb
) from public, anon, authenticated;
revoke execute on function public.finish_topic_map(uuid, uuid, jsonb) from public, anon, authenticated;

grant execute on function public.start_topic_map(uuid) to service_role;
grant execute on function public.read_lesson_text(uuid, text) to service_role;
grant execute on function public.save_lesson_analysis(
  uuid, text, text, text, uuid, text, text, text, text, integer, integer, jsonb, jsonb
) to service_role;
grant execute on function public.finish_topic_map(uuid, uuid, jsonb) to service_role;

-- The functions for the pages follow. They run as the caller, so row-level security holds.
-- Neither function reads a learner state table.

-- Return the state of the map of a course in one row, or no row when the caller cannot see the course:
-- built_at: the time of the last build, or null when the course has no map.
-- loaded_lessons: the lessons with text.
-- analysed_lessons, failed_lessons: the loaded lessons with an analysis of that status.
-- changed_lessons: the loaded lessons with no analysis, or with a text that differs from the text of the analysis.
-- gone_lessons: the analysed lessons that are no longer loaded lessons of the course.
-- topic_count: the topics of the course that are not merged and not retired.
create function public.topic_map_state(course_id uuid)
returns table (
  built_at timestamptz,
  loaded_lessons integer,
  analysed_lessons integer,
  failed_lessons integer,
  changed_lessons integer,
  gone_lessons integer,
  topic_count integer
)
language sql
stable
set search_path = ''
as $$
  select
    m.built_at,
    (
      select count(*)::integer
      from public.lessons as l
      where l.course_id = c.id
        and l.status = 'loaded'
    ),
    (
      select count(*)::integer
      from public.lessons as l
      join public.lesson_analyses as a on a.course_id = l.course_id and a.lesson_url = l.url
      where l.course_id = c.id
        and l.status = 'loaded'
        and a.status = 'analysed'
    ),
    (
      select count(*)::integer
      from public.lessons as l
      join public.lesson_analyses as a on a.course_id = l.course_id and a.lesson_url = l.url
      where l.course_id = c.id
        and l.status = 'loaded'
        and a.status = 'failed'
    ),
    (
      select count(*)::integer
      from public.lessons as l
      left join public.lesson_analyses as a on a.course_id = l.course_id and a.lesson_url = l.url
      where l.course_id = c.id
        and l.status = 'loaded'
        and (a.lesson_url is null or a.content_hash is distinct from l.content_hash)
    ),
    (
      select count(*)::integer
      from public.lesson_analyses as a
      where a.course_id = c.id
        and not exists (
          select 1
          from public.lessons as l
          where l.course_id = a.course_id
            and l.url = a.lesson_url
            and l.status = 'loaded'
        )
    ),
    (
      select count(*)::integer
      from public.course_topics as ct
      join public.topics as t on t.id = ct.topic_id
      where ct.course_id = c.id
        and t.merged_into is null
        and t.retired_at is null
    )
  from public.courses as c
  left join public.course_maps as m on m.course_id = c.id
  where c.id = topic_map_state.course_id;
$$;

-- Return one lesson of the map as one JSON document, or null when the caller cannot see the lesson:
-- lesson: { url, position, title }
-- topics: the topics whose home lesson is this lesson, in text order, as { id, name, description,
--   parent: { id, name, home_lesson_url } or null,
--   links: [{ lesson_url, lesson_position, lesson_title, passage_position, heading_path, role, quote, quote_start }] }
--   The links cover each lesson of the course that explains or mentions the topic.
-- relations: the relations of the course with an end in this lesson, one for each kind and pair of topics,
--   as { kind, from_topic_id, to_topic_id, reason }
-- others: the topics at the other end of these relations, as { id, name, home_lesson_url, home_lesson_position }
create function public.topic_map_lesson(course_id uuid, lesson_url text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with lesson as (
    select l.course_id, l.url, l.position, l.title
    from public.lessons as l
    where l.course_id = topic_map_lesson.course_id
      and l.url = topic_map_lesson.lesson_url
  ),
  home as (
    -- The live topics of this lesson, with the place of their first link in the lesson.
    select
      t.id,
      t.name,
      t.description,
      (
        select min(p.position)
        from public.topic_links as k
        join public.passages as p on p.id = k.passage_id
        where k.topic_id = t.id
          and p.course_id = lesson.course_id
          and p.lesson_url = lesson.url
      ) as first_position
    from lesson
    join public.course_topics as ct on ct.course_id = lesson.course_id and ct.home_lesson_url = lesson.url
    join public.topics as t on t.id = ct.topic_id
    where t.merged_into is null
      and t.retired_at is null
  ),
  relations as (
    -- One relation for each kind and pair of topics, with the reason of the first source passage in course order.
    select distinct on (r.kind, r.from_topic_id, r.to_topic_id)
      r.kind,
      r.from_topic_id,
      r.to_topic_id,
      r.reason
    from public.topic_relations as r
    join public.passages as p on p.id = r.source_passage_id
    left join public.lessons as sl on sl.course_id = p.course_id and sl.url = p.lesson_url
    where p.course_id = topic_map_lesson.course_id
      and (r.from_topic_id in (select h.id from home as h) or r.to_topic_id in (select h.id from home as h))
    order by r.kind, r.from_topic_id, r.to_topic_id, sl.position nulls last, p.position
  )
  select jsonb_build_object(
    'lesson', jsonb_build_object('url', lesson.url, 'position', lesson.position, 'title', lesson.title),
    'topics', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'name', h.name,
          'description', h.description,
          'parent', (
            select jsonb_build_object('id', pt.id, 'name', pt.name, 'home_lesson_url', pct.home_lesson_url)
            from relations as r
            join public.topics as pt on pt.id = r.to_topic_id
            left join public.course_topics as pct on pct.course_id = lesson.course_id and pct.topic_id = pt.id
            where r.kind = 'part_of'
              and r.from_topic_id = h.id
            order by pt.name, pt.id
            limit 1
          ),
          'links', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'lesson_url', p.lesson_url,
                'lesson_position', ll.position,
                'lesson_title', ll.title,
                'passage_position', p.position,
                'heading_path', to_jsonb(p.heading_path),
                'role', k.role,
                'quote', k.quote,
                'quote_start', k.quote_start
              )
              order by ll.position nulls last, p.position
            )
            from public.topic_links as k
            join public.passages as p on p.id = k.passage_id
            left join public.lessons as ll on ll.course_id = p.course_id and ll.url = p.lesson_url
            where k.topic_id = h.id
              and p.course_id = lesson.course_id
          ), '[]'::jsonb)
        )
        order by h.first_position nulls last, h.name, h.id
      )
      from home as h
    ), '[]'::jsonb),
    'relations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'kind', r.kind,
          'from_topic_id', r.from_topic_id,
          'to_topic_id', r.to_topic_id,
          'reason', r.reason
        )
        order by r.kind, r.from_topic_id, r.to_topic_id
      )
      from relations as r
    ), '[]'::jsonb),
    'others', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'home_lesson_url', ct.home_lesson_url,
          'home_lesson_position', hl.position
        )
        order by hl.position nulls last, t.name, t.id
      )
      from public.topics as t
      left join public.course_topics as ct on ct.course_id = lesson.course_id and ct.topic_id = t.id
      left join public.lessons as hl on hl.course_id = lesson.course_id and hl.url = ct.home_lesson_url
      where t.id in (
          select r.from_topic_id from relations as r
          union
          select r.to_topic_id from relations as r
        )
        and t.id not in (select h.id from home as h)
    ), '[]'::jsonb)
  )
  from lesson;
$$;

-- Only a signed-in learner can call the functions for the pages.
revoke execute on function public.topic_map_state(uuid) from public, anon, service_role;
revoke execute on function public.topic_map_lesson(uuid, text) from public, anon, service_role;

grant execute on function public.topic_map_state(uuid) to authenticated;
grant execute on function public.topic_map_lesson(uuid, text) to authenticated;
