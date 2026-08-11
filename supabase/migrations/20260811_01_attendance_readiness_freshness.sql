-- Readiness reports can be delivered by the foreground WebView and the
-- cookie-independent native process at the same time. Network completion order
-- is not capture order, so preserve the newest captured native report at the
-- database boundary. This trigger is the concurrency-safe backstop for both
-- readiness APIs.

create or replace function public.preserve_newest_attendance_readiness()
returns trigger
language plpgsql
as $$
begin
  if old.native_readiness_reported_at is not null
     and (
       new.native_readiness_reported_at is null
       or new.native_readiness_reported_at <= old.native_readiness_reported_at
     ) then
    new.location_services_enabled := old.location_services_enabled;
    new.foreground := old.foreground;
    new.background := old.background;
    new.precise := old.precise;
    new.platform := old.platform;
    new.onboarding_completed_at := old.onboarding_completed_at;
    new.background_refresh_enabled := old.background_refresh_enabled;
    new.native_service_supported := old.native_service_supported;
    new.native_service_healthy := old.native_service_healthy;
    new.native_has_secure_credential := old.native_has_secure_credential;
    new.required_region_ids := old.required_region_ids;
    new.registered_region_ids := old.registered_region_ids;
    new.native_device_id := old.native_device_id;
    new.native_readiness_reported_at := old.native_readiness_reported_at;
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

drop trigger if exists employee_location_permissions_readiness_freshness
  on public.employee_location_permissions;
create trigger employee_location_permissions_readiness_freshness
  before update on public.employee_location_permissions
  for each row execute function public.preserve_newest_attendance_readiness();
