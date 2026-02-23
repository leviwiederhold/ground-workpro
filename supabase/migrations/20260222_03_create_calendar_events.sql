create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  description text,
  location_text text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  event_type text not null,
  visibility text not null default 'attendees',
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists public.calendar_event_attendees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  attendee_type text not null,
  user_id uuid,
  employee_id uuid references public.employees(id) on delete set null,
  external_name text,
  external_contact text,
  response_status text not null default 'invited',
  created_at timestamptz not null default now()
);

create index if not exists calendar_events_company_starts_idx
  on public.calendar_events (company_id, starts_at);

create index if not exists calendar_event_attendees_company_event_idx
  on public.calendar_event_attendees (company_id, event_id);

create index if not exists calendar_event_attendees_company_user_idx
  on public.calendar_event_attendees (company_id, user_id);

create index if not exists calendar_event_attendees_company_employee_idx
  on public.calendar_event_attendees (company_id, employee_id);

alter table public.calendar_events enable row level security;
alter table public.calendar_event_attendees enable row level security;

drop policy if exists calendar_events_select on public.calendar_events;
create policy calendar_events_select
  on public.calendar_events
  for select
  using (public.is_company_member(company_id));

drop policy if exists calendar_events_insert on public.calendar_events;
create policy calendar_events_insert
  on public.calendar_events
  for insert
  with check (public.is_company_member(company_id));

drop policy if exists calendar_events_update on public.calendar_events;
create policy calendar_events_update
  on public.calendar_events
  for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists calendar_events_delete on public.calendar_events;
create policy calendar_events_delete
  on public.calendar_events
  for delete
  using (public.is_company_member(company_id));

drop policy if exists calendar_event_attendees_select on public.calendar_event_attendees;
create policy calendar_event_attendees_select
  on public.calendar_event_attendees
  for select
  using (public.is_company_member(company_id));

drop policy if exists calendar_event_attendees_insert on public.calendar_event_attendees;
create policy calendar_event_attendees_insert
  on public.calendar_event_attendees
  for insert
  with check (public.is_company_member(company_id));

drop policy if exists calendar_event_attendees_update on public.calendar_event_attendees;
create policy calendar_event_attendees_update
  on public.calendar_event_attendees
  for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists calendar_event_attendees_delete on public.calendar_event_attendees;
create policy calendar_event_attendees_delete
  on public.calendar_event_attendees
  for delete
  using (public.is_company_member(company_id));
