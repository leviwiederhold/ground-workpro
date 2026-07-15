-- ============================================================================
-- Corrective migration for company work-schedule / attendance columns.
--
-- An earlier iteration of 20260706_02 added these columns as
-- `NOT NULL DEFAULT ...`. If that version was already applied in an
-- environment, editing 02 in place will NOT re-run there (same migration
-- version) and `ADD COLUMN IF NOT EXISTS` would skip the columns. This
-- migration reconciles BOTH states so the schema is identical everywhere:
--
--   * Fresh environments: 02 already created the columns as NULLABLE, so the
--     statements below are harmless no-ops.
--   * Environments where the old NOT NULL DEFAULT version ran: this drops the
--     NOT NULL constraint and the column default, so NEW companies are no
--     longer silently backfilled with fabricated work hours and remain
--     detectable as "unconfigured" (NULL).
--
-- It only touches constraints/defaults — no company row data is modified, so
-- existing configured values are preserved.
--
-- NOTE (manual, environment-specific): the old NOT NULL DEFAULT variant, if it
-- ever ran, would have BACKFILLED existing companies with mon–fri / 07:00 /
-- 16:00 at the moment the columns were added. Those rows cannot be
-- auto-distinguished from a company that deliberately chose those values, so
-- this migration intentionally does not null them out. See the PR notes for the
-- optional one-time reset SQL if that backfill happened in your environment.
-- ============================================================================

do $$
declare
  col text;
begin
  foreach col in array array[
    'default_work_days',
    'default_work_start_time',
    'default_work_end_time',
    'attendance_early_arrival_window_minutes',
    'attendance_late_grace_minutes'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'companies'
        and column_name = col
    ) then
      execute format('alter table public.companies alter column %I drop default', col);
      execute format('alter table public.companies alter column %I drop not null', col);
    end if;
  end loop;
end $$;
