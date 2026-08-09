-- Native message push notifications.
--
-- Device tokens and dispatch state are server-only. Authenticated clients can
-- register/revoke their own installation only through the narrowly scoped RPCs
-- below; they cannot list tokens or create arbitrary notification jobs.

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  device_id text not null check (char_length(device_id) between 8 and 200),
  push_token text not null check (char_length(push_token) between 16 and 4096),
  push_environment text not null default 'production'
    check (push_environment in ('sandbox', 'production')),
  enabled boolean not null default true,
  revoked_at timestamptz null,
  revoked_reason text null,
  last_registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_failure_at timestamptz null,
  failure_count integer not null default 0 check (failure_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_devices_platform_device_key unique (platform, device_id)
);

-- A provider token may move between accounts on a shared device. Only its
-- active owner must be unique; revoked history remains available for audit.
create unique index if not exists push_devices_active_platform_token_key
  on public.push_devices(platform, push_token)
  where enabled;

create index if not exists push_devices_company_user_enabled_idx
  on public.push_devices(company_id, user_id, enabled);

create table if not exists public.message_push_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  thread_id uuid not null,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 25),
  run_at timestamptz not null default now(),
  processed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_push_jobs_message_key unique (message_id),
  constraint message_push_jobs_thread_company_fk
    foreign key (thread_id, company_id)
    references public.message_threads(id, company_id)
    on delete cascade
);

create index if not exists message_push_jobs_status_run_at_idx
  on public.message_push_jobs(status, run_at, created_at);

create table if not exists public.message_push_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.message_push_jobs(id) on delete cascade,
  push_device_id uuid null references public.push_devices(id) on delete set null,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  status text not null check (status in ('sent', 'invalid_token', 'failed', 'unsupported')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  provider_status integer null,
  provider_id text null,
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_push_delivery_job_device_key unique (job_id, push_device_id)
);

create index if not exists message_push_delivery_company_created_idx
  on public.message_push_delivery_attempts(company_id, created_at desc);

alter table public.push_devices enable row level security;
alter table public.message_push_jobs enable row level security;
alter table public.message_push_delivery_attempts enable row level security;

-- No table policies: only the service role can inspect tokens, jobs, or
-- delivery diagnostics. Registration returns sanitized metadata, never tokens.
revoke all on public.push_devices from anon, authenticated;
revoke all on public.message_push_jobs from anon, authenticated;
revoke all on public.message_push_delivery_attempts from anon, authenticated;

create or replace function public.register_push_device(
  p_company_id uuid,
  p_platform text,
  p_device_id text,
  p_push_token text,
  p_environment text default 'production'
)
returns table (
  device_row_id uuid,
  registered_platform text,
  registered_device_id text,
  registered_enabled boolean,
  registered_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  now_at timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'Invalid push platform' using errcode = '22023';
  end if;
  if p_environment not in ('sandbox', 'production') then
    raise exception 'Invalid push environment' using errcode = '22023';
  end if;
  if char_length(trim(p_device_id)) not between 8 and 200
     or char_length(trim(p_push_token)) not between 16 and 4096 then
    raise exception 'Invalid push registration' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.company_id = p_company_id and m.user_id = current_user_id
  ) then
    raise exception 'Not a company member' using errcode = '42501';
  end if;

  -- If APNs/FCM rotated a token onto a different installation record, disable
  -- the previous owner before the partial unique index is evaluated.
  update public.push_devices
  set enabled = false,
      revoked_at = now_at,
      revoked_reason = 'token_reassigned',
      updated_at = now_at
  where platform = p_platform
    and push_token = trim(p_push_token)
    and device_id <> trim(p_device_id)
    and enabled;

  return query
  insert into public.push_devices (
    company_id,
    user_id,
    platform,
    device_id,
    push_token,
    push_environment,
    enabled,
    revoked_at,
    revoked_reason,
    last_registered_at,
    last_seen_at,
    failure_count,
    last_failure_at,
    created_at,
    updated_at
  ) values (
    p_company_id,
    current_user_id,
    p_platform,
    trim(p_device_id),
    trim(p_push_token),
    p_environment,
    true,
    null,
    null,
    now_at,
    now_at,
    0,
    null,
    now_at,
    now_at
  )
  on conflict (platform, device_id) do update
  set company_id = excluded.company_id,
      user_id = excluded.user_id,
      push_token = excluded.push_token,
      push_environment = excluded.push_environment,
      enabled = true,
      revoked_at = null,
      revoked_reason = null,
      last_registered_at = now_at,
      last_seen_at = now_at,
      failure_count = 0,
      last_failure_at = null,
      updated_at = now_at
  returning
    push_devices.id,
    push_devices.platform,
    push_devices.device_id,
    push_devices.enabled,
    push_devices.last_registered_at;
end;
$$;

revoke all on function public.register_push_device(uuid, text, text, text, text) from public, anon;
grant execute on function public.register_push_device(uuid, text, text, text, text) to authenticated;

create or replace function public.revoke_push_device(
  p_platform text,
  p_device_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  update public.push_devices
  set enabled = false,
      revoked_at = now(),
      revoked_reason = 'user_revoked',
      updated_at = now()
  where user_id = auth.uid()
    and platform = p_platform
    and device_id = trim(p_device_id)
    and enabled;

  get diagnostics affected = row_count;
  return affected > 0;
end;
$$;

revoke all on function public.revoke_push_device(text, text) from public, anon;
grant execute on function public.revoke_push_device(text, text) to authenticated;

create or replace function public.revoke_push_devices_for_departed_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_devices
  set enabled = false,
      revoked_at = now(),
      revoked_reason = 'membership_removed',
      updated_at = now()
  where company_id = old.company_id
    and user_id = old.user_id
    and enabled;
  return old;
end;
$$;

drop trigger if exists memberships_revoke_push_devices on public.memberships;
create trigger memberships_revoke_push_devices
after delete on public.memberships
for each row execute function public.revoke_push_devices_for_departed_member();

revoke all on function public.revoke_push_devices_for_departed_member() from public, anon, authenticated;

create or replace function public.claim_message_push_jobs(p_limit integer default 20)
returns setof public.message_push_jobs
language sql
security definer
set search_path = public
as $$
  with picked as (
    select job.id
    from public.message_push_jobs job
    where (
        job.status = 'queued' and job.run_at <= now()
      ) or (
        job.status = 'processing' and job.updated_at < now() - interval '5 minutes'
      )
    order by job.run_at asc, job.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), claimed as (
    update public.message_push_jobs job
    set status = 'processing',
        attempts = job.attempts + 1,
        updated_at = now()
    from picked
    where job.id = picked.id
    returning job.*
  )
  select * from claimed;
$$;

revoke all on function public.claim_message_push_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_message_push_jobs(integer) to service_role;
