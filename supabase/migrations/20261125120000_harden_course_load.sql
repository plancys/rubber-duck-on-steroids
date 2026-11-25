-- Harden the course load. The review of the change load-course-from-url found these gaps:
-- 1. A reload replaces good lessons with failed rows when a page does not answer during the reload.
-- 2. The extension functions do not hold the length limits of the routes, and a course has no lesson limit.
-- 3. A learner can start an unlimited number of course loads.
-- 4. The extension can turn a crawl course that loaded well into an extension course.
-- 5. A reload sets the course loading in one call and inserts the job in a second call.
--    A failed insert then leaves the course loading with no job.
-- 6. The course page and the load quota read the jobs of a learner by time, and no index covers that read.
--
-- The functions raise these SQLSTATE codes. The web app maps each code to an error key.
--   RD001: the learner started 10 course loads in the last hour.
--   RD002: a crawl course that is ready has the same URL. The extension does not convert it.
--   RD003: the course has 500 lessons. extension_save_page adds no more lessons.

-- The jobs of a learner by time: the newest load job of the course page, and the load quota.
create index jobs_user_created_idx
on public.jobs (user_id, created_at desc);

-- A load_course job holds the id of a crawl course of the same learner.
-- A learner starts at most 10 load_course jobs in one hour. Each job reads up to 201 pages of a site.
-- The function runs as the caller. A learner sees only their own courses and jobs, so the checks hold for each caller.
create or replace function public.check_load_course_payload()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  course_id text;
begin
  if jsonb_typeof(new.payload -> 'courseId') is distinct from 'string' then
    raise exception 'A load_course job needs a courseId.' using errcode = 'check_violation';
  end if;

  course_id := new.payload ->> 'courseId';

  if course_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'A load_course job needs a courseId.' using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.courses as c
    where c.id = course_id::uuid
      and c.user_id = new.user_id
      and c.source_kind = 'crawl'
  ) then
    raise exception 'A load_course job needs a crawl course of the same learner.' using errcode = 'check_violation';
  end if;

  if (
    select count(*)
    from public.jobs as j
    where j.user_id = new.user_id
      and j.type = 'load_course'
      and j.created_at > now() - interval '1 hour'
  ) >= 10 then
    raise exception 'A learner can start at most 10 course loads in one hour.' using errcode = 'RD001';
  end if;

  return new;
end;
$$;

