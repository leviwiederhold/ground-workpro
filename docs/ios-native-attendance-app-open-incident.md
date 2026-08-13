# iOS automatic-attendance app-open incident

## Production evidence (August 10, 2026, America/New_York)

The reporting device was ready: Always authorization, Precise Location,
Background App Refresh, an active device credential, and matching assigned and
registered Shop arrival regions.

- At 7:47:20 AM EDT, iOS launched the process for Core Location, requested the
  monitored region state, observed `did_enter_region`, persisted the queue
  record, loaded the device credential, and attempted the native HTTP request.
- At 7:47:22 AM, the native arrival received HTTP `422` and remained queued.
- At 7:47:24 AM, the retry received a false HTTP `200` duplicate response and
  removed the record. No timecard/event was created.
- At 8:06:51 AM, the employee opened the app. At 8:06:57 AM, foreground
  reconciliation posted the same arrival with coordinates and the server
  accepted it, leading to the scheduled automatic clock-in.

This proves the app-open dependency was downstream of a working Core Location
callback. Opening the app supplied coordinates through foreground
reconciliation; it did not cause the original boundary crossing.

## Root cause

`evaluateJobsiteEvent` converted optional coordinates with `Number(value)` and
then checked `Number.isFinite`. In JavaScript, `Number(null) === 0`. A native
Core Location region callback is not guaranteed to include a fresh GPS sample,
so its explicit `null` values became `(0,0)`, looked grossly offsite, and were
rejected with `422`.

The event route also inserted the unique audit/idempotency row as `accepted`
before validation. The first rejected request therefore consumed the key; its
retry was answered as a successful duplicate even though no attendance mutation
had committed. Native code correctly deletes queued events on 2xx, so the
transition was lost.

## Correction

- Null/undefined coordinates are kept absent. A device-bearer Core Location
  transition may rely on the registered OS region boundary while the server
  still enforces identity, assignment, verified job, and schedule rules.
- Native iOS opportunistically attaches a recent accurate location sample.
- Ingest claims begin as `processing` and store the final response status and
  reason. Concurrent duplicates return `409`; failed outcomes replay their real
  status; stale interrupted claims are recovered with a compare-and-swap.
- Access credentials now have a native refresh path, legacy devices can upgrade
  headlessly while their access bearer is still valid, and monitoring-plan sync
  can run with the device bearer before WebView startup.
- Desired regions persist natively, stay installed overnight, and self-heal on
  cold launch, significant movement, authorization restoration, and region
  callbacks.

Android implementation work remains isolated in PR #91 and is not part of this
change.
