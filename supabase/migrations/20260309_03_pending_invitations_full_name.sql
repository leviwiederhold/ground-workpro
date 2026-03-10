alter table if exists public.pending_invitations
  add column if not exists full_name text;

update public.pending_invitations
set full_name = coalesce(nullif(full_name, ''), split_part(email, '@', 1))
where coalesce(full_name, '') = '';
