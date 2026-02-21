-- Performance indexes for paginated company-scoped list endpoints.
-- Safe to run repeatedly.

create index if not exists idx_jobs_company_created_at on public.jobs (company_id, created_at desc);
create index if not exists idx_jobs_company_id on public.jobs (company_id, id);

create index if not exists idx_equipment_company_created_at on public.equipment (company_id, created_at desc);
create index if not exists idx_employees_company_created_at on public.employees (company_id, created_at desc);
create index if not exists idx_vendors_company_created_at on public.vendors (company_id, created_at desc);
create index if not exists idx_inventory_company_created_at on public.inventory (company_id, created_at desc);
create index if not exists idx_work_orders_company_created_at on public.work_orders (company_id, created_at desc);
create index if not exists idx_purchase_orders_company_created_at on public.purchase_orders (company_id, created_at desc);
create index if not exists idx_bids_company_created_at on public.bids (company_id, created_at desc);

create index if not exists idx_daily_reports_company_date on public.daily_reports (company_id, date desc);
create index if not exists idx_daily_reports_company_created_at on public.daily_reports (company_id, created_at desc);

create index if not exists idx_cost_codes_company_code on public.cost_codes (company_id, code);
create index if not exists idx_safety_logs_company_occurred_on on public.safety_logs (company_id, occurred_on desc);

create index if not exists idx_message_channels_company_created_at on public.message_channels (company_id, created_at);
create index if not exists idx_messages_company_channel_created_at on public.messages (company_id, channel_id, created_at desc);

create index if not exists idx_attachments_company_entity_created_at
  on public.attachments (company_id, entity_type, entity_id, created_at desc);
