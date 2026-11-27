-- The fixes F1 and F2 of the implementation review of course-topic-graph.
-- The report is context/changes/course-topic-graph/reviews/impl-review.md.
--
-- F1: retry_job refuses a build_topic_map job. The limit of 5 topic map builds in one hour (RD004) counts only the
-- inserted jobs, and a retry gives a failed job 3 new starts. So a retry loop could call the model with no limit.
-- A learner starts a new topic job with the button "Build the topic map" or "Update the map". That insert counts.
--
-- F2: a build changes the passages of a lesson before finish_topic_map writes the new map. Until then, an old link
-- can point at a passage with a new text, and a build that never finishes leaves that mix.
-- topic_map_lesson returns a link only while the passage keeps the text of the link (passage_hash).
-- topic_map_state counts a lesson as changed when its analysis is newer than the map. So a map that a build did not
-- finish shows as stale, and the course page offers "Update the map".
--
-- Each function keeps its name, its arguments and its grants. The grants below repeat them for clarity.

-- Start a failed job again. This is the only change that a learner can make to a job.
-- The function runs as its owner, because the learner has no update right on the table.
-- It changes only a failed job of the learner who calls it, and never a build_topic_map job.
create or replace function public.retry_job(job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs as j
  set status = 'waiting',
      attempts = 0,
      error = null,
      step_index = 0,
      step_count = 0,
      step_label = null,
      lease_id = null,
      lease_expires_at = null,
      finished_at = null
  where j.id = retry_job.job_id
    and j.user_id = (select auth.uid())
    and j.status = 'failed'
    and j.type <> 'build_topic_map';

  return found;
end;
$$;

-- Only a signed-in learner can call retry_job.
revoke execute on function public.retry_job(uuid) from public, anon, service_role;
grant execute on function public.retry_job(uuid) to authenticated;

-- Return the state of the map of a course in one row, or no row when the caller cannot see the course:
-- built_at: the time of the last build, or null when the course has no map.
-- loaded_lessons: the lessons with text.
-- analysed_lessons, failed_lessons: the loaded lessons with an analysis of that status.
-- changed_lessons: the loaded lessons with no analysis, with a text that differs from the text of the analysis, or
--   with an analysis that is newer than the map.
-- gone_lessons: the analysed lessons that are no longer loaded lessons of the course.
-- topic_count: the topics of the course that are not merged and not retired.
create or replace function public.topic_map_state(course_id uuid)
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
        and (a.lesson_url is null
          or a.content_hash is distinct from l.content_hash
          or a.analysed_at > m.built_at)
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

-- Return one lesson of the map as one JSON document, or null when the caller cannot see the lesson.
-- The form is the same as in 20261127120000_create_topic_map.sql. A link shows only while its passage keeps the
-- text of the link, so the passage_hash of the link equals the content_hash of the passage.
create or replace function public.topic_map_lesson(course_id uuid, lesson_url text)
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
          and k.passage_hash = p.content_hash
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
              and k.passage_hash = p.content_hash
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
