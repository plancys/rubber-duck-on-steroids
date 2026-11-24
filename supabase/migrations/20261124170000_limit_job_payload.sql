-- A job payload holds a few settings, not content. The limit stops a very large payload,
-- because a signed-in user can insert a job through the Supabase API and the worker reads the payload whole.
-- pg_column_size measures the value before compression, so the limit counts the real size.

alter table public.jobs
add constraint jobs_payload_size_check check (pg_column_size(payload) <= 4096);
