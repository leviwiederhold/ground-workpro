alter table if exists public.companies
  add column if not exists timezone text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists address text,
  add column if not exists website text,
  add column if not exists industry text,
  add column if not exists employee_count integer,
  add column if not exists default_work_hours text,
  add column if not exists currency text not null default 'USD',
  add column if not exists date_format text not null default 'MM/DD/YYYY',
  add column if not exists company_logo text;

alter table if exists public.companies
  drop constraint if exists companies_employee_count_nonnegative;

alter table if exists public.companies
  add constraint companies_employee_count_nonnegative
  check (employee_count is null or employee_count >= 0);
