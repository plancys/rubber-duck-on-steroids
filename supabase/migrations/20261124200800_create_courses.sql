-- The courses table holds each course that a learner loads. The lessons table holds the lessons of a course in course order.
-- A lesson keeps its text as Markdown, because later features read that text.
-- A learner creates a course, reads their own courses and lessons, and deletes their own course.
-- The learner cannot change a course row or write a lesson. The worker writes through the functions below.
-- reload_course is the only change that a learner can make to a course.

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The web app normalizes the URL: no fragment and no trailing slash. The check stops a URL that is not normalized.
  source_url text not null
    constraint courses_source_url_check check (
      source_url ~ '^https?://'
      and position('#' in source_url) = 0
      and right(source_url, 1) <> '/'
    ),
  title text,
  -- crawl: the worker reads the site. extension: the browser extension saves each page that the learner opens.
  source_kind text not null
    constraint courses_source_kind_check check (source_kind in ('crawl', 'extension')),
  status text not null default 'loading'
    constraint courses_status_check check (status in ('loading', 'ready', 'failed')),
  -- A short reason that is safe to show to the learner.
  error text,
  loaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A learner has one course for each source URL. A second load of the URL reloads that course.
  constraint courses_user_source_url_key unique (user_id, source_url),
  -- The lessons refer to this pair, so a lesson always has the owner of its course.
  constraint courses_id_user_key unique (id, user_id)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null,
  -- The owner of the course. Row-level security reads it.
  user_id uuid not null,
  -- The place of the lesson in the course. The first lesson has position 1.
  position integer not null constraint lessons_position_check check (position >= 1),
  title text,
  url text not null constraint lessons_url_check check (url ~ '^https?://'),
  -- A lesson that failed to load has no Markdown.
  markdown text constraint lessons_markdown_size_check check (octet_length(markdown) <= 1048576),
  status text not null constraint lessons_status_check check (status in ('loaded', 'failed')),
  -- A short reason that is safe to show to the learner.
  error text,
  created_at timestamptz not null default now(),
  constraint lessons_course_fkey foreign key (course_id, user_id)
    references public.courses (id, user_id) on delete cascade,
  constraint lessons_course_position_key unique (course_id, position),
  constraint lessons_course_url_key unique (course_id, url)
);

-- Set updated_at on each update.
create function public.set_courses_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger courses_set_updated_at
before update on public.courses
for each row
execute function public.set_courses_updated_at();

alter table public.courses enable row level security;
alter table public.lessons enable row level security;

create policy "Authenticated users can select their own courses"
on public.courses
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can insert their own courses"
on public.courses
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Authenticated users can delete their own courses"
on public.courses
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can select their own lessons"
on public.lessons
for select
to authenticated
using ((select auth.uid()) = user_id);

-- Anonymous users get no access to courses and lessons.
revoke all on public.courses from anon;
revoke all on public.lessons from anon;

-- Signed-in users can read their courses, create a course, and delete a course.
-- They can set only the source URL and the source kind. Every other column takes its default.
-- They get no update. reload_course is their only way to change a course.
-- They can only read lessons. The worker and the extension functions write the lessons.
revoke all on public.courses from authenticated;
grant select, delete on public.courses to authenticated;
grant insert (source_url, source_kind) on public.courses to authenticated;

revoke all on public.lessons from authenticated;
grant select on public.lessons to authenticated;

-- The jobs table can now hold course loads. The payload of a load_course job is { "courseId": "<uuid>" }.
alter table public.jobs drop constraint jobs_type_check;
alter table public.jobs add constraint jobs_type_check check (type in ('demo', 'load_course'));

-- A learner can insert a job through the Supabase API, so the database checks the course of a load_course job.
-- The course must be a crawl course of the same learner. Else a learner could make the worker write to a course of a different learner.
-- The function runs as the caller. A learner sees only their own courses, so the check holds for each caller.
create function public.check_load_course_payload()
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

  return new;
end;
$$;

create trigger jobs_check_load_course_payload
before insert on public.jobs
for each row
when (new.type = 'load_course')
execute function public.check_load_course_payload();

-- The worker functions follow. The worker calls them with the service key.
-- Row-level security does not apply to service_role, so these functions run as the caller.
-- They change only a crawl course. A course from the extension has no crawl.

-- Mark the course loading and return it, with its source URL.
-- A job that starts again after a failed attempt also calls this, so the course shows loading again.
-- Returns no row when the course does not exist or is not a crawl course.
create function public.start_course_load(course_id uuid)
returns setof public.courses
language plpgsql
set search_path = ''
as $$
begin
  return query
  update public.courses as c
  set status = 'loading',
      error = null
  where c.id = start_course_load.course_id
    and c.source_kind = 'crawl'
  returning c.*;
end;
$$;

-- Store the result of a crawl. All old lessons go, and the new lessons come in, in one transaction.
-- So a learner never sees a mix of old and new lessons.
-- lessons is an array of { position, title, url, markdown, status, error }.
-- Returns false when the course is not a crawl course that is loading.
create function public.finish_course_load(course_id uuid, title text, lessons jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  owner_id uuid;
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

  delete from public.lessons as l
  where l.course_id = finish_course_load.course_id;

  insert into public.lessons (course_id, user_id, position, title, url, markdown, status, error)
  select finish_course_load.course_id, owner_id, x.position, x.title, x.url, x.markdown, x.status, x.error
  from jsonb_to_recordset(finish_course_load.lessons)
    as x(position integer, title text, url text, markdown text, status text, error text);

  return true;
end;
$$;

-- Mark the course failed with a reason that is safe to show. The old lessons stay.
-- Returns false when the course is not a crawl course that is loading.
create function public.fail_course_load(course_id uuid, reason text)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.courses as c
  set status = 'failed',
      error = fail_course_load.reason
  where c.id = fail_course_load.course_id
    and c.source_kind = 'crawl'
    and c.status = 'loading';

  return found;
end;
$$;

-- Only the worker can call the worker functions.
revoke execute on function public.start_course_load(uuid) from public, anon, authenticated;
revoke execute on function public.finish_course_load(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_course_load(uuid, text) from public, anon, authenticated;

grant execute on function public.start_course_load(uuid) to service_role;
grant execute on function public.finish_course_load(uuid, text, jsonb) to service_role;
grant execute on function public.fail_course_load(uuid, text) to service_role;

-- Load a course again. This is the only change that a learner can make to a course.
-- The function runs as its owner, because the learner has no update right on the table.
-- It changes only a crawl course of the learner who calls it, and not while the course loads.
-- After it returns true, the caller creates a new load_course job.
create function public.reload_course(course_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.courses as c
  set status = 'loading',
      error = null
  where c.id = reload_course.course_id
    and c.user_id = (select auth.uid())
    and c.source_kind = 'crawl'
    and c.status <> 'loading';

  return found;
end;
$$;

-- Only a signed-in learner can call reload_course.
revoke execute on function public.reload_course(uuid) from public, anon, service_role;
grant execute on function public.reload_course(uuid) to authenticated;
