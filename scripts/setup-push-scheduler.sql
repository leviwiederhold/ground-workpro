-- ============================================================================
-- Native message push retry scheduler (Supabase pg_cron -> Vercel)
--
-- Next.js after() performs the normal immediate dispatch after the message API
-- has returned. This one-minute scheduler is the durable recovery path for a
-- crashed/expired serverless invocation or a transient APNs failure.
--
-- HOW TO RUN
--   1. Add a strong PUSH_DISPATCH_SECRET to Vercel Production.
--   2. Supabase dashboard -> SQL Editor, connected to Production.
--   3. Replace the endpoint and secret placeholders below, then execute.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists private_push_dispatch_config (
  id boolean primary key default true check (id),
  endpoint text not null,
  secret text not null,
  updated_at timestamptz not null default now()
);

alter table private_push_dispatch_config enable row level security;
revoke all on public.private_push_dispatch_config from anon, authenticated;

insert into private_push_dispatch_config (id, endpoint, secret)
values (
  true,
  'https://ground-workpro.vercel.app/api/push/dispatch',
  'REPLACE-WITH-PUSH_DISPATCH_SECRET'
)
on conflict (id) do update
  set endpoint = excluded.endpoint,
      secret = excluded.secret,
      updated_at = now();

create or replace function public.run_message_push_dispatch()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  config record;
begin
  select endpoint, secret into config
  from private_push_dispatch_config
  where id;

  if not found or config.secret = 'REPLACE-WITH-PUSH_DISPATCH_SECRET' then
    raise warning 'message push dispatcher is not configured; skipping';
    return;
  end if;

  perform net.http_post(
    url := config.endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || config.secret
    ),
    body := '{"limit":50}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.run_message_push_dispatch() from public, anon, authenticated;

select cron.unschedule('message-push-dispatch')
where exists (select 1 from cron.job where jobname = 'message-push-dispatch');

select cron.schedule(
  'message-push-dispatch',
  '* * * * *',
  $$select public.run_message_push_dispatch()$$
);

-- Verify:
--   select jobid, jobname, schedule, active from cron.job
--   where jobname = 'message-push-dispatch';
--
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'message-push-dispatch')
--   order by start_time desc limit 10;
--
--   select status, attempts, last_error, created_at, processed_at
--   from public.message_push_jobs order by created_at desc limit 20;
