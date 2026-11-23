-- This test proves each row-level security policy on public.notes.
-- The notes table is the sample resource. Roadmap item S-08 removes this test with the table.
-- The test runs in one transaction and rolls back at the end.

begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

-- Create two users as the superuser.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'other@example.com');

-- The anon role has no access to notes.
set local role anon;

select throws_ok(
  $$ select * from public.notes $$,
  '42501',
  null,
  'anon cannot select notes'
);

select throws_ok(
  $$ insert into public.notes (user_id, title) values ('11111111-1111-1111-1111-111111111111', 'Anon note') $$,
  '42501',
  null,
  'anon cannot insert notes'
);

select throws_ok(
  $$ update public.notes set title = 'Anon edit' $$,
  '42501',
  null,
  'anon cannot update notes'
);

select throws_ok(
  $$ delete from public.notes $$,
  '42501',
  null,
  'anon cannot delete notes'
);

-- The owner can insert, select, and update their own note.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ insert into public.notes (id, title, body)
     values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Owner note', 'Owner body')
     returning user_id, title $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'Owner note'::text) $$,
  'owner can insert a note and the user_id default is the owner'
);

select results_eq(
  $$ select title from public.notes where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('Owner note'::text) $$,
  'owner can select their own note'
);

select results_eq(
  $$ update public.notes set title = 'Owner edit'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     returning title $$,
  $$ values ('Owner edit'::text) $$,
  'owner can update their own note'
);

-- Another user cannot see or change the note of the owner.
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is_empty(
  $$ select id from public.notes $$,
  'another user selects no notes of the owner'
);

select is_empty(
  $$ update public.notes set title = 'Other edit'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     returning id $$,
  'another user updates no note of the owner'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select title from public.notes where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('Owner edit'::text) $$,
  'the note of the owner is intact after the denied update'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is_empty(
  $$ delete from public.notes
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     returning id $$,
  'another user deletes no note of the owner'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select title from public.notes where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('Owner edit'::text) $$,
  'the note of the owner is intact after the denied delete'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select throws_ok(
  $$ insert into public.notes (user_id, title) values ('11111111-1111-1111-1111-111111111111', 'Forged note') $$,
  '42501',
  null,
  'another user cannot insert a note with the user_id of the owner'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ select id from public.notes $$,
  $$ values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid) $$,
  'the owner has only their own note after the denied insert'
);

-- The owner cannot move their note to another user.
select throws_ok(
  $$ update public.notes set user_id = '22222222-2222-2222-2222-222222222222'
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  '42501',
  null,
  'owner cannot move their note to another user_id'
);

select results_eq(
  $$ select user_id from public.notes where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid) $$,
  'the note of the owner keeps its user_id after the denied move'
);

-- The column checks reject bad titles and bodies.
select throws_ok(
  $$ insert into public.notes (title) values ('   ') $$,
  '23514',
  null,
  'an empty title is rejected'
);

select throws_ok(
  $$ insert into public.notes (title) values (E'\t\n') $$,
  '23514',
  null,
  'a title of only tabs and line breaks is rejected'
);

select throws_ok(
  $$ insert into public.notes (title) values (repeat('a', 101)) $$,
  '23514',
  null,
  'a 101-character title is rejected'
);

select throws_ok(
  $$ insert into public.notes (title, body) values ('Long body', repeat('a', 2001)) $$,
  '23514',
  null,
  'a 2001-character body is rejected'
);

-- RLS does not apply to TRUNCATE, so the grant must stop it.
select throws_ok(
  $$ truncate public.notes $$,
  '42501',
  null,
  'authenticated cannot truncate notes'
);

-- The owner can delete their own note.
select results_eq(
  $$ delete from public.notes
     where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     returning title $$,
  $$ values ('Owner edit'::text) $$,
  'owner can delete their own note'
);

select is_empty(
  $$ select id from public.notes $$,
  'the owner has no notes after the delete'
);

select * from finish();

rollback;
