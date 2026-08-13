-- Native attendance credential renewal + replay-safe ingest outcomes.
--
-- Access tokens remain short-lived. A separately hashed, attendance-only
-- refresh secret lets iOS renew them without a WebView session. Revoking the
-- device row invalidates both secrets immediately.
alter table public.device_attendance_credentials
  add column if not exists refresh_token_hash text null,
  add column if not exists refresh_expires_at timestamptz null,
  add column if not exists last_refreshed_at timestamptz null;

create unique index if not exists device_attendance_credentials_refresh_token_uidx
  on public.device_attendance_credentials (refresh_token_hash)
  where refresh_token_hash is not null;

-- Persist the actual ingest response. A rejected first attempt must replay the
-- same rejection; it must never become a false 200 "duplicate" that causes the
-- native queue to discard the transition.
alter table public.attendance_event_audit
  add column if not exists response_status integer not null default 200,
  add column if not exists response_reason text null;
