alter table if exists public.bids
  add column if not exists excavation_cy numeric,
  add column if not exists production_cy_per_hour numeric,
  add column if not exists haul_hours numeric,
  add column if not exists truck_capacity_cy numeric,
  add column if not exists cycle_time_minutes numeric,
  add column if not exists dump_loads numeric,
  add column if not exists dump_fee_per_load numeric,
  add column if not exists fuel_burn_gph numeric,
  add column if not exists fuel_cost_per_gallon numeric;

alter table if exists public.bid_items
  add column if not exists equipment_id uuid;

alter table if exists public.equipment
  add column if not exists hourly_rate numeric;
