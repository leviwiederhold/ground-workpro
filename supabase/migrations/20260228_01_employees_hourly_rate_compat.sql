alter table if exists public.employees
  add column if not exists hourly_rate numeric not null default 0;

do $$
declare
  has_pay_rate boolean;
  has_rate boolean;
  has_hourly_rate_camel boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'pay_rate'
  ) into has_pay_rate;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'rate'
  ) into has_rate;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'employees'
      and column_name = 'hourlyRate'
  ) into has_hourly_rate_camel;

  if has_pay_rate then
    execute 'update public.employees set hourly_rate = coalesce(hourly_rate, 0) + 0';
    execute 'update public.employees set hourly_rate = pay_rate where coalesce(hourly_rate, 0) = 0 and pay_rate is not null';
  end if;

  if has_rate then
    execute 'update public.employees set hourly_rate = rate where coalesce(hourly_rate, 0) = 0 and rate is not null';
  end if;

  if has_hourly_rate_camel then
    execute 'update public.employees set hourly_rate = "hourlyRate" where coalesce(hourly_rate, 0) = 0 and "hourlyRate" is not null';
  end if;
end
$$;

