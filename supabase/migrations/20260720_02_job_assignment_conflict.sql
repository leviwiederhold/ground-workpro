-- ============================================================================
-- Conflicting employee job-assignment detection + atomic (re)assignment.
--
-- Enforces the rule server-side, inside a single transaction, so it holds even
-- under concurrent requests:
--   An employee cannot be a crew member of two simultaneously ACTIVE jobs whose
--   schedules overlap. Non-overlapping active jobs are allowed; an indeterminate
--   schedule (missing/invalid dates) counts as overlapping.
--
-- Concurrency: each function takes a per-(company, employee) transaction-scoped
-- advisory lock, so two simultaneous assignments for the same employee are
-- serialized and cannot both create an active double-booking.
--
-- These operate on the preferred `job_employees` join-table schema. Older
-- environments (assignment column on `employees`, or no job_employees table)
-- fall back to the app's non-transactional path; the functions simply error at
-- call time there and the API handles it.
-- ============================================================================

-- Safe timestamp parse: returns NULL instead of erroring on blank/invalid text.
-- Tolerates both date ('YYYY-MM-DD') and full timestamp inputs.
create or replace function public._safe_ts(v text)
returns timestamptz
language plpgsql
stable
as $$
begin
  if v is null or btrim(v) = '' then
    return null;
  end if;
  return v::timestamptz;
exception when others then
  return null;
end;
$$;

-- A job status that represents a currently-active job.
create or replace function public._job_status_is_active(status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(status, '')) in ('in_progress', 'active', 'open');
$$;

-- Schedules conflict when the ranges overlap OR when overlap cannot be proven
-- (either side missing/invalid) — mirrors schedulesConflict() in TypeScript.
create or replace function public._assignment_schedules_conflict(
  a_start timestamptz, a_end timestamptz,
  b_start timestamptz, b_end timestamptz
)
returns boolean
language sql
immutable
as $$
  select case
    when a_start is null or a_end is null or b_start is null or b_end is null
         or a_start > a_end or b_start > b_end
      then true
    else a_start <= b_end and b_start <= a_end
  end;
$$;

-- Extract a job's start/end (tolerating column-name variants) from a jsonb row.
create or replace function public._job_sched_start(j jsonb)
returns timestamptz
language sql
stable
as $$
  select public._safe_ts(coalesce(j->>'starts_at', j->>'start_date', j->>'startDate'));
$$;

create or replace function public._job_sched_end(j jsonb)
returns timestamptz
language sql
stable
as $$
  select public._safe_ts(
    coalesce(j->>'ends_at', j->>'end_date', j->>'target_end_date', j->>'targetEndDate', j->>'endDate')
  );
$$;

-- Find the first OTHER active, schedule-conflicting job the employee is on.
-- Returns a jsonb conflicting_job payload, or NULL when there is no conflict.
-- `p_exclude_job_ids` lets the reassign path ignore the job being left.
create or replace function public._find_assignment_conflict(
  p_company_id uuid,
  p_employee_id text,
  p_target_start timestamptz,
  p_target_end timestamptz,
  p_exclude_job_ids text[]
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
           'id', j.id::text,
           'name', coalesce(j.name, ''),
           'startAt', public._job_sched_start(to_jsonb(j)),
           'endAt', public._job_sched_end(to_jsonb(j))
         )
    from public.job_employees je
    join public.jobs j
      on j.id = je.job_id and j.company_id = je.company_id
   where je.company_id = p_company_id
     and je.employee_id::text = p_employee_id
     and not (j.id::text = any(p_exclude_job_ids))
     and public._job_status_is_active(j.status)
     and public._assignment_schedules_conflict(
           p_target_start, p_target_end,
           public._job_sched_start(to_jsonb(j)), public._job_sched_end(to_jsonb(j))
         )
   limit 1;
$$;

