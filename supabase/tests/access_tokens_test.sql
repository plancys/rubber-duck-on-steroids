-- This test proves the access rules of public.access_tokens and the extension functions.
-- A learner creates and reads their own tokens, and revokes a token through revoke_access_token.
-- The extension functions take a token, find its owner, and write only to the extension courses of that owner.
-- The test runs in one transaction and rolls back at the end.

begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

-- Create two users as the superuser.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'first@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'second@example.com');

-- Fixed tokens. The first learner has the live tokens 'token-a1' and 'abc', and the revoked token 'token-a2'.
-- The hash of 'abc' is the SHA-256 hex text that Web Crypto gives, so the test proves that both sides match.
-- The second learner has the live token 'token-b1'.
insert into public.access_tokens (id, user_id, name, token_hash, revoked_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Token a1',
   encode(sha256(convert_to('token-a1', 'UTF8')), 'hex'), null),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Token a2',
   encode(sha256(convert_to('token-a2', 'UTF8')), 'hex'), now() - interval '1 day'),
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Token abc',
   'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', null),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Token b1',
   encode(sha256(convert_to('token-b1', 'UTF8')), 'hex'), null);

-- The anon role has no access to the table and to the token functions of the learner.
set local role anon;

select throws_ok(
  $$ select * from public.access_tokens $$,
  '42501',
  null,
  'anon cannot select access tokens'
);

select throws_ok(
  $$ insert into public.access_tokens (name, token_hash) values ('Anon', repeat('a', 64)) $$,
  '42501',
  null,
  'anon cannot insert access tokens'
);

select throws_ok(
  $$ select public.revoke_access_token('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'anon cannot execute revoke_access_token'
);

select throws_ok(
  $$ select public.use_access_token('token-a1') $$,
  '42501',
  null,
  'anon cannot execute use_access_token'
);

-- A learner creates a token. The defaults set the owner, and the token is live.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$ select public.use_access_token('token-a1') $$,
  '42501',
  null,
  'a learner cannot execute use_access_token'
);

select results_eq(
  $$ insert into public.access_tokens (name, token_hash)
     values ('Laptop', encode(sha256(convert_to('token-a3', 'UTF8')), 'hex'))
     returning user_id, revoked_at is null, last_used_at is null $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, true, true) $$,
  'a learner can insert a token and the defaults set the owner'
);

-- A learner sets only the name and the hash of a new token.
select throws_ok(
  $$ insert into public.access_tokens (name, token_hash, user_id)
     values ('Forged', repeat('b', 64), '22222222-2222-2222-2222-222222222222') $$,
  '42501',
  null,
  'a learner cannot insert a token with an owner of their choice'
);

select throws_ok(
  $$ insert into public.access_tokens (name, token_hash, revoked_at)
     values ('Revoked', repeat('b', 64), now()) $$,
  '42501',
  null,
  'a learner cannot insert a token with a revoked_at of their choice'
);

select throws_ok(
  $$ insert into public.access_tokens (name, token_hash) values ('Plain', 'token-a4') $$,
  '23514',
  null,
  'a hash that is not 64 lowercase hex characters is rejected'
);

select throws_ok(
  $$ insert into public.access_tokens (name, token_hash) values ('   ', repeat('b', 64)) $$,
  '23514',
  null,
  'an empty name is rejected'
);

select throws_ok(
  $$ insert into public.access_tokens (name, token_hash)
     values ('Copy', encode(sha256(convert_to('token-b1', 'UTF8')), 'hex')) $$,
  '23505',
  null,
  'a hash that another token has is rejected'
);

-- A learner cannot change or remove a token.
select throws_ok(
  $$ update public.access_tokens set revoked_at = null $$,
  '42501',
  null,
  'a learner cannot update a token'
);

select throws_ok(
  $$ delete from public.access_tokens $$,
  '42501',
  null,
  'a learner cannot delete a token'
);

-- A learner has at most 5 live tokens. The first learner has 3 live tokens now.
select lives_ok(
  $$ insert into public.access_tokens (name, token_hash)
     values ('Fourth', encode(sha256(convert_to('token-a4', 'UTF8')), 'hex')) $$,
  'a learner can insert a fourth live token'
);

