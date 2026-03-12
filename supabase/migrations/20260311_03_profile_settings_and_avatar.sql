alter table if exists public.profiles
  add column if not exists phone text,
  add column if not exists job_title text,
  add column if not exists timezone text,
  add column if not exists avatar_url text,
  add column if not exists notification_preferences jsonb not null default '{}'::jsonb,
  add column if not exists appearance_preference text;

alter table if exists public.profiles
  drop constraint if exists profiles_appearance_preference_check;

alter table if exists public.profiles
  add constraint profiles_appearance_preference_check
  check (
    appearance_preference is null
    or appearance_preference in ('system', 'light', 'dark')
  );
