-- The jobs table holds the background work of each learner. It is the single source of truth for a job.
-- A learner creates a job and reads their own jobs. A worker outside the web app does the work.
-- The learner cannot change a job row. The worker changes a job only through the functions below.
-- The functions hold the lease rule and the attempt rule, so every worker follows the same rules.

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Each job type has a handler in the worker. A later migration adds a type to this check.
  type text not null constraint jobs_type_check check (type in ('demo')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'waiting'
    constraint jobs_status_check check (status in ('waiting', 'running', 'done', 'failed')),
  step_index integer not null default 0,
  step_count integer not null default 0,
  step_label text,
  -- The number of starts of the job. The fourth start marks the job failed.
  attempts integer not null default 0,
  -- A short reason that is safe to show to the learner. The raw error goes only to the worker log.
  error text,
  result jsonb,
  -- The worker that holds the lease owns the job until the lease ends.
  lease_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Each learner has at most one job in progress.
create unique index jobs_one_in_progress_per_user_idx
on public.jobs (user_id)
where status in ('waiting', 'running');

-- claim_job takes the oldest job in progress first.
create index jobs_queue_idx
on public.jobs (created_at)
where status in ('waiting', 'running');

-- Set updated_at on each update.
create function public.set_jobs_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger jobs_set_updated_at
before update on public.jobs
for each row
execute function public.set_jobs_updated_at();

alter table public.jobs enable row level security;

create policy "Authenticated users can select their own jobs"
on public.jobs
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Authenticated users can insert their own jobs"
on public.jobs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

-- Anonymous users get no access to jobs.
revoke all on public.jobs from anon;

-- Signed-in users can read their jobs and create a job.
-- They can set only the type and the payload. Every other column takes its default.
-- They get no update and no delete. retry_job is their only way to change a job.
revoke all on public.jobs from authenticated;
grant select on public.jobs to authenticated;
grant insert (type, payload) on public.jobs to authenticated;

-- The worker functions follow. The worker calls them with the service key.
-- Row-level security does not apply to service_role, so these functions run as the caller.
-- A function that takes a lease changes the job only while the job runs with this lease.

-- Take the oldest job that waits, or that runs with a lease that ended.
-- A job that already has 3 attempts gets the status failed, and the function looks at the next job.
-- Returns the job with its new lease, or no row when no job is free.
create function public.claim_job(lease_seconds integer default 60)
returns setof public.jobs
language plpgsql
set search_path = ''
as $$
declare
  job public.jobs;
begin
  loop
    select *
    into job
    from public.jobs as j
    where j.status = 'waiting'
       or (j.status = 'running' and j.lease_expires_at <= now())
    order by j.created_at, j.id
    limit 1
    for update skip locked;

    if not found then
      return;
    end if;

    if job.attempts >= 3 then
      update public.jobs as j
      set status = 'failed',
          error = 'The work stopped before it ended.',
          finished_at = now()
      where j.id = job.id;
    else
      update public.jobs as j
      set status = 'running',
          attempts = j.attempts + 1,
          lease_id = gen_random_uuid(),
          lease_expires_at = now() + make_interval(secs => claim_job.lease_seconds)
      where j.id = job.id
      returning * into job;

      return next job;
      return;
    end if;
  end loop;
end;
$$;

-- Write the progress of the job and extend its lease.
-- Returns false when the job does not run with this lease. The worker then stops the job.
create function public.heartbeat_job(
  job_id uuid,
  lease uuid,
  step_index integer,
  step_count integer,
  step_label text,
  lease_seconds integer default 60
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.jobs as j
  set step_index = heartbeat_job.step_index,
      step_count = heartbeat_job.step_count,
      step_label = heartbeat_job.step_label,
      lease_expires_at = now() + make_interval(secs => heartbeat_job.lease_seconds)
  where j.id = heartbeat_job.job_id
    and j.lease_id = heartbeat_job.lease
    and j.status = 'running';

  return found;
end;
$$;

-- Mark the job done and store its result.
create function public.complete_job(job_id uuid, lease uuid, result jsonb)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.jobs as j
  set status = 'done',
      result = complete_job.result,
      finished_at = now()
  where j.id = complete_job.job_id
    and j.lease_id = complete_job.lease
    and j.status = 'running';

  return found;
end;
$$;

-- End a failed start of the job.
-- With fewer than 3 attempts the job waits for its next start. With 3 attempts the job fails for good.
create function public.fail_job(job_id uuid, lease uuid, reason text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  job_attempts integer;
begin
  select j.attempts
  into job_attempts
  from public.jobs as j
  where j.id = fail_job.job_id
    and j.lease_id = fail_job.lease
    and j.status = 'running'
  for update;

  if not found then
    return false;
  end if;

  if job_attempts < 3 then
    update public.jobs as j
    set status = 'waiting',
        lease_id = null,
        lease_expires_at = null
    where j.id = fail_job.job_id;
  else
    update public.jobs as j
    set status = 'failed',
        error = fail_job.reason,
        finished_at = now()
    where j.id = fail_job.job_id;
  end if;

  return true;
end;
$$;

-- Return the job to the queue and give back its attempt.
-- The worker calls this when it stops before the job ends, so a stop does not count as a start.
create function public.release_job(job_id uuid, lease uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update public.jobs as j
  set status = 'waiting',
      attempts = j.attempts - 1,
      lease_id = null,
      lease_expires_at = null
  where j.id = release_job.job_id
    and j.lease_id = release_job.lease
    and j.status = 'running';

  return found;
end;
$$;

-- Only the worker can call the worker functions.
revoke execute on function public.claim_job(integer) from public, anon, authenticated;
revoke execute on function public.heartbeat_job(uuid, uuid, integer, integer, text, integer) from public, anon, authenticated;
revoke execute on function public.complete_job(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_job(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.release_job(uuid, uuid) from public, anon, authenticated;

grant execute on function public.claim_job(integer) to service_role;
grant execute on function public.heartbeat_job(uuid, uuid, integer, integer, text, integer) to service_role;
grant execute on function public.complete_job(uuid, uuid, jsonb) to service_role;
grant execute on function public.fail_job(uuid, uuid, text) to service_role;
grant execute on function public.release_job(uuid, uuid) to service_role;

-- Start a failed job again. This is the only change that a learner can make to a job.
-- The function runs as its owner, because the learner has no update right on the table.
-- It changes only a failed job of the learner who calls it.
create function public.retry_job(job_id uuid)
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
    and j.status = 'failed';

  return found;
end;
$$;

-- Only a signed-in learner can call retry_job.
revoke execute on function public.retry_job(uuid) from public, anon, service_role;
grant execute on function public.retry_job(uuid) to authenticated;
