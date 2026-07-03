-- ============================================================================
-- Automatic Jobsite Time (foundation)
--
-- CEO/Manager-only time tracking that turns assigned-job + jobsite-geofence
-- arrival/departure events into reviewable timecards. This is NOT invasive GPS
-- tracking: we store ONLY discrete arrival/departure event timestamps and a
-- jobsite match status — never continuous location trails, never outside an
-- assigned shift window.
--
-- Tables:
--   jobsite_timecards         one row per employee/job/shift day
--   jobsite_timecard_events   append-only audit of geofence/auto/manager events
-- Company settings columns added to public.companies.
-- ============================================================================

-- 1. Company-level settings (CEO/Admin only in the app) ----------------------
alter table public.companies
  add column if not exists jobsite_time_enabled boolean not null default false,
  add column if not exists jobsite_require_approval boolean not null default true,
  add column if not exists jobsite_geofence_radius_feet integer not null default 500,
  add column if not exists jobsite_ignore_short_departure_minutes integer not null default 10,
  add column if not exists jobsite_break_threshold_minutes integer not null default 30,
  add column if not exists jobsite_auto_clockout_after_end boolean not null default true,
  add column if not exists jobsite_manual_fallback_enabled boolean not null default true;

-- 2. Timecards ---------------------------------------------------------------
create table if not exists public.jobsite_timecards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid,
  user_id uuid,
  job_id uuid,
  assignment_id uuid,
  work_date date,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  geofence_radius_feet integer,
  detected_arrival_at timestamptz,
  detected_departure_at timestamptz,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  break_start_at timestamptz,
  break_end_at timestamptz,
  total_minutes integer not null default 0,
  status text not null default 'active'
    check (status in ('active','pending_review','approved','rejected','needs_review')),
  source text not null default 'jobsite_auto'
    check (source in ('manual','jobsite_auto','manager_adjusted')),
  confidence text not null default 'high'
    check (confidence in ('high','medium','low')),
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobsite_timecards_company_idx on public.jobsite_timecards (company_id);
create index if not exists jobsite_timecards_company_user_idx on public.jobsite_timecards (company_id, user_id);
create index if not exists jobsite_timecards_company_job_idx on public.jobsite_timecards (company_id, job_id);
create index if not exists jobsite_timecards_company_status_idx on public.jobsite_timecards (company_id, status);
create index if not exists jobsite_timecards_company_date_idx on public.jobsite_timecards (company_id, work_date);

-- 3. Event / audit log (append-only) -----------------------------------------
create table if not exists public.jobsite_timecard_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  timecard_id uuid references public.jobsite_timecards(id) on delete cascade,
  event_type text not null
    check (event_type in (
      'entered_geofence','exited_geofence','auto_clock_in','auto_clock_out',
      'break_suggested','manager_edited','approved','rejected'
    )),
  occurred_at timestamptz not null default now(),
  job_id uuid,
  employee_id uuid,
  user_id uuid,
  -- Rounded/coarse only; never a continuous trail. May be null.
  latitude numeric(9,4),
  longitude numeric(9,4),
  accuracy_meters numeric(8,2),
  source text not null default 'jobsite_auto'
    check (source in ('manual','jobsite_auto','manager_adjusted')),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists jobsite_timecard_events_company_idx on public.jobsite_timecard_events (company_id);
create index if not exists jobsite_timecard_events_timecard_idx on public.jobsite_timecard_events (timecard_id, occurred_at);

-- 4. updated_at trigger ------------------------------------------------------
create or replace function public.jobsite_timecards_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists jobsite_timecards_touch on public.jobsite_timecards;
create trigger jobsite_timecards_touch
  before update on public.jobsite_timecards
  for each row execute function public.jobsite_timecards_touch_updated_at();

-- 5. RLS: company isolation (defense-in-depth; the API also enforces role) ----
alter table public.jobsite_timecards enable row level security;
alter table public.jobsite_timecard_events enable row level security;

drop policy if exists jobsite_timecards_company_members on public.jobsite_timecards;
create policy jobsite_timecards_company_members on public.jobsite_timecards
  for all to authenticated
  using (company_id in (select m.company_id from public.memberships m where m.user_id = auth.uid()))
  with check (company_id in (select m.company_id from public.memberships m where m.user_id = auth.uid()));

drop policy if exists jobsite_timecard_events_company_members on public.jobsite_timecard_events;
create policy jobsite_timecard_events_company_members on public.jobsite_timecard_events
  for all to authenticated
  using (company_id in (select m.company_id from public.memberships m where m.user_id = auth.uid()))
  with check (company_id in (select m.company_id from public.memberships m where m.user_id = auth.uid()));