select lives_ok(
  $$ insert into public.access_tokens (name, token_hash)
     values ('Fifth', encode(sha256(convert_to('token-a5', 'UTF8')), 'hex')) $$,
  'a learner can insert a fifth live token'
);

select throws_ok(
  $$ insert into public.access_tokens (name, token_hash)
     values ('Sixth', encode(sha256(convert_to('token-a6', 'UTF8')), 'hex')) $$,
  '23514',
  null,
  'a learner cannot insert a sixth live token'
);

select results_eq(
  $$ select count(*) from public.access_tokens $$,
  $$ values (6::bigint) $$,
  'a learner reads only their own tokens, live and revoked'
);

-- revoke_access_token works only for the owner of a live token.
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is_empty(
  $$ select id from public.access_tokens where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'a learner does not read the tokens of a different learner'
);

select is(
  public.revoke_access_token('aaaaaaaa-0000-0000-0000-000000000001'),
  false,
  'revoke_access_token does nothing for the token of a different learner'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  public.revoke_access_token('aaaaaaaa-0000-0000-0000-000000000001'),
  true,
  'revoke_access_token returns true for the owner of a live token'
);

select results_eq(
  $$ select revoked_at = now() from public.access_tokens where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (true) $$,
  'revoke_access_token sets revoked_at'
);

select is(
  public.revoke_access_token('aaaaaaaa-0000-0000-0000-000000000001'),
  false,
  'revoke_access_token does nothing for a token that is revoked'
);

select lives_ok(
  $$ insert into public.access_tokens (name, token_hash)
     values ('After revoke', encode(sha256(convert_to('token-a6', 'UTF8')), 'hex')) $$,
  'a revoked token does not count toward the limit of 5 live tokens'
);

-- Fixed courses of the first learner: a ready crawl course, a failed crawl course and a loading crawl course.
reset role;
insert into public.courses (id, user_id, source_url, title, source_kind, status, error)
values
  ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'https://example.com/course', 'Crawl course', 'crawl', 'ready', null),
  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'https://blocked.example.com/course', null, 'crawl', 'failed', 'This site does not allow automated reads.'),
  ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'https://loading.example.com/course', null, 'crawl', 'loading', null);

-- The extension functions, called with the anon key.
set local role anon;

select isnt(
  public.extension_start_course('abc', 'https://learn.example.com/course/#intro', 'Course'),
  null,
  'a token that the web app hashes with Web Crypto starts a course'
);

reset role;

select results_eq(
  $$ select user_id, source_url, title, source_kind, status
     from public.courses
     where source_url like 'https://learn.example.com/%' $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'https://learn.example.com/course'::text,
             'Course'::text, 'extension'::text, 'ready'::text) $$,
  'extension_start_course creates a ready extension course of the token owner with a normalized URL'
);

select results_eq(
  $$ select last_used_at = now() from public.access_tokens where id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  $$ values (true) $$,
  'extension_start_course sets the last use of the token'
);

-- Keep the course id for the next calls, which anon makes.
do $$
begin
  perform set_config(
    'test.course_id',
    (select id::text from public.courses where source_url = 'https://learn.example.com/course'),
    true
  );
end;
$$;

set local role anon;

select is(
  public.extension_start_course('token-a3', 'https://learn.example.com/course', 'Other title'),
  current_setting('test.course_id')::uuid,
  'extension_start_course returns the existing course of the learner for the same URL'
);

select throws_ok(
  $$ select public.extension_start_course('unknown-token', 'https://learn.example.com/course', 'Course') $$,
  '28000',
  'invalid token',
  'extension_start_course refuses an unknown token'
);

select throws_ok(
  $$ select public.extension_start_course('token-a2', 'https://learn.example.com/course', 'Course') $$,
  '28000',
  'invalid token',
  'extension_start_course refuses a revoked token'
);

select throws_ok(
  $$ select public.extension_start_course(null, 'https://learn.example.com/course', 'Course') $$,
  '28000',
  'invalid token',
  'extension_start_course refuses a missing token'
);

-- The pages go to the next position, in the order of the saves.
select is(
  public.extension_save_page('abc', current_setting('test.course_id')::uuid,
    'https://learn.example.com/course/one', 'One', '# One'),
  1,
  'extension_save_page puts the first page at position 1'
);

