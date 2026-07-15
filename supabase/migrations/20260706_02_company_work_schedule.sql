-- ============================================================================
-- Company work schedule + attendance configuration.
--
-- These columns are intentionally NULLABLE with NO defaults: a legacy company
-- that predates this feature must read back as "unconfigured" so the app can
-- prompt the CEO to complete setup instead of silently inventing work hours.
-- Attendance never computes late/early status until timezone + work days +
-- start + end are all set (see src/lib/company/companyConfig.ts).
-- ============================================================================

alter table public.companies
  add column if not exists default_work_days text[],
  add column if not exists default_work_start_time time,
  add column if not exists default_work_end_time time,
  add column if not exists attendance_early_arrival_window_minutes integer,
  add column if not exists attendance_late_grace_minutes integer;

alter table public.jobsite_timecards
  add column if not exists arrival_status text
    check (arrival_status in ('early','on_time','late'));
