-- The notes table is the sample resource of the starter.
-- Roadmap item S-08 removes this table and every file that uses it.
-- Each user can read and change only their own notes. Row-level security enforces this rule.

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- btrim with these characters matches the JavaScript trim() in the app. Plain trim() removes only spaces.
  title text not null check (char_length(btrim(title, E' \t\n\r')) between 1 and 100),
  body text not null default '' check (char_length(body) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The policies and the list query filter by user_id.
create index notes_user_id_idx on public.notes (user_id);

-- Set updated_at on each update.
create function public.set_notes_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger notes_set_updated_at
before update on public.notes
for each row
execute function public.set_notes_updated_at();

alter table public.notes enable row level security;

create policy "Authenticated users can select their own notes"
on public.notes
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can insert their own notes"
on public.notes
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Authenticated users can update their own notes"
on public.notes
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Authenticated users can delete their own notes"
on public.notes
for delete
to authenticated
using ((select auth.uid()) = user_id);

-- Anonymous users get no access to notes.
revoke all on public.notes from anon;

-- Signed-in users get only the 4 CRUD privileges. RLS does not apply to TRUNCATE.
revoke truncate, references, trigger on public.notes from authenticated;
grant select, insert, update, delete on public.notes to authenticated;
