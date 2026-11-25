-- This test proves the access rules and the job rules of public.jobs.
-- A learner can create a job and read their own jobs. Only the worker functions and retry_job change a job.
-- The test runs in one transaction and rolls back at the end.

begin;

create extension if not exists pgtap with schema extensions;

select plan(52);

-- Create four users as the superuser.
insert into auth.users (id, email)
values
  ('11111111-1111-1111-1111-111111111111', 'first@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'second@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'third@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'fourth@example.com');

-- The anon role has no access to jobs.
set local role anon;

select throws_ok(
  $$ select * from public.jobs $$,
  '42501',
  null,
  'anon cannot select jobs'
);

select throws_ok(
  $$ insert into public.jobs (type) values ('demo') $$,
  '42501',
  null,
  'anon cannot insert jobs'
);

-- A learner creates a job and reads it. The defaults set the owner, the state and the attempts.
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select results_eq(
  $$ insert into public.jobs (type, payload)
     values ('demo', '{"steps": 3}')
     returning user_id, status, attempts, lease_id is null $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'waiting'::text, 0, true) $$,
  'a learner can insert a job and the defaults set the owner and the state'
);

select results_eq(
  $$ select type, payload from public.jobs $$,
  $$ values ('demo'::text, '{"steps": 3}'::jsonb) $$,
  'a learner reads their own job'
);

-- Each learner has at most one job in progress.
select throws_ok(
  $$ insert into public.jobs (type) values ('demo') $$,
  '23505',
  null,
  'a learner cannot insert a second job while one is waiting'
);

-- A learner cannot change or remove a job.
select throws_ok(
  $$ update public.jobs set status = 'done' $$,
  '42501',
  null,
  'a learner cannot update a job'
);

select throws_ok(
  $$ delete from public.jobs $$,
  '42501',
  null,
  'a learner cannot delete a job'
);

select throws_ok(
  $$ truncate public.jobs $$,
  '42501',
  null,
  'a learner cannot truncate jobs'
);

-- A different learner does not see the job of the first learner.
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is_empty(
  $$ select id from public.jobs $$,
  'a learner does not read the job of a different learner'
);

-- A learner sets only the type and the payload of a new job.
select throws_ok(
  $$ insert into public.jobs (type, user_id) values ('demo', '11111111-1111-1111-1111-111111111111') $$,
  '42501',
  null,
  'a learner cannot insert a job with an owner of their choice'
);

select throws_ok(
  $$ insert into public.jobs (type, status) values ('demo', 'done') $$,
  '42501',
  null,
  'a learner cannot insert a job with a status of their choice'
);

select throws_ok(
  $$ insert into public.jobs (type) values ('other') $$,
  '23514',
  null,
  'a job type other than demo is rejected'
);

-- A learner cannot call the worker functions.
select throws_ok(
  $$ select * from public.claim_job() $$,
  '42501',
  null,
  'a learner cannot execute claim_job'
);

