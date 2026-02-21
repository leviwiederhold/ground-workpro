# Golden Signals (Alert-Ready)

This project tracks operational health using four signals:

1. Error rate
2. Latency
3. Queue depth
4. Webhook failures

## Error Rate

### Sources

- API error responses (`http_errors_total`)
- Structured server logs (`api_error`)
- Sentry issues

### Suggested alerts

- **Warning**: 5xx error rate > 1% for 5 minutes
- **Critical**: 5xx error rate > 3% for 5 minutes
- **Critical**: any sustained 500 spikes on key endpoints (`/api/bids/*`, `/api/proposals/*`, `/api/jobs/*`)

### Triage checks

1. Filter by `route`, `companyId`, `userId`, and `role`
2. Check Sentry stack traces + newest deploy
3. Confirm DB/storage/provider dependency status

## Latency

### Sources

- Request logger duration fields
- Endpoint timing from platform logs/APM

### Suggested alerts

- **Warning**: p95 API latency > 1500ms for 10 minutes
- **Critical**: p95 API latency > 3000ms for 10 minutes
- **Critical**: p99 > 5000ms on write endpoints

### Triage checks

1. Identify slow routes
2. Verify query plans/index coverage
3. Check rate limiting pressure and retry storms

## Queue Depth

### Sources

- Outbox/background processor gauges:
  - `outbox_queue_claimed`
  - `outbox_queue_failed`
  - `outbox_processor_runs_total`

### Suggested alerts

- **Warning**: failed queue items > 0 for 10 minutes
- **Critical**: queue processing stopped (no processor runs) for 15 minutes during business hours
- **Critical**: failed queue items increasing for 3 consecutive runs

### Triage checks

1. Inspect latest processor logs for `last_error`
2. Confirm worker/cron trigger health
3. Re-run stuck jobs after root cause fix

## Webhook Failures

### Sources

- `webhook_ingest_total`
- `webhook_failures_total`
- `webhook_events` table status/error

### Suggested alerts

- **Warning**: signature failures > 5 in 10 minutes
- **Critical**: webhook failure ratio > 20% for 10 minutes
- **Critical**: provider-specific failures sustained for 15 minutes

### Triage checks

1. Verify provider signature secret configuration
2. Check idempotency behavior and duplicate patterns
3. Validate payload format/version changes from provider

## Minimum Dashboard Panels

- Request rate + error rate (4xx/5xx split)
- p50/p95/p99 latency by route
- Queue claimed/failed trend
- Webhook success/failure by provider
- Open Sentry issues by environment

## Incident Severity Guidance

- **SEV-1**: user-facing outage, approval/send flows broken, or sustained 5xx spikes
- **SEV-2**: degraded performance or partial provider ingestion failure
- **SEV-3**: intermittent errors with workaround available
