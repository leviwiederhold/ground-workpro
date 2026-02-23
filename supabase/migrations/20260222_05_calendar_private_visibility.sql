do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'calendar_events_visibility_check'
      and conrelid = 'public.calendar_events'::regclass
  ) then
    alter table public.calendar_events
      drop constraint calendar_events_visibility_check;
  end if;
end
$$;

alter table public.calendar_events
  add constraint calendar_events_visibility_check
  check (visibility in ('attendees', 'company', 'private'));
