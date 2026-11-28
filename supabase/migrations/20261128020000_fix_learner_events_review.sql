-- The fixes of the implementation review of mark-known-topics (context/changes/mark-known-topics/reviews/impl-review.md).
--
-- F1: indexes on the cascade columns of learner_events. A topic delete (courses_delete_topics) and a user delete then
--     find the events with an index, not with a scan of the whole table.
-- F2: a limit of 2000 events for each learner in one hour. Anyone can sign up, and the table only grows.
--     Above the limit, an insert raises the new SQLSTATE RD005, and the marks route answers 429.
--
-- The SQLSTATE codes of this project: RD001 the load quota, RD002 and RD003 the extension, RD004 the topic map quota,
-- RD005 the marks quota.

create index learner_events_topic_idx on public.learner_events (topic_id);

-- The cascade of a user delete and the count of the quota read the events of one learner by time.
create index learner_events_user_created_idx on public.learner_events (user_id, created_at);

-- The quota counts the events of each learner of the new rows in the last hour, the new rows included.
-- It runs once for each insert statement, so "Mark all" for 500 topics counts one time, not 500 times.
-- The function runs as the caller. Row-level security shows a learner only their own events, and those are the rows
-- that it counts. A real session needs few events: a course of 101 topics needs about 100 to 300.
create function public.check_learner_event_quota()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  owner_id uuid;
begin
  for owner_id in select distinct n.user_id from new_events as n loop
    if (
      select count(*)
      from public.learner_events as e
      where e.user_id = owner_id
        and e.created_at > clock_timestamp() - interval '1 hour'
    ) > 2000 then
      raise exception 'A learner can save at most 2000 marks in one hour.' using errcode = 'RD005';
    end if;
  end loop;

  return null;
end;
$$;

revoke execute on function public.check_learner_event_quota() from public, anon, authenticated, service_role;

create trigger learner_events_quota
after insert on public.learner_events
referencing new table as new_events
for each statement
execute function public.check_learner_event_quota();