-- Store the result of a crawl. The old lessons go, and the new lessons come in, in one transaction.
-- So a learner never sees a mix of old and new lessons.
-- A lesson that fails in this crawl but loaded before keeps its old text and its old title, and stays loaded.
-- So a short outage of the site during a reload does not lose text that the product had.
-- The lesson order always comes from the new crawl.
-- lessons is an array of { position, title, url, markdown, status, error }.
-- Returns false when the course is not a crawl course that is loading.
create or replace function public.finish_course_load(course_id uuid, title text, lessons jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  owner_id uuid;
  kept_ids uuid[];
begin
  update public.courses as c
  set status = 'ready',
      title = finish_course_load.title,
      error = null,
      loaded_at = now()
  where c.id = finish_course_load.course_id
    and c.source_kind = 'crawl'
    and c.status = 'loading'
  returning c.user_id into owner_id;

  if not found then
    return false;
  end if;

  -- The old lessons that loaded, for each URL that failed in this crawl.
  select coalesce(array_agg(l.id), '{}')
  into kept_ids
  from public.lessons as l
  join jsonb_to_recordset(finish_course_load.lessons) as x(url text, status text)
    on x.url = l.url
  where l.course_id = finish_course_load.course_id
    and l.status = 'loaded'
    and x.status = 'failed';

  delete from public.lessons as l
  where l.course_id = finish_course_load.course_id
    and l.id <> all(kept_ids);

  -- Move the kept lessons away from the new positions, so the insert below has each position free.
  update public.lessons as l
  set position = l.position + 1000000
  where l.id = any(kept_ids);

  insert into public.lessons (course_id, user_id, position, title, url, markdown, status, error)
  select finish_course_load.course_id, owner_id, x.position, x.title, x.url, x.markdown, x.status, x.error
  from jsonb_to_recordset(finish_course_load.lessons)
    as x(position integer, title text, url text, markdown text, status text, error text)
  where not exists (
    select 1
    from public.lessons as k
    where k.id = any(kept_ids)
      and k.url = x.url
  );

  update public.lessons as l
  set position = x.position,
      title = coalesce(l.title, x.title),
      status = 'loaded',
      error = null
  from jsonb_to_recordset(finish_course_load.lessons) as x(position integer, title text, url text)
  where l.id = any(kept_ids)
    and l.url = x.url;

  return true;
end;
$$;

-- Only the worker can call finish_course_load.
revoke execute on function public.finish_course_load(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_course_load(uuid, text, jsonb) to service_role;

-- Start a course for the page that the learner opens, and return the course id.
-- The URL is normalized the same way as in the web app: no fragment and no trailing slash.
-- The function holds the limits of the route: a URL of at most 2048 characters and a title of at most 300 characters.
-- When the learner already has a course for the URL, the function returns that course.
-- Only a crawl course that failed becomes an extension course, so a learner can use the extension after a site
-- blocked the crawl. A crawl course that loads gives the error 55006. A crawl course that is ready gives RD002,
-- because the learner reloads it in the product.
create or replace function public.extension_start_course(token text, source_url text, title text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  normalized_url text;
  found_id uuid;
  found_kind text;
  found_status text;
begin
  owner_id := public.use_access_token(extension_start_course.token);

  if char_length(extension_start_course.source_url) > 2048 or char_length(extension_start_course.title) > 300 then
    raise exception 'The URL or the title is too long.' using errcode = 'check_violation';
  end if;

  normalized_url := regexp_replace(split_part(extension_start_course.source_url, '#', 1), '/+$', '');

  insert into public.courses as c (user_id, source_url, title, source_kind, status)
  values (owner_id, normalized_url, extension_start_course.title, 'extension', 'ready')
  on conflict on constraint courses_user_source_url_key do nothing
  returning c.id into found_id;

  if found_id is not null then
    return found_id;
  end if;

  select c.id, c.source_kind, c.status
  into found_id, found_kind, found_status
  from public.courses as c
  where c.user_id = owner_id
    and c.source_url = normalized_url
  for update;

  if found_kind = 'crawl' then
    if found_status = 'loading' then
      raise exception 'The course loads now.' using errcode = '55006';
    end if;

    if found_status <> 'failed' then
      raise exception 'The course loads from its URL.' using errcode = 'RD002';
    end if;

    update public.courses as c
    set source_kind = 'extension',
        status = 'ready',
        error = null,
        title = coalesce(c.title, extension_start_course.title)
    where c.id = found_id;
  end if;

  return found_id;
end;
$$;

-- Save one page of an extension course and return its position.
-- A new URL goes to the next position. A URL that the course has already replaces that lesson in place.
-- The function holds the limits of the route: a URL of at most 2048 characters and a title of at most 300 characters.
-- A course holds at most 500 lessons. A new URL after that gives RD003. A URL that the course has still saves.
create or replace function public.extension_save_page(token text, course_id uuid, url text, title text, markdown text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  lesson_position integer;
begin
  owner_id := public.use_access_token(extension_save_page.token);

  if char_length(extension_save_page.url) > 2048 or char_length(extension_save_page.title) > 300 then
    raise exception 'The URL or the title is too long.' using errcode = 'check_violation';
  end if;

  -- The lock on the course row makes two saves of the same course take their positions one after the other.
  perform 1
  from public.courses as c
  where c.id = extension_save_page.course_id
    and c.user_id = owner_id
    and c.source_kind = 'extension'
  for update;

  if not found then
    raise exception 'invalid token' using errcode = '28000';
  end if;

  update public.lessons as l
  set title = extension_save_page.title,
      markdown = extension_save_page.markdown,
      status = 'loaded',
      error = null
  where l.course_id = extension_save_page.course_id
    and l.url = extension_save_page.url
  returning l.position into lesson_position;

  if found then
    return lesson_position;
  end if;

  if (
    select count(*)
    from public.lessons as l
    where l.course_id = extension_save_page.course_id
  ) >= 500 then
    raise exception 'A course holds at most 500 lessons.' using errcode = 'RD003';
  end if;

  select coalesce(max(l.position), 0) + 1
  into lesson_position
  from public.lessons as l
  where l.course_id = extension_save_page.course_id;

  insert into public.lessons (course_id, user_id, position, title, url, markdown, status)
  values (
    extension_save_page.course_id,
    owner_id,
    lesson_position,
    extension_save_page.title,
    extension_save_page.url,
    extension_save_page.markdown,
    'loaded'
  );

  return lesson_position;
end;
$$;

-- The web app calls the extension functions with the anon key. A signed-in client can call them too.
revoke execute on function public.extension_start_course(text, text, text) from public, service_role;
revoke execute on function public.extension_save_page(text, uuid, text, text, text) from public, service_role;

grant execute on function public.extension_start_course(text, text, text) to anon, authenticated;
grant execute on function public.extension_save_page(text, uuid, text, text, text) to anon, authenticated;

-- Load a course again. This is the only change that a learner can make to a course.
-- The function sets the course loading and inserts its load_course job in one transaction, and returns the job id.
-- When the insert fails, for example because the learner has a job in progress (23505) or too many loads (RD001),
-- the error rolls back the whole call, so the course keeps its old state.
-- It changes only a crawl course of the learner who calls it, and not while the course loads.
-- Then it returns null.
-- The function runs as its owner, because the learner has no update right on the courses table.
-- The insert gives the learner as the job owner, so the job rules of the trigger above hold.
drop function public.reload_course(uuid);

create function public.reload_course(course_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_job_id uuid;
begin
  update public.courses as c
  set status = 'loading',
      error = null
  where c.id = reload_course.course_id
    and c.user_id = (select auth.uid())
    and c.source_kind = 'crawl'
    and c.status <> 'loading';

  if not found then
    return null;
  end if;

  insert into public.jobs (user_id, type, payload)
  values ((select auth.uid()), 'load_course', jsonb_build_object('courseId', reload_course.course_id))
  returning id into new_job_id;

  return new_job_id;
end;
$$;

-- Only a signed-in learner can call reload_course.
revoke execute on function public.reload_course(uuid) from public, anon, service_role;
grant execute on function public.reload_course(uuid) to authenticated;
