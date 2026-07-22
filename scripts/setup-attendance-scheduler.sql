-- ============================================================================
-- Attendance scheduler setup (Supabase pg_cron)
--
-- Automatic attendance needs /api/attendance/reconcile to run EVERY MINUTE.
-- Without it nothing clocks anyone in: the native geofence reports the arrival,
-- but the clock-in itself is created by this scheduled pass.
--
-- This project is on Vercel Hobby, which caps cron frequency at once per day —
-- useless for clock-in timing — so the scheduler runs from the database
-- instead. pg_cron is the right home for it: it sits beside the data, fires on
-- time, and does not depend on the hosting plan.
--
-- HOW TO RUN
--   1. Supabase dashboard → SQL Editor, connected to the target project.
--   2. Replace the two placeholders below.
--   3. Execute. Then verify with the queries at the bottom.
--
-- The secret must match ATTENDANCE_SCHEDULER_SECRET in the Vercel project.
-- ============================================================================

-- 1. Extensions ---------------------------------------------------------------
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- 2. Store the endpoint + secret --------------------------------------------
-- Kept in a table rather than inlined into the cron command so the secret is
-- not visible in cron.job.command to anyone who can read the job list.
create table if not exists private_attendance_scheduler_config (
  id boolean primary key default true check (id),
  endpoint text not null,
  secret text not null,
  updated_at timestamptz not null default now()
);

alter table private_attendance_scheduler_config enable row level security;
-- No policies: service-role/superuser only.

insert into private_attendance_scheduler_config (id, endpoint, secret)
values (
  true,
  -- ▼▼ REPLACE: your production origin ▼▼
  'https://REPLACE-ME.vercel.app/api/attendance/reconcile',
  -- ▼▼ REPLACE: must equal ATTENDANCE_SCHEDULER_SECRET in Vercel ▼▼
  'REPLACE-WITH-ATTENDANCE_SCHEDULER_SECRET'
)
on conflict (id) do update
  set endpoint = excluded.endpoint,
      secret = excluded.secret,
      updated_at = now();

-- 3. The dispatcher -----------------------------------------------------------
create or replace function public.run_attendance_reconcile()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  config record;
begin
  select endpoint, secret into config from private_attendance_scheduler_config where id;
  if not found then
    raise warning 'attendance scheduler is not configured; skipping';
    return;
  end if;

  -- Fire-and-forget. pg_net queues the request and returns immediately, so a
  -- slow response can never block the cron worker or delay the next tick.
  perform extensions.net.http_post(
    url := config.endpoint,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-attendance-scheduler-secret', config.secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end $$;

revoke all on function public.run_attendance_reconcile() from public, anon, authenticated;

-- 4. Schedule it every minute -------------------------------------------------
select cron.unschedule('attendance-reconcile')
where exists (select 1 from cron.job where jobname = 'attendance-reconcile');

select cron.schedule(
  'attendance-reconcile',
  '* * * * *',
  $$select public.run_attendance_reconcile()$$
);

-- ============================================================================
-- VERIFY — run these after the setup above.
-- ============================================================================

-- The job exists and is active:
--   select jobid, jobname, schedule, active from cron.job
--   where jobname = 'attendance-reconcile';

-- Recent runs succeeded (check a few minutes after scheduling):
--   select status, return_message, start_time
--   from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'attendance-reconcile')
--   order by start_time desc limit 10;

-- The APP actually received them. This is the one that matters — a green
-- pg_cron run only proves the request was dispatched, not that it landed:
--   select started_at, finished_at, trigger, candidates, clocked_in, clocked_out, error
--   from attendance_scheduler_runs
--   order by started_at desc limit 20;
--
-- Expect roughly one row per minute with trigger = 'scheduler_secret'.
-- Gaps are missed clock-ins.

-- ============================================================================
-- To pause (e.g. during a migration):
--   select cron.unschedule('attendance-reconcile');
-- To rotate the secret: update private_attendance_scheduler_config.secret AND
-- ATTENDANCE_SCHEDULER_SECRET in Vercel. Between those two writes the endpoint
-- returns 401 and no attendance is processed — do it in a quiet window, and
-- re-check attendance_scheduler_runs afterwards.
-- ============================================================================
