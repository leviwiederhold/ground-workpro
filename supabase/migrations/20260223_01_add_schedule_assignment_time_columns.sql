alter table if exists public.schedule_assignments
  add column if not exists starts_at timestamptz null,
  add column if not exists ends_at timestamptz null;
