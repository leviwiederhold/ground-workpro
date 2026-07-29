-- Optional company break/lunch schedule used for admin attendance awareness.
-- These settings do not pause monitoring or alter clock events.

alter table public.companies
  add column if not exists attendance_break_start_time time without time zone,
  add column if not exists attendance_break_end_time time without time zone,
  add column if not exists attendance_break_return_grace_minutes integer not null default 0;

do $$ begin
  alter table public.companies
    add constraint companies_attendance_break_pair_check
    check (
      (attendance_break_start_time is null and attendance_break_end_time is null)
      or (
        attendance_break_start_time is not null
        and attendance_break_end_time is not null
        and attendance_break_start_time < attendance_break_end_time
      )
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.companies
    add constraint companies_attendance_break_grace_check
    check (attendance_break_return_grace_minutes between 0 and 240);
exception when duplicate_object then null; end $$;
