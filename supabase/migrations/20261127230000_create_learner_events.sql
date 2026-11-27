-- The events of each learner. This is the first learner state table. It sits beside the knowledge tables of the
-- topic map and changes none of them. Each mark of a topic is one event, and an event never changes.
-- The web app reads the events of a course and computes the state of each topic from them.
--
-- The rules of this table:
-- 1. No knowledge table points at this table. Each event points at its course and at its topic.
-- 2. No view and no function returns map data joined with this table.
--    The pages read the topic list and the events in two calls, and join them in code.
-- 3. A learner inserts and reads only their own events. A learner cannot update or delete an event.
--    Anonymous users get no access.
-- 4. A course delete removes the events of the course, through the topic and through the course.
--    The trigger courses_delete_topics deletes the topics that belong to no other course, and the cascade of each
--    topic removes its events. The cascade of the course removes the events of a topic that stays in another course.
--    So the rule of courses_delete_topics stays as it is. The topic map migration asked S-03 to look at this rule.
--
-- The kinds of event:
--   mark_known: the learner marks the topic as known.
--   unmark_known: the learner removes the mark.
--
-- The order of the events is created_at, then id, so two events never tie. The newest event decides the state of a
-- topic, and an event of a merged topic counts for the topic that replaces it.

create table public.learner_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null,
  topic_id uuid not null,
  -- S-06 adds its answer events to this check.
  kind text not null constraint learner_events_kind_check check (kind in ('mark_known', 'unmark_known')),
  -- clock_timestamp() gives the time of each insert. now() gives the start of the transaction,
  -- so it gives the same time to each event of one transaction.
  created_at timestamptz not null default clock_timestamp(),
  -- The course and the topic belong to the owner of the event.
  -- No foreign key points at course_topics, because finish_topic_map deletes the row of a topic that leaves a course.
  -- The insert check below reads course_topics instead.
  constraint learner_events_course_fkey foreign key (course_id, user_id)
    references public.courses (id, user_id) on delete cascade,
  constraint learner_events_topic_fkey foreign key (topic_id, user_id)
    references public.topics (id, user_id) on delete cascade
);

-- learner_course_events reads the events of one course in this order. The cascade of a course delete uses it too.
create index learner_events_course_created_idx on public.learner_events (course_id, created_at, id);

alter table public.learner_events enable row level security;

create policy "Authenticated users can select their own learner events"
on public.learner_events
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can insert their own learner events"
on public.learner_events
for insert
to authenticated
with check ((select auth.uid()) = user_id);

-- Anonymous users get no access to the events.
-- Signed-in users can read their events and insert an event. They can set only the course, the topic and the kind.
-- Every other column takes its default. They get no update and no delete, so an event never changes.
revoke all on public.learner_events from anon, authenticated;
grant select on public.learner_events to authenticated;
grant insert (course_id, topic_id, kind) on public.learner_events to authenticated;

-- A learner inserts events through the Supabase API, so the database checks each event.
-- The topic of the event must be a topic of the course of the event, so a course_topics row must have both ids.
-- A merged topic and a retired topic keep their course_topics row, so an event for them passes.
-- The function runs as the caller. Row-level security hides the course topics of a different learner,
-- so an event for the course of a different learner also fails here.
-- The function returns no data, so rule 2 holds.
create function public.check_learner_event_topic()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.course_topics as ct
    where ct.course_id = new.course_id
      and ct.topic_id = new.topic_id
  ) then
    raise exception 'A learner event needs a topic of the course of the event.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger learner_events_check_topic
before insert on public.learner_events
for each row
execute function public.check_learner_event_topic();

-- The functions for the pages follow. They run as the caller, so row-level security holds.
-- course_topic_list reads no learner data, and learner_course_events reads only learner_events.
-- Each function returns one jsonb value, so the row limit of the API does not cut the result.

-- Return the live topics of a course as one JSON document, or null when the caller cannot see the course:
-- lessons: each lesson that is the home lesson of a live topic, in course order, as { url, position, title }
-- topics: each live topic with a home lesson, as { id, name, description, home_lesson_url, parent_id }.
--   A live topic is not merged and not retired. The order is the position of the home lesson, then the text order
--   of topic_map_lesson: the first link in the home lesson, then the name, then the id.
--   A link counts only while its passage keeps the text of the link.
--   parent_id follows the parent rule of topic_map_lesson: the first part_of parent by name and id, from a relation
--   with a source passage in the course. The parent can be a topic that is not in the list.
-- merged: each topic of the course that is merged, as { id, merged_into }
create function public.course_topic_list(course_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with live as (
    -- The live topics of the course, with their home lesson and the place of their first link in that lesson.
    select
      t.id,
      t.name,
      t.description,
      l.url as home_lesson_url,
      l.position as home_lesson_position,
      (
        select min(p.position)
        from public.topic_links as k
        join public.passages as p on p.id = k.passage_id
        where k.topic_id = t.id
          and p.course_id = l.course_id
          and p.lesson_url = l.url
          and k.passage_hash = p.content_hash
      ) as first_position
    from public.course_topics as ct
    join public.topics as t on t.id = ct.topic_id
    join public.lessons as l on l.course_id = ct.course_id and l.url = ct.home_lesson_url
    where ct.course_id = course_topic_list.course_id
      and t.merged_into is null
      and t.retired_at is null
  )
  select jsonb_build_object(
    'lessons', coalesce((
      select jsonb_agg(jsonb_build_object('url', l.url, 'position', l.position, 'title', l.title) order by l.position)
      from public.lessons as l
      where l.course_id = c.id
        and l.url in (select h.home_lesson_url from live as h)
    ), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'name', h.name,
          'description', h.description,
          'home_lesson_url', h.home_lesson_url,
          'parent_id', (
            select pt.id
            from public.topic_relations as r
            join public.passages as p on p.id = r.source_passage_id
            join public.topics as pt on pt.id = r.to_topic_id
            where r.kind = 'part_of'
              and r.from_topic_id = h.id
              and p.course_id = c.id
            order by pt.name, pt.id
            limit 1
          )
        )
        order by h.home_lesson_position, h.first_position nulls last, h.name, h.id
      )
      from live as h
    ), '[]'::jsonb),
    'merged', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'merged_into', t.merged_into) order by t.id)
      from public.course_topics as ct
      join public.topics as t on t.id = ct.topic_id
      where ct.course_id = c.id
        and t.merged_into is not null
    ), '[]'::jsonb)
  )
  from public.courses as c
  where c.id = course_topic_list.course_id;
$$;

-- Return the events of the caller for one course as one JSON array, in the order created_at, then id:
-- [{ id, topic_id, kind, created_at }]. The array is empty when the caller has no event in the course.
-- The filter on the caller repeats the select policy, so the result never holds the events of a different learner.
create function public.learner_course_events(course_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id', e.id, 'topic_id', e.topic_id, 'kind', e.kind, 'created_at', e.created_at)
      order by e.created_at, e.id
    ),
    '[]'::jsonb
  )
  from public.learner_events as e
  where e.course_id = learner_course_events.course_id
    and e.user_id = (select auth.uid());
$$;

-- Only a signed-in learner can call the functions for the pages.
revoke execute on function public.course_topic_list(uuid) from public, anon, service_role;
revoke execute on function public.learner_course_events(uuid) from public, anon, service_role;

grant execute on function public.course_topic_list(uuid) to authenticated;
grant execute on function public.learner_course_events(uuid) to authenticated;
