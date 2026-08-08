-- One-active-job invariant for employee crew memberships.
--
-- This migration intentionally does not delete, rewrite, or choose among any
-- existing multi-job rows. The triggers apply to future assignment writes and
-- future inactive -> active job transitions. Existing data remediation remains
-- a separate, explicit production operation.

create or replace function public.gw_job_status_is_active(p_status text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(coalesce(p_status, '')) in ('in_progress', 'active', 'open', 'approved');
$$;

create or replace function public.gw_lock_job_assignment(
  p_company_id uuid,
  p_job_id uuid
)
returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(
    hashtextextended('gw:job:' || p_company_id::text || ':' || p_job_id::text, 0)
  );
$$;

create or replace function public.gw_lock_employee_assignment(
  p_company_id uuid,
  p_employee_id uuid
)
returns void
language sql
volatile
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(
    hashtextextended('gw:employee:' || p_company_id::text || ':' || p_employee_id::text, 0)
  );
$$;

create or replace function public.gw_current_active_job(
  p_company_id uuid,
  p_employee_id uuid,
  p_excluded_job_ids uuid[] default '{}'::uuid[]
)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select j.id, coalesce(j.name, '')::text
    from public.job_employees je
    join public.jobs j
      on j.id = je.job_id
     and j.company_id = je.company_id
   where je.company_id = p_company_id
     and je.employee_id = p_employee_id
     and not (j.id = any(coalesce(p_excluded_job_ids, '{}'::uuid[])))
     and public.gw_job_status_is_active(j.status)
   order by j.id
   limit 1;
$$;

create or replace function public.assign_job_employee(
  p_company_id uuid,
  p_job_id uuid,
  p_employee_id uuid,
  p_assigned_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_status text;
  v_current_job_id uuid;
  v_current_job_name text;
begin
  -- The per-job lock closes the race between crew insertion and a concurrent
  -- inactive -> active status transition. The employee lock serializes two
  -- assignments for the same person.
  perform public.gw_lock_job_assignment(p_company_id, p_job_id);
  perform public.gw_lock_employee_assignment(p_company_id, p_employee_id);

  select j.status
    into v_job_status
    from public.jobs j
   where j.id = p_job_id
     and j.company_id = p_company_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
  end if;

  if not exists (
    select 1
      from public.employees e
     where e.id = p_employee_id
       and e.company_id = p_company_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'EMPLOYEE_NOT_FOUND');
  end if;

  if exists (
    select 1
      from public.job_employees je
     where je.company_id = p_company_id
       and je.job_id = p_job_id
       and je.employee_id = p_employee_id
  ) then
    return jsonb_build_object('ok', true, 'status', 'already_assigned');
  end if;

  if public.gw_job_status_is_active(v_job_status) then
    select conflict.id, conflict.name
      into v_current_job_id, v_current_job_name
      from public.gw_current_active_job(
        p_company_id,
        p_employee_id,
        array[p_job_id]
      ) conflict;

    if v_current_job_id is not null then
      return jsonb_build_object(
        'ok', false,
        'code', 'EMPLOYEE_ASSIGNMENT_CONFLICT',
        'current_job', jsonb_build_object(
          'id', v_current_job_id,
          'name', v_current_job_name
        )
      );
    end if;
  end if;

  insert into public.job_employees (
    company_id,
    job_id,
    employee_id,
    assigned_role
  ) values (
    p_company_id,
    p_job_id,
    p_employee_id,
    p_assigned_role
  );

  return jsonb_build_object('ok', true, 'status', 'assigned');
end;
$$;

create or replace function public.reassign_job_employee(
  p_company_id uuid,
  p_from_job_id uuid,
  p_to_job_id uuid,
  p_employee_id uuid,
  p_assigned_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_status text;
  v_previous_role text;
  v_current_job_id uuid;
  v_current_job_name text;
begin
  perform public.gw_lock_job_assignment(p_company_id, p_to_job_id);
  perform public.gw_lock_employee_assignment(p_company_id, p_employee_id);

  select j.status
    into v_target_status
    from public.jobs j
   where j.id = p_to_job_id
     and j.company_id = p_company_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'JOB_NOT_FOUND');
  end if;

  if not exists (
    select 1
      from public.employees e
     where e.id = p_employee_id
       and e.company_id = p_company_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'EMPLOYEE_NOT_FOUND');
  end if;

  select je.assigned_role
    into v_previous_role
    from public.job_employees je
   where je.company_id = p_company_id
     and je.job_id = p_from_job_id
     and je.employee_id = p_employee_id
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'SOURCE_ASSIGNMENT_NOT_FOUND');
  end if;

  if public.gw_job_status_is_active(v_target_status) then
    select conflict.id, conflict.name
      into v_current_job_id, v_current_job_name
      from public.gw_current_active_job(
        p_company_id,
        p_employee_id,
        array[p_from_job_id, p_to_job_id]
      ) conflict;

    if v_current_job_id is not null then
      return jsonb_build_object(
        'ok', false,
        'code', 'EMPLOYEE_ASSIGNMENT_CONFLICT',
        'current_job', jsonb_build_object(
          'id', v_current_job_id,
          'name', v_current_job_name
        )
      );
    end if;
  end if;

  -- These writes are one database transaction. If the insert or its trigger
  -- fails, the source delete rolls back automatically.
  delete from public.job_employees
   where company_id = p_company_id
     and job_id = p_from_job_id
     and employee_id = p_employee_id;

  if not exists (
    select 1
      from public.job_employees je
     where je.company_id = p_company_id
       and je.job_id = p_to_job_id
       and je.employee_id = p_employee_id
  ) then
    insert into public.job_employees (
      company_id,
      job_id,
      employee_id,
      assigned_role
    ) values (
      p_company_id,
      p_to_job_id,
      p_employee_id,
      coalesce(p_assigned_role, v_previous_role)
    );
  end if;

  return jsonb_build_object('ok', true, 'status', 'reassigned');
end;
$$;

create or replace function public.gw_enforce_job_employee_active_uniqueness()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_status text;
  v_current_job_id uuid;
  v_current_job_name text;
begin
  if tg_op = 'UPDATE'
     and new.company_id = old.company_id
     and new.job_id = old.job_id
     and new.employee_id = old.employee_id then
    return new;
  end if;

  perform public.gw_lock_job_assignment(new.company_id, new.job_id);
  perform public.gw_lock_employee_assignment(new.company_id, new.employee_id);

  select j.status
    into v_target_status
    from public.jobs j
   where j.id = new.job_id
     and j.company_id = new.company_id;

  if public.gw_job_status_is_active(v_target_status) then
    select conflict.id, conflict.name
      into v_current_job_id, v_current_job_name
      from public.gw_current_active_job(
        new.company_id,
        new.employee_id,
        array[new.job_id]
      ) conflict;

    if v_current_job_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'EMPLOYEE_ASSIGNMENT_CONFLICT',
        detail = jsonb_build_object(
          'current_job', jsonb_build_object(
            'id', v_current_job_id,
            'name', v_current_job_name
          )
        )::text;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.gw_enforce_job_activation_uniqueness()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment record;
  v_current_job_id uuid;
  v_current_job_name text;
begin
  if not public.gw_job_status_is_active(new.status)
     or public.gw_job_status_is_active(old.status) then
    return new;
  end if;

  perform public.gw_lock_job_assignment(new.company_id, new.id);

  for v_assignment in
    select distinct je.employee_id
      from public.job_employees je
     where je.company_id = new.company_id
       and je.job_id = new.id
     order by je.employee_id
  loop
    perform public.gw_lock_employee_assignment(new.company_id, v_assignment.employee_id);

    select conflict.id, conflict.name
      into v_current_job_id, v_current_job_name
      from public.gw_current_active_job(
        new.company_id,
        v_assignment.employee_id,
        array[new.id]
      ) conflict;

    if v_current_job_id is not null then
      raise exception using
        errcode = 'P0001',
        message = 'JOB_ACTIVATION_ASSIGNMENT_CONFLICT',
        detail = jsonb_build_object(
          'employee_id', v_assignment.employee_id,
          'current_job', jsonb_build_object(
            'id', v_current_job_id,
            'name', v_current_job_name
          )
        )::text;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists job_employees_one_active_job_insert_guard on public.job_employees;
create trigger job_employees_one_active_job_insert_guard
before insert on public.job_employees
for each row
execute function public.gw_enforce_job_employee_active_uniqueness();

drop trigger if exists job_employees_one_active_job_update_guard on public.job_employees;
create trigger job_employees_one_active_job_update_guard
before update of company_id, job_id, employee_id on public.job_employees
for each row
execute function public.gw_enforce_job_employee_active_uniqueness();

drop trigger if exists jobs_activation_assignment_guard on public.jobs;
create trigger jobs_activation_assignment_guard
before update of status
on public.jobs
for each row
execute function public.gw_enforce_job_activation_uniqueness();

-- Only the server's service-role client may call the write RPCs. Browser users
-- still receive the trigger protection on any direct table write permitted by
-- existing RLS, but cannot bypass the server authorization layer by invoking a
-- SECURITY DEFINER reassignment themselves.
revoke all on function public.assign_job_employee(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reassign_job_employee(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.assign_job_employee(uuid, uuid, uuid, text) to service_role;
grant execute on function public.reassign_job_employee(uuid, uuid, uuid, uuid, text) to service_role;

revoke all on function public.gw_job_status_is_active(text) from public, anon, authenticated;
revoke all on function public.gw_lock_job_assignment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.gw_lock_employee_assignment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.gw_current_active_job(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.gw_enforce_job_employee_active_uniqueness() from public, anon, authenticated;
revoke all on function public.gw_enforce_job_activation_uniqueness() from public, anon, authenticated;
