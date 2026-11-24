-- A failure that will not change ends the job at once.
-- A site that blocks the bot, or a page that does not exist, gives the same answer at each start.
-- A new start only sends one more request to the site, so the worker can mark such a failure final.
-- fail_job gets the retry argument. With retry false the job fails at any attempt.
-- With retry true, the default, the attempt rule of the jobs migration stays the same.

drop function public.fail_job(uuid, uuid, text);

-- End a failed start of the job.
-- With retry false the job fails for good at once.
-- With retry true and fewer than 3 attempts the job waits for its next start. With 3 attempts the job fails for good.
create function public.fail_job(job_id uuid, lease uuid, reason text, retry boolean default true)
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

  if fail_job.retry and job_attempts < 3 then
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

-- Only the worker can call fail_job.
revoke execute on function public.fail_job(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_job(uuid, uuid, text, boolean) to service_role;