select throws_ok(
  $$ select public.heartbeat_job(
       '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 1, 5, 'Step one') $$,
  '42501',
  null,
  'a learner cannot execute heartbeat_job'
);

select throws_ok(
  $$ select public.complete_job(
       '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', '{}') $$,
  '42501',
  null,
  'a learner cannot execute complete_job'
);

select throws_ok(
  $$ select public.fail_job(
       '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'Reason') $$,
  '42501',
  null,
  'a learner cannot execute fail_job'
);

select throws_ok(
  $$ select public.fail_job(
       '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'Reason', false) $$,
  '42501',
  null,
  'a learner cannot execute fail_job with the retry argument'
);

select throws_ok(
  $$ select public.release_job(
       '00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000') $$,
  '42501',
  null,
  'a learner cannot execute release_job'
);

-- The rule of one job in progress also holds while the job runs.
reset role;
update public.jobs set status = 'running' where user_id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select throws_ok(
  $$ insert into public.jobs (type) values ('demo') $$,
  '23505',
  null,
  'a learner cannot insert a second job while one is running'
);

-- The worker tests start from fixed jobs. Job 1 is older than job 2.
reset role;
delete from public.jobs;

insert into public.jobs (id, user_id, type, created_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'demo', now() - interval '3 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'demo', now() - interval '2 minutes');

set local role service_role;

-- claim_job takes the oldest free job and gives it a lease.
select results_eq(
  $$ select id, status, attempts, lease_id is not null, lease_expires_at = now() + interval '60 seconds'
     from public.claim_job() $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'running'::text, 1, true, true) $$,
  'claim_job takes the oldest waiting job, adds 1 to attempts and sets a lease'
);

select results_eq(
  $$ select id, attempts from public.claim_job() $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 1) $$,
  'a second claim_job skips the job with a live lease and takes the next job'
);

select is_empty(
  $$ select id from public.claim_job() $$,
  'claim_job takes no job while every lease is live'
);

-- End the lease of job 1 as the superuser.
reset role;
update public.jobs
set lease_expires_at = now() - interval '1 minute'
where id = 'aaaaaaaa-0000-0000-0000-000000000001';

set local role service_role;

select results_eq(
  $$ select id, status, attempts from public.claim_job() $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 'running'::text, 2) $$,
  'claim_job takes a job with a lease that ended and adds 1 to attempts'
);

-- A call with a wrong lease changes nothing.
select is(
  public.heartbeat_job(
    'aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid(), 3, 5, 'Wrong lease', 300),
  false,
  'heartbeat_job returns false for a wrong lease'
);

select is(
  public.complete_job('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid(), '{"steps": 5}'),
  false,
  'complete_job returns false for a wrong lease'
);

select is(
  public.fail_job('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid(), 'Wrong lease'),
  false,
  'fail_job returns false for a wrong lease'
);

select results_eq(
  $$ select status, attempts, step_index, step_label is null, result is null, error is null,
            lease_expires_at = now() + interval '60 seconds'
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values ('running'::text, 2, 0, true, true, true, true) $$,
  'the calls with a wrong lease change nothing'
);

-- heartbeat_job and complete_job work with the lease of the job.
select ok(
  public.heartbeat_job(
    'aaaaaaaa-0000-0000-0000-000000000001',
    (select lease_id from public.jobs where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    2, 5, 'Step two', 120),
  'heartbeat_job returns true for the lease of the job'
);

select results_eq(
  $$ select step_index, step_count, step_label, lease_expires_at = now() + interval '120 seconds'
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values (2, 5, 'Step two'::text, true) $$,
  'heartbeat_job writes the progress and extends the lease'
);

select ok(
  public.complete_job(
    'aaaaaaaa-0000-0000-0000-000000000001',
    (select lease_id from public.jobs where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    '{"steps": 5}'),
  'complete_job returns true for the lease of the job'
);

select results_eq(
  $$ select status, result, finished_at is not null
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  $$ values ('done'::text, '{"steps": 5}'::jsonb, true) $$,
  'complete_job sets done, the result and finished_at'
);

-- fail_job returns job 2 to the queue twice and marks it failed at attempt 3.
-- These calls send no retry argument, so the attempt rule applies.
select ok(
  public.fail_job(
    'aaaaaaaa-0000-0000-0000-000000000002',
    (select lease_id from public.jobs where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    'Boom'),
  'fail_job returns true for the lease of the job at attempt 1'
);

select results_eq(
  $$ select status, attempts, lease_id is null, lease_expires_at is null
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  $$ values ('waiting'::text, 1, true, true) $$,
  'fail_job without the retry argument returns the job to waiting at attempt 1 and clears the lease'
);

select results_eq(
  $$ select id, attempts from public.claim_job() $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 2) $$,
  'claim_job takes the job again for attempt 2'
);

select ok(
  public.fail_job(
    'aaaaaaaa-0000-0000-0000-000000000002',
    (select lease_id from public.jobs where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    'Boom'),
  'fail_job returns true for the lease of the job at attempt 2'
);

select results_eq(
  $$ select status, attempts, lease_id is null
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  $$ values ('waiting'::text, 2, true) $$,
  'fail_job returns the job to waiting at attempt 2'
);

select results_eq(
  $$ select id, attempts from public.claim_job() $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000002'::uuid, 3) $$,
  'claim_job takes the job again for attempt 3'
);

select ok(
  public.fail_job(
    'aaaaaaaa-0000-0000-0000-000000000002',
    (select lease_id from public.jobs where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
    'Boom'),
  'fail_job returns true for the lease of the job at attempt 3'
);

select results_eq(
  $$ select status, attempts, error, finished_at is not null
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  $$ values ('failed'::text, 3, 'Boom'::text, true) $$,
  'fail_job sets failed, the error and finished_at at attempt 3'
);

-- Job 3 stopped during its third attempt and its lease ended. Job 4 waits.
reset role;
insert into public.jobs (id, user_id, type, status, attempts, lease_id, lease_expires_at, created_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'demo', 'running', 3,
   gen_random_uuid(), now() - interval '1 minute', now() - interval '5 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000004', '44444444-4444-4444-4444-444444444444', 'demo', 'waiting', 0,
   null, null, now() - interval '1 minute');

set local role service_role;

select results_eq(
  $$ select id, attempts from public.claim_job() $$,
  $$ values ('aaaaaaaa-0000-0000-0000-000000000004'::uuid, 1) $$,
  'claim_job skips a job with 3 attempts and takes the next job'
);

select results_eq(
  $$ select status, attempts, error, finished_at is not null
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000003' $$,
  $$ values ('failed'::text, 3, 'The work stopped before it ended.'::text, true) $$,
  'claim_job sets failed for a job with 3 attempts and a lease that ended'
);

-- A lease works only while the job runs.
select is(
  public.heartbeat_job(
    'aaaaaaaa-0000-0000-0000-000000000001',
    (select lease_id from public.jobs where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    3, 5, 'After done'),
  false,
  'heartbeat_job returns false for a job that is done'
);

-- release_job returns job 4 to the queue and gives the attempt back.
select ok(
  public.release_job(
    'aaaaaaaa-0000-0000-0000-000000000004',
    (select lease_id from public.jobs where id = 'aaaaaaaa-0000-0000-0000-000000000004')),
  'release_job returns true for the lease of the job'
);

select results_eq(
  $$ select status, attempts, lease_id is null, lease_expires_at is null
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000004' $$,
  $$ values ('waiting'::text, 0, true, true) $$,
  'release_job returns the job to waiting and gives the attempt back'
);

-- Job 5 runs its first attempt. A final failure ends it at once.
reset role;
insert into public.jobs (id, user_id, type, status, attempts, lease_id, lease_expires_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'demo', 'running', 1,
   'bbbbbbbb-0000-0000-0000-000000000005', now() + interval '1 minute');

set local role service_role;

select ok(
  public.fail_job('aaaaaaaa-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000005', 'Blocked', false),
  'fail_job with retry false returns true for the lease of the job'
);

select results_eq(
  $$ select status, attempts, error, finished_at is not null
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000005' $$,
  $$ values ('failed'::text, 1, 'Blocked'::text, true) $$,
  'fail_job with retry false sets failed, the error and finished_at at attempt 1'
);

-- Give job 2 some progress as the superuser, so the retry test can see it cleared.
reset role;
update public.jobs
set step_index = 3, step_count = 5, step_label = 'Step three'
where id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- retry_job works only for the owner of a failed job.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select is(
  public.retry_job('aaaaaaaa-0000-0000-0000-000000000002'),
  false,
  'retry_job does nothing for the failed job of a different learner'
);

select is(
  public.retry_job('aaaaaaaa-0000-0000-0000-000000000001'),
  false,
  'retry_job does nothing for a job that is not failed'
);

set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is(
  public.retry_job('aaaaaaaa-0000-0000-0000-000000000002'),
  true,
  'retry_job returns true for the owner of a failed job'
);

select results_eq(
  $$ select status, attempts, error is null, step_index, step_count, step_label is null,
            lease_id is null, lease_expires_at is null, finished_at is null
     from public.jobs
     where id = 'aaaaaaaa-0000-0000-0000-000000000002' $$,
  $$ values ('waiting'::text, 0, true, 0, 0, true, true, true, true) $$,
  'retry_job returns the job to waiting with no attempts, no error, no progress and no lease'
);

-- The payload size check rejects a payload over 4096 bytes.
reset role;
select throws_ok(
  $$ insert into public.jobs (user_id, type, payload)
     values ('11111111-1111-1111-1111-111111111111', 'demo',
             jsonb_build_object('pad', (select string_agg(md5(i::text), '') from generate_series(1, 200) as i))) $$,
  '23514',
  null,
  'a payload over 4096 bytes is rejected'
);

-- The course page and the load quota read the jobs of a learner by time.
select has_index(
  'public',
  'jobs',
  'jobs_user_created_idx',
  array['user_id', 'created_at'],
  'jobs has an index on the owner and the creation time'
);

select * from finish();

rollback;
