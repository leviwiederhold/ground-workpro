-- Read-only diagnostics & verification for the auth.users deletion fix.
-- Run these in the Supabase SQL editor. They modify nothing.

-- (A) Identify EVERY foreign key referencing auth.users and its ON DELETE rule.
--     confdeltype: a=no action, r=restrict, c=cascade, n=set null, d=set default
select
  ns.nspname                              as schema,
  cl.relname                             as table_name,
  att.attname                            as column_name,
  con.conname                            as constraint_name,
  case con.confdeltype
    when 'a' then 'NO ACTION  <-- blocks delete'
    when 'r' then 'RESTRICT   <-- blocks delete'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
  end                                    as on_delete
from pg_constraint con
join pg_class cl      on cl.oid = con.conrelid
join pg_namespace ns  on ns.oid = cl.relnamespace
join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
where con.contype = 'f'
  and con.confrelid = 'auth.users'::regclass
  and array_length(con.conkey, 1) = 1
order by on_delete desc, table_name;
-- BEFORE the migration: expect NO ACTION on profiles.id, memberships.user_id,
-- employees.user_id (the base-schema tables). AFTER: none should say NO ACTION.

-- (B) Confirm the owner-protection trigger exists.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;

-- (C) See which users currently own an active company (these are the only ones
--     the trigger will block; everyone else, including employees, deletes cleanly).
select m.user_id, c.name as company, c.subscription_status
from public.memberships m
join public.companies c on c.id = m.company_id
where lower(coalesce(m.role,'')) in ('admin','ceo','executive','owner')
  and lower(coalesce(c.subscription_status,'')) in ('active','trialing')
order by company;
