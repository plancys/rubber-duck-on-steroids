-- The access_tokens table holds the personal access tokens of each learner.
-- The browser extension sends a token, so it can act for one learner without a session and without a service key.
-- The table keeps only the SHA-256 hash of a token. The web app shows the token once, when the learner creates it.
-- A learner creates a token, reads their own tokens, and revokes a token through revoke_access_token.
-- The extension functions below are the only way to use a token.

create table public.access_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null constraint access_tokens_name_check check (char_length(btrim(name)) between 1 and 100),
  -- The SHA-256 hash of the token as 64 lowercase hex characters. The web app computes the same text with Web Crypto.
  token_hash text not null
    constraint access_tokens_token_hash_key unique
    constraint access_tokens_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- A token with a revoked_at time no longer works.
  revoked_at timestamptz
);

-- The limit check counts the live tokens of a learner.
create index access_tokens_user_idx
on public.access_tokens (user_id);

-- A learner has at most 5 live tokens.
-- The lock makes two inserts of the same learner wait for each other, so both cannot pass the count.
-- The function runs as the caller. A learner sees only their own tokens, so the count holds for each caller.
create function public.check_live_access_token_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('access_tokens:' || new.user_id::text, 0));

  if (
    select count(*)
    from public.access_tokens as t
    where t.user_id = new.user_id
      and t.revoked_at is null
  ) >= 5 then
    raise exception 'A learner can have at most 5 live tokens.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger access_tokens_check_live_limit
before insert on public.access_tokens
for each row
when (new.revoked_at is null)
execute function public.check_live_access_token_limit();

alter table public.access_tokens enable row level security;

create policy "Authenticated users can select their own access tokens"
on public.access_tokens
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can insert their own access tokens"
on public.access_tokens
for insert
to authenticated
with check ((select auth.uid()) = user_id);

-- Anonymous users get no access to the table. They use a token only through the extension functions.
revoke all on public.access_tokens from anon;

-- Signed-in users can read their tokens and create a token.
-- They can set only the name and the hash. Every other column takes its default.
-- They get no update and no delete. revoke_access_token is their only way to change a token.
revoke all on public.access_tokens from authenticated;
grant select on public.access_tokens to authenticated;
grant insert (name, token_hash) on public.access_tokens to authenticated;

-- Revoke a token. The function runs as its owner, because the learner has no update right on the table.
-- It changes only a live token of the learner who calls it.
create function public.revoke_access_token(id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.access_tokens as t
  set revoked_at = now()
  where t.id = revoke_access_token.id
    and t.user_id = (select auth.uid())
    and t.revoked_at is null;

  return found;
end;
$$;

-- Only a signed-in learner can call revoke_access_token.
revoke execute on function public.revoke_access_token(uuid) from public, anon, service_role;
grant execute on function public.revoke_access_token(uuid) to authenticated;

-- Find the live token, set its last use, and return its owner.
-- An unknown and a revoked token give the same error, so a caller cannot tell them apart.
-- Only the extension functions call it. No role of the API can call it.
create function public.use_access_token(token text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  update public.access_tokens as t
  set last_used_at = now()
  where t.token_hash = encode(sha256(convert_to(use_access_token.token, 'UTF8')), 'hex')
    and t.revoked_at is null
  returning t.user_id into owner_id;

  if owner_id is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;

  return owner_id;
end;
$$;

revoke execute on function public.use_access_token(text) from public, anon, authenticated, service_role;

-- The extension functions follow. The web app calls them with the anon key and no session.
-- They run as their owner, because the caller has no right on the tables. The token decides the learner.
-- An unknown token, a revoked token, and a course that is not an extension course of the token owner
-- all give the same error: 'invalid token' with SQLSTATE 28000.

-- Start a course for the page that the learner opens, and return the course id.
-- The URL is normalized the same way as in the web app: no fragment and no trailing slash.
-- When the learner already has a course for the URL, the function returns that course.
-- A crawl course for the URL that does not load now becomes an extension course,
-- so a learner can use the extension after a site blocked the crawl.
create function public.extension_start_course(token text, source_url text, title text)
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
create function public.extension_save_page(token text, course_id uuid, url text, title text, markdown text)
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
