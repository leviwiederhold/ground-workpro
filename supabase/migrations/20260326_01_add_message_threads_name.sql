alter table if exists public.message_threads
  add column if not exists name text;
