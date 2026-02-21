# Ops Runbook: Backups, Restore Rehearsal, and Incident Response

This runbook defines how Groundwork Pro backs up and restores critical data and how to rehearse recovery.

Recovery objectives:

- RPO target: 24 hours maximum data loss for standard incidents
- RTO target: 4 hours to restore core operations in a recovery environment

## 1) Supabase backup approach (production)

Use layered backups. Do not rely on a single mechanism.

### Database backups

1. Enable Supabase managed backups.
2. Keep PITR enabled.
3. Schedule a daily logical export:
   - `pg_dump --format=custom` for portable restore tests.
4. Store backup artifacts in a separate recovery project/location.
5. Retention target:
   - Daily backups: 30 days
   - Weekly backups: 12 weeks
   - Monthly backups: 12 months

### Backup ownership checklist

- Primary owner: Engineering on-call
- Secondary owner: Platform lead
- Weekly check: verify last successful backup timestamp
- Monthly check: verify retention lifecycle is still enforced

### Storage backups

1. Mirror all Supabase Storage buckets to external object storage daily.
2. Include all app buckets (attachments, report files, work order files, document uploads).
3. Use object versioning and immutable retention in backup storage.
4. Keep a bucket inventory doc with:
   - bucket name
   - privacy mode (public/private)
   - estimated size
   - last successful mirror timestamp

### Storage bucket recovery notes

When restoring Storage:

1. Recreate missing buckets first (exact names).
2. Reapply bucket policies and access mode before object restore.
3. Restore objects using original key paths to preserve DB references (`bucket` + `path`).
4. Validate signed URL generation for private buckets after restore.
5. Verify at least one file per critical bucket:
   - list succeeds
   - signed download URL opens
   - delete still respects RBAC/RLS paths

### Config and secrets backups

1. Export and store:
   - Supabase project settings snapshot
   - RLS policies/migrations (already in `supabase/migrations`)
   - Vercel environment variable inventory (names only in docs; values in secret manager)
2. Keep this in an internal secure runbook location.

## 2) Restore rehearsal (drill procedure)

Run quarterly in a non-production environment.

### Pre-check

1. Choose a backup timestamp and write it in the drill ticket.
2. Record baseline checks from production:
   - row counts for key tables (`jobs`, `bids`, `attachments`, `messages`, `safety_logs`)
   - a known file path from a Storage bucket
3. Confirm on-call + backup owner are both present for the drill.

### Rehearsal steps

1. Provision a fresh restore target project/database.
2. Restore database backup to target.
3. Restore mirrored Storage snapshot to target buckets.
4. Apply migrations that occurred after backup time (if required).
5. Point a staging deploy at restored target.
6. Execute smoke checks:
   - login works
   - `/api/health/supabase` returns success
   - core modules load without 500s
   - attachment download works from restored storage
7. Capture final timestamps and compare against RTO/RPO targets.

### Verification checklist (must pass)

1. Key table counts are within expected tolerance vs baseline.
2. Sample business flows work:
   - create/update/delete job
   - create/send bid and load summary
   - list messages and safety logs
3. At least one restored file is downloadable.
4. No migration drift errors.

## 3) Restore drill checklist (copy/paste)

Use this for each quarterly rehearsal.

### A. Preparation

- [ ] Drill ticket created with owner + observers
- [ ] Selected backup timestamp recorded
- [ ] Production baseline counts captured
- [ ] Sample file keys captured from 2+ buckets

### B. Database restore

- [ ] New restore target provisioned
- [ ] Backup imported successfully
- [ ] Post-restore migrations applied (if required)
- [ ] Row counts validated (within expected tolerance)

### C. Storage restore

- [ ] Required buckets recreated/restored
- [ ] Bucket policies/access modes verified
- [ ] Objects restored with original key paths
- [ ] Signed download URL test passed

### D. Application validation

- [ ] App boots and login works
- [ ] `/api/health/supabase` returns healthy
- [ ] Jobs, Bids, Messages, Safety, Attachments pages load
- [ ] Create/update/delete smoke checks pass

### E. Exit criteria

- [ ] RTO measured and documented
- [ ] RPO measured and documented
- [ ] Gaps captured with owners + due dates
- [ ] Runbook updated if steps changed

### Evidence to capture

1. Restore start/end timestamps (RTO measured).
2. Data loss window (RPO measured).
3. Failures, fixes, and runbook updates required.

## 4) Incident runbooks

Use these as first-response playbooks.

### A) Auth outage runbook

Symptoms:

- Login fails globally
- Session refresh errors
- 401 spikes on protected API routes

Steps:

1. Confirm Supabase Auth status page / project health.
2. Check app logs for auth middleware and token errors.
3. Validate env vars are present:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Validate cookies/session behavior on preview and production.
5. If provider outage confirmed:
   - post user-facing incident notice
   - pause non-critical deploys
6. Recovery validation:
   - successful login
   - protected API routes return normal 2xx/4xx rates

### B) Database outage runbook

Symptoms:

- Widespread 500s
- connection/pool errors
- queries timing out

Steps:

1. Check Supabase database status and metrics.
2. Check recent schema changes/migrations.
3. Enable read-only incident mode (operational decision) if writes are unsafe.
4. Roll back the most recent risky release if correlated.
5. If corruption/data-loss risk:
   - initiate restore plan to recovery environment
   - validate restore before production cutover
6. Recovery validation:
   - `/api/health/supabase` healthy
   - key endpoints stable
   - write flows succeed

### C) Storage outage runbook

Symptoms:

- uploads failing
- signed URL failures
- file downloads unavailable

Steps:

1. Check Supabase Storage status.
2. Verify bucket existence and policies did not drift.
3. Validate service role key availability for server-side storage actions.
4. Retry signed URL generation path and bucket permissions.
5. If provider outage:
   - communicate degraded state (uploads/downloads)
   - queue/retry upload actions where possible
6. Recovery validation:
   - upload succeeds
   - file list renders
   - signed download URL opens successfully

## 5) Ownership and cadence

1. Owner: Engineering on-call.
2. Backup policy review: monthly.
3. Restore rehearsal cadence: quarterly.
4. Runbook review: after each incident and at least quarterly.
