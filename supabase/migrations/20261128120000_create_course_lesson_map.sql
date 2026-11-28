-- The lesson map of a course, for the adjusted lesson list of the course page (S-04).
-- course_lesson_map gives all map data that the rule of the lesson list needs, in one read, and no learner data.
-- The course page applies the rule to this map and to the marks of the learner.
--
-- Rule 6: the learner state is a function of the events. No view and no function joins the map with learner data
-- (context/archive/2026-11-25-course-topic-graph/research.md). So this function reads no learner table, and no
-- function joins the map with the events. The course page reads course_lesson_map and learner_course_events in two
-- calls, and joins them in code.
--
-- The function runs as the caller, so row-level security holds. It returns one jsonb value,
-- so the row limit of the API does not cut the result.

-- Return the lesson map of a course as one JSON document, or null when the caller cannot see the course:
-- analyses: each loaded lesson with an analysis, in course order, as { lesson_url, state }.
--   state is failed for a failed analysis. It is changed when the analysis read a different text of the lesson,
--   or when the analysis is newer than the map. This is the test of topic_map_state. Else it is current.
--   A loaded lesson with no analysis has no item.
-- topics: each live topic of the course with a home lesson, in id order, as { id, name, home_lesson_url }.
--   A live topic is not merged and not retired. A topic keeps its home lesson URL until the next map build, also
--   when a reload removed that lesson. course_topic_list drops such a topic, but this function keeps it. So the
--   lesson that explains it stays in the adjusted list, and the learner sees nothing hidden until the map build.
-- explains: each pair of a lesson and a live topic of the course with an explains link from a passage of that lesson,
--   in the order lesson URL, topic id, as { lesson_url, topic_id }. A mentions link does not count.
--   A link counts only while its passage keeps the text of the link.
-- prerequisites: each pair of live topics of the course with a prerequisite relation that has a source passage in
--   the course, in the order from, to, as { from_topic_id, to_topic_id }.
--   The learner must know the from topic before the to topic.
-- merged: each topic of the course that is merged, in id order, as { id, merged_into }, as in course_topic_list.
create function public.course_lesson_map(course_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with live as (
    -- The live topics of the course, with their home lesson.
    select t.id, t.name, ct.home_lesson_url
    from public.course_topics as ct
    join public.topics as t on t.id = ct.topic_id
    where ct.course_id = course_lesson_map.course_id
      and t.merged_into is null
      and t.retired_at is null
  ),
  explains as (
    -- One pair for each lesson and live topic with an explains link to a passage that keeps the text of the link.
    select distinct p.lesson_url, k.topic_id
    from public.topic_links as k
    join public.passages as p on p.id = k.passage_id
    where p.course_id = course_lesson_map.course_id
      and k.role = 'explains'
      and k.passage_hash = p.content_hash
      and k.topic_id in (select lv.id from live as lv)
  ),
  prerequisites as (
    -- One pair for each prerequisite relation between two live topics, from any source passage of the course.
    select distinct r.from_topic_id, r.to_topic_id
    from public.topic_relations as r
    join public.passages as p on p.id = r.source_passage_id
    where p.course_id = course_lesson_map.course_id
      and r.kind = 'prerequisite'
      and r.from_topic_id in (select lv.id from live as lv)
      and r.to_topic_id in (select lv.id from live as lv)
  )
  select jsonb_build_object(
    'analyses', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'lesson_url', l.url,
          'state', case
            when a.status = 'failed' then 'failed'
            when a.content_hash is distinct from l.content_hash or a.analysed_at > m.built_at then 'changed'
            else 'current'
          end
        )
        order by l.position
      )
      from public.lessons as l
      join public.lesson_analyses as a on a.course_id = l.course_id and a.lesson_url = l.url
      where l.course_id = c.id
        and l.status = 'loaded'
    ), '[]'::jsonb),
    'topics', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', lv.id, 'name', lv.name, 'home_lesson_url', lv.home_lesson_url)
        order by lv.id
      )
      from live as lv
      where lv.home_lesson_url is not null
    ), '[]'::jsonb),
    'explains', coalesce((
      select jsonb_agg(
        jsonb_build_object('lesson_url', e.lesson_url, 'topic_id', e.topic_id)
        order by e.lesson_url, e.topic_id
      )
      from explains as e
    ), '[]'::jsonb),
    'prerequisites', coalesce((
      select jsonb_agg(
        jsonb_build_object('from_topic_id', pr.from_topic_id, 'to_topic_id', pr.to_topic_id)
        order by pr.from_topic_id, pr.to_topic_id
      )
      from prerequisites as pr
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
  left join public.course_maps as m on m.course_id = c.id
  where c.id = course_lesson_map.course_id;
$$;

-- Only a signed-in learner can call the function.
revoke execute on function public.course_lesson_map(uuid) from public, anon, service_role;
grant execute on function public.course_lesson_map(uuid) to authenticated;