-- Assign an employee to a job, rejecting conflicting active double-bookings.
-- Returns jsonb: { ok, conflict?, already_assigned?, assigned?, conflicting_job?, error? }.
create or replace function public.assign_job_employee(
  p_company_id uuid,
  p_job_id text,
  p_employee_id text,
  p_assigned_role text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_job jsonb;
  v_target_start timestamptz;
  v_target_end timestamptz;
  v_conflict jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || ':' || p_employee_id, 0)
  );

  select to_jsonb(j) into v_job
    from public.jobs j
   where j.id::text = p_job_id and j.company_id = p_company_id;
  if v_job is null then
    return jsonb_build_object('ok', false, 'error', 'JOB_NOT_FOUND');
  end if;

  -- Idempotent: already on this job.
  if exists (
    select 1 from public.job_employees je
     where je.company_id = p_company_id
       and je.job_id::text = p_job_id
       and je.employee_id::text = p_employee_id
  ) then
    return jsonb_build_object('ok', true, 'already_assigned', true);
  end if;

  if public._job_status_is_active(v_job->>'status') then
    v_target_start := public._job_sched_start(v_job);
    v_target_end := public._job_sched_end(v_job);
    v_conflict := public._find_assignment_conflict(
      p_company_id, p_employee_id, v_target_start, v_target_end, array[p_job_id]
    );
    if v_conflict is not null then
      return jsonb_build_object('ok', false, 'conflict', true, 'conflicting_job', v_conflict);
    end if;
  end if;

  -- Insert the text ids directly; the target columns' assignment cast handles
  -- both uuid and integer id schemas (avoid a hard ::uuid cast).
  insert into public.job_employees (company_id, job_id, employee_id)
  select p_company_id, p_job_id, p_employee_id
  where not exists (
    select 1 from public.job_employees je
     where je.company_id = p_company_id
       and je.job_id::text = p_job_id
       and je.employee_id::text = p_employee_id
  );

  if p_assigned_role is not null then
    begin
      update public.job_employees
         set assigned_role = p_assigned_role
       where company_id = p_company_id
         and job_id::text = p_job_id
         and employee_id::text = p_employee_id;
    exception when undefined_column then
      null; -- assigned_role absent in this environment; ignore.
    end;
  end if;

  return jsonb_build_object('ok', true, 'assigned', true);
end;
$$;

-- Atomically move an employee from one job to another: remove old membership,
-- add new membership, conflict-checked (ignoring the job being left) — all in a
-- single transaction that succeeds or fails as one operation.
create or replace function public.reassign_job_employee(
  p_company_id uuid,
  p_from_job_id text,
  p_to_job_id text,
  p_employee_id text,
  p_assigned_role text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_job jsonb;
  v_target_start timestamptz;
  v_target_end timestamptz;
  v_conflict jsonb;
  v_removed int := 0;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_company_id::text || ':' || p_employee_id, 0)
  );

  select to_jsonb(j) into v_job
    from public.jobs j
   where j.id::text = p_to_job_id and j.company_id = p_company_id;
  if v_job is null then
    return jsonb_build_object('ok', false, 'error', 'JOB_NOT_FOUND');
  end if;

  -- Conflict check against every OTHER active job, ignoring both the target and
  -- the job we are about to leave.
  if public._job_status_is_active(v_job->>'status') then
    v_target_start := public._job_sched_start(v_job);
    v_target_end := public._job_sched_end(v_job);
    v_conflict := public._find_assignment_conflict(
      p_company_id, p_employee_id, v_target_start, v_target_end,
      array[p_to_job_id, p_from_job_id]
    );
    if v_conflict is not null then
      return jsonb_build_object('ok', false, 'conflict', true, 'conflicting_job', v_conflict);
    end if;
  end if;

  delete from public.job_employees
   where company_id = p_company_id
     and job_id::text = p_from_job_id
     and employee_id::text = p_employee_id;
  get diagnostics v_removed = row_count;

  insert into public.job_employees (company_id, job_id, employee_id)
  select p_company_id, p_to_job_id, p_employee_id
  where not exists (
    select 1 from public.job_employees je
     where je.company_id = p_company_id
       and je.job_id::text = p_to_job_id
       and je.employee_id::text = p_employee_id
  );

  if p_assigned_role is not null then
    begin
      update public.job_employees
         set assigned_role = p_assigned_role
       where company_id = p_company_id
         and job_id::text = p_to_job_id
         and employee_id::text = p_employee_id;
    exception when undefined_column then
      null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'reassigned', true, 'removed_count', v_removed);
end;
$$;

-- Invoker-security functions run as the caller, so the caller needs EXECUTE on
-- every function in the call chain.
grant execute on function public._safe_ts(text) to authenticated, service_role;
grant execute on function public._job_status_is_active(text) to authenticated, service_role;
grant execute on function public._assignment_schedules_conflict(timestamptz, timestamptz, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public._job_sched_start(jsonb) to authenticated, service_role;
grant execute on function public._job_sched_end(jsonb) to authenticated, service_role;
grant execute on function public._find_assignment_conflict(uuid, text, timestamptz, timestamptz, text[]) to authenticated, service_role;
grant execute on function public.assign_job_employee(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.reassign_job_employee(uuid, text, text, text, text) to authenticated, service_role;

-- Harden the join table against duplicate memberships (defense in depth on top
-- of the advisory lock). Guarded so it is a no-op where job_employees is absent.
do $$
begin
  if to_regclass('public.job_employees') is not null then
    delete from public.job_employees a
      using public.job_employees b
     where a.ctid < b.ctid
       and a.company_id = b.company_id
       and a.job_id = b.job_id
       and a.employee_id = b.employee_id;

    create unique index if not exists job_employees_company_job_employee_uidx
      on public.job_employees (company_id, job_id, employee_id);
  end if;
end;
$$;
