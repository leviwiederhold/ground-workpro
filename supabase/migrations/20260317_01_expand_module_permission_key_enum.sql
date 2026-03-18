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
