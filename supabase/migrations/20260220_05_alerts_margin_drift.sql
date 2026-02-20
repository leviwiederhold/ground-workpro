alter table if exists public.alerts
  drop constraint if exists alerts_alert_type_check;

alter table if exists public.alerts
  add constraint alerts_alert_type_check
  check (alert_type in ('low_inventory', 'overdue_maintenance', 'margin_drift'));

alter table if exists public.alerts
  drop constraint if exists alerts_entity_type_check;

alter table if exists public.alerts
  add constraint alerts_entity_type_check
  check (entity_type in ('inventory', 'work_order', 'equipment', 'job'));