select is(
  public.extension_save_page('abc', current_setting('test.course_id')::uuid,
    'https://learn.example.com/course/two', 'Two', '# Two'),
  2,
  'extension_save_page puts the second page at position 2'
);

select is(
  public.extension_save_page('abc', current_setting('test.course_id')::uuid,
    'https://learn.example.com/course/one', 'One again', '# One again'),
  1,
  'extension_save_page replaces a page with the same URL in place'
);

reset role;

select results_eq(
  $$ select position, url, title, markdown, status, user_id
     from public.lessons
     where course_id = current_setting('test.course_id')::uuid
     order by position $$,
  $$ values
       (1, 'https://learn.example.com/course/one'::text, 'One again'::text, '# One again'::text, 'loaded'::text,
        '11111111-1111-1111-1111-111111111111'::uuid),
       (2, 'https://learn.example.com/course/two'::text, 'Two'::text, '# Two'::text, 'loaded'::text,
        '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'the course holds the saved pages in order, with the replaced page in place'
);

set local role anon;

-- An unknown, a revoked and a foreign token give the same error.
select throws_ok(
  $$ select public.extension_save_page('unknown-token', current_setting('test.course_id')::uuid,
       'https://learn.example.com/course/three', 'Three', '# Three') $$,
  '28000',
  'invalid token',
  'extension_save_page refuses an unknown token'
);

select throws_ok(
  $$ select public.extension_save_page('token-a2', current_setting('test.course_id')::uuid,
       'https://learn.example.com/course/three', 'Three', '# Three') $$,
  '28000',
  'invalid token',
  'extension_save_page refuses a revoked token'
);

select throws_ok(
  $$ select public.extension_save_page('token-b1', current_setting('test.course_id')::uuid,
       'https://learn.example.com/course/three', 'Three', '# Three') $$,
  '28000',
  'invalid token',
  'extension_save_page refuses the token of a different learner'
);

select throws_ok(
  $$ select public.extension_save_page('abc', 'cccccccc-0000-0000-0000-000000000001',
       'https://example.com/course/three', 'Three', '# Three') $$,
  '28000',
  'invalid token',
  'extension_save_page refuses a crawl course'
);

select throws_ok(
  $$ select public.extension_save_page('abc', current_setting('test.course_id')::uuid,
       'https://learn.example.com/course/big', 'Big', repeat('a', 1048577)) $$,
  '23514',
  null,
  'extension_save_page rejects a page with more than 1 MB of Markdown'
);

select throws_ok(
  $$ select public.extension_save_page('abc', current_setting('test.course_id')::uuid,
       'javascript:alert(1)', 'Script', '# Script') $$,
  '23514',
  null,
  'extension_save_page rejects a page URL that is not http or https'
);

-- A crawl course that a site blocked becomes an extension course. A crawl course that loads stays as it is.
select is(
  public.extension_start_course('abc', 'https://blocked.example.com/course/', 'Blocked course'),
  'cccccccc-0000-0000-0000-000000000002'::uuid,
  'extension_start_course returns the failed crawl course of the learner for the same URL'
);

reset role;

select results_eq(
  $$ select source_kind, status, error is null, title
     from public.courses
     where id = 'cccccccc-0000-0000-0000-000000000002' $$,
  $$ values ('extension'::text, 'ready'::text, true, 'Blocked course'::text) $$,
  'extension_start_course makes a failed crawl course a ready extension course'
);

set local role anon;

select throws_ok(
  $$ select public.extension_start_course('abc', 'https://loading.example.com/course', 'Loading course') $$,
  '55006',
  null,
  'extension_start_course refuses a crawl course that loads'
);

-- Only the web app roles call the extension functions.
reset role;
set local role service_role;

select throws_ok(
  $$ select public.extension_start_course('abc', 'https://learn.example.com/course', 'Course') $$,
  '42501',
  null,
  'service_role cannot execute extension_start_course'
);

select throws_ok(
  $$ select public.extension_save_page('abc', 'cccccccc-0000-0000-0000-000000000001',
       'https://example.com/course/one', 'One', '# One') $$,
  '42501',
  null,
  'service_role cannot execute extension_save_page'
);

select * from finish();

rollback;
