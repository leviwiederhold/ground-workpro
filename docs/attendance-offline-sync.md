# Offline attendance synchronization

Attendance events are generated in the worst possible conditions: a jobsite with
no signal, a phone that gets killed, a device that reboots. An event created at
6:50 AM must still arrive as a **6:50 AM** event, exactly once, whenever the
network comes back.

PR 9 added the queue scaffolding. This finishes and hardens it.

## The pieces

| Piece | File | Responsibility |
| --- | --- | --- |
| Pure core | `src/lib/attendance/offlineQueue.ts` | Identity, classification, backoff, ordering, quarantine, diagnostics |
| Durable store | `src/lib/attendance/offlineQueueStorage.ts` | Native file store → localStorage fallback, schema migration |
| Flushing manager | `src/lib/attendance/offlineQueueClient.ts` | Triggers, submission, credential refresh, diagnostics |
| Native store (iOS) | `ios/App/App/AttendanceQueueStorePlugin.swift` | App-container file, atomic writes, data protection |
| Native store (Android) | `android/…/AttendanceQueueStorePlugin.kt` | App-private internal storage, write-then-rename |

## What is preserved

Every queued event carries what the server needs to reconstruct it later, and
none of it is ever rewritten at flush time:

`eventId`, `jobId`, `assignmentId`, `deviceId`, `zone`, `transition`,
**`occurredAt`** (the original), `latitude`, `longitude`, `accuracyMeters`,
`source`, plus queue bookkeeping (`attempts`, `queuedAt`, `nextAttemptAt`,
`state`, `lastError`, `lastAttemptAt`).

The one that matters most is `occurredAt`. A departure that happened at 2:00 PM
and syncs at 6:00 PM is submitted as a 2:00 PM departure, so the timecard is
identical whether the phone had signal or not.

## Where the queue lives

localStorage inside a WKWebView/WebView is **evictable**: iOS can clear web data
under storage pressure, and an Android "clear cache" wipes it. A queue that
survives being offline but not being backgrounded for two days is not durable.

So the queue is written natively when the `AttendanceQueueStore` plugin is
present — an Application Support file with
`.completeUntilFirstUserAuthentication` protection on iOS (readable by the
background geofence handler after a reboot, before unlock), app-private internal
storage on Android — and to localStorage as a mirror for synchronous
diagnostics. Both platforms write atomically (temp file + rename) so a kill
mid-write cannot leave a truncated queue.

Reads try native first and **fall back to localStorage when native is absent or
empty**, so an app that gains the plugin in an update inherits whatever the
previous build had queued.

The queue holds no secrets — the attendance credential lives in the
Keychain/Keystore via `SecureAttendanceStore` — so this is about durability, not
secrecy.

## Retry policy

| Trigger | When |
| --- | --- |
| App launch | `startAttendanceQueueAutoFlush()` flushes immediately |
| Connectivity recovery | `online` event |
| Returning to foreground | `visibilitychange` + Capacitor `resume` |
| Controlled interval | Every 60 s as a backstop |

Backoff is exponential from **30 s**, doubling, capped at **30 min**. After
**12 attempts** (~6 hours of continuous failure) an event is *quarantined*.

## Retryable vs. permanent

Retrying a validation failure forever accomplishes nothing and hides the
problem; dropping a retryable failure silently loses attendance. So failures are
classified:

| Class | Statuses | Behavior |
| --- | --- | --- |
| `retryable` | transport error, 5xx, 429, 408 | Backoff, retry, counts toward the ceiling |
| `auth` | 401 | Re-enroll the credential once per flush, retry — **does not** consume the retry budget |
| `permanent` | 400, 403, 404, 422 | Quarantined immediately |

The `auth` carve-out matters: a credential that expires overnight would
otherwise quarantine a whole day of attendance before anyone could refresh it.

Quarantined events are **kept** (for 14 days) and reported in diagnostics, not
silently deleted — a real delivery problem must be visible.

## Ordering

Order matters *within* a job: an exit must never reach the server before the
enter that opened the shift, or it would find no open timecard. So each pass
submits only the **oldest pending event per job**; the next goes out once its
predecessor is delivered. Different jobs are independent and never block each
other.

A quarantined event is excluded from ordering entirely — it will never be
delivered, so blocking its job's queue behind it would stall that job forever.

## Idempotency

Retries are safe at every layer, all keyed off the same
`(job, zone, transition, minute)` dimension:

1. **Queue** — the stable `eventId` collapses duplicate native deliveries before
   the network is touched.
2. **Ingest** — `attendance_event_audit.idempotency_key` (PR 10) rejects a
   duplicate at the edge with a 2xx, which the queue treats as delivered.
3. **Write** — the guarded `.is("clock_in_at", null)` / `.is("clock_out_at",
   null)` updates (PRs 11–12) mean the second writer changes nothing.

## Diagnostics

Surfaced in the attendance diagnostics panel: pending count, quarantined count,
oldest queued event (by when it *happened*), next retry time, last successful
sync, last failure time and reason, and whether the durable native store is
actually backing the queue.

## Native status

⚠️ **The native store plugins are reference implementations. They are not wired
into the Xcode/Gradle builds and have not been compiled or run on a physical
device.** Until that is done, the queue falls back to localStorage and
durability across a device restart is **not proven** — see PR 16.

Remaining steps:

- [ ] Register `AttendanceQueueStorePlugin` in the iOS project and Android
      `MainActivity`.
- [ ] Point the native geofence handlers at the same file, so background
      transitions queued while offline share one queue (and one reported depth).
- [ ] Verify on a physical iPhone and Android: queue offline, force-quit,
      reboot, restore connectivity, confirm the events arrive with their
      original timestamps and produce no duplicates.

## Not covered by this PR

- Employee/manager UI for offline/degraded states (PR 14) — the diagnostics
  fields are the data source it will consume.
- Manager corrections (PR 15).
- Physical-device validation (PR 16).
