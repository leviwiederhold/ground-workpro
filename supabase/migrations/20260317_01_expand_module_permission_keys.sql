do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'module_permission_key'
      and e.enumlabel = 'inventory'
  ) then
    alter type public.module_permission_key add value 'inventory';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'module_permission_key'
      and e.enumlabel = 'reports'
  ) then
    alter type public.module_permission_key add value 'reports';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'module_permission_key'
      and e.enumlabel = 'vendors'
  ) then
    alter type public.module_permission_key add value 'vendors';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'module_permission_key'
      and e.enumlabel = 'documents'
  ) then
    alter type public.module_permission_key add value 'documents';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'module_permission_key'
      and e.enumlabel = 'training'
  ) then
    alter type public.module_permission_key add value 'training';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'module_permission_key'
      and e.enumlabel = 'integrations'
  ) then
    alter type public.module_permission_key add value 'integrations';
  end if;
end $$;

insert into public.module_permission_templates (role, module_key, access_level)
values
  ('ceo', 'inventory', 'edit'),
  ('ceo', 'reports', 'edit'),
  ('ceo', 'vendors', 'edit'),
  ('ceo', 'documents', 'edit'),
  ('ceo', 'training', 'edit'),
  ('ceo', 'integrations', 'edit'),

  ('manager', 'inventory', 'edit'),
  ('manager', 'reports', 'none'),
  ('manager', 'vendors', 'edit'),
  ('manager', 'documents', 'edit'),
  ('manager', 'training', 'edit'),
  ('manager', 'integrations', 'none'),

  ('foreman', 'inventory', 'none'),
  ('foreman', 'reports', 'none'),
  ('foreman', 'vendors', 'none'),
  ('foreman', 'documents', 'view'),
  ('foreman', 'training', 'view'),
  ('foreman', 'integrations', 'none'),

  ('mechanic', 'inventory', 'edit'),
  ('mechanic', 'reports', 'none'),
  ('mechanic', 'vendors', 'none'),
  ('mechanic', 'documents', 'none'),
  ('mechanic', 'training', 'view'),
  ('mechanic', 'integrations', 'none'),

  ('operator', 'inventory', 'none'),
  ('operator', 'reports', 'none'),
  ('operator', 'vendors', 'none'),
  ('operator', 'documents', 'view'),
  ('operator', 'training', 'none'),
  ('operator', 'integrations', 'none'),

  ('fieldstaff', 'inventory', 'none'),
  ('fieldstaff', 'reports', 'none'),
  ('fieldstaff', 'vendors', 'none'),
  ('fieldstaff', 'documents', 'view'),
  ('fieldstaff', 'training', 'none'),
  ('fieldstaff', 'integrations', 'none'),

  ('manager', 'finance', 'none')
on conflict (role, module_key) do update
set access_level = excluded.access_level,
    updated_at = now();

