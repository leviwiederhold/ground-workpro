alter table public.equipment
  add column if not exists vin text;

create index if not exists equipment_company_vin_idx
  on public.equipment (company_id, vin)
  where vin is not null and vin <> '';
