# Attendance audit trail and manager corrections

Attendance drives payroll, so two questions must be answerable months later:

1. **What did the system actually observe?** — and nobody may rewrite the answer.
2. **If a human changed it, who, when, why, and from what?**

## Immutability is structural, not a convention

`jobsite_timecard_events` and `attendance_corrections` both carry `BEFORE UPDATE`
and `BEFORE DELETE` triggers that raise. Not RLS, not application discipline — a
trigger, so it holds against every writer including the service-role client the
attendance runners use and including this app's own code.

```
ERROR: jobsite_timecard_events is append-only: UPDATE is not permitted.
       Record a correction instead.
```

A correction that was itself wrong is superseded by **another** correction,
never edited away.

## Provenance on every event

`source` (manual / jobsite_auto / manager_adjusted) was too coarse to answer
*"did this come from the phone in the background, or from a page load?"* — which
is exactly the question when an employee disputes a shift. Every event now
carries `event_source`:

| Source | Meaning |
| --- | --- |
| `native_geofence` | OS geofence transition, app backgrounded or closed |
| `foreground_reconciliation` | The app was open and repaired the state |
| `scheduled_reconciliation` | The server-side scheduled pass (PRs 11–12) |
| `offline_sync` | Flushed from the device's offline queue (PR 13) |
| `employee_manual` | The employee's manual fallback |
| `manager_correction` | A manager changed the record |

Plus:

- **`device_reported_at`** — when the device says it happened.
- **`server_received_at`** — when the server received it.
- **`validation_result`** (`accepted` / `rejected` / `ignored` / `suppressed`)
  and **`validation_reason`** — what the ingest pipeline decided and why.

The gap between the two timestamps **is** the offline-queue delay. Storing both
is what makes it visible; the UI surfaces it when it exceeds two minutes.

Server-side passes write `device_reported_at = null` rather than echoing the
server time — no device reported them, and pretending otherwise would fabricate
provenance. Existing rows are backfilled from `source`, which is as precise as
they can honestly be.

## Corrections

| Type | Requires |
| --- | --- |
| `missing_clock_in` | A clock-in time |
| `missing_clock_out` | A clock-out time |
| `incorrect_job` | The correct job (validated to belong to the company) |
| `incorrect_timestamp` | At least one corrected time |
| `duplicate_record` | Nothing — voids the record |
| `invalid_record` | Nothing — voids the record |

The per-type requirements are not bureaucracy: a correction labelled "missing
clock-out" that changed the job would be a lie in the history.

### A reason is mandatory

At least 10 characters, enforced in **both** the API and a database `CHECK`
constraint, so a direct write cannot bypass it. A correction with no explanation
is indistinguishable from tampering when read back a year later.

### The original is never destroyed

Each correction row stores `original_values` and `new_values` as JSON, capturing
**only the fields that correction touched**. That is what makes a chain of
corrections replayable — each row says what it changed and what it changed it
from. `reconstructOriginal()` rewinds the chain to show what the automatic
system originally recorded, beside the corrected value.

Voiding types (`duplicate_record`, `invalid_record`) set the status to
`rejected` and rewrite **no timestamp**: the trail must still show what the
system observed.

A corrected `needs_review` record moves to `pending_review` — a human just
looked at it — but is never auto-approved. Approval stays a separate, explicit
act.

### No-op corrections are refused

Recording one would put a row in the permanent history claiming a change that
never happened.

### Write order

The correction row is written **before** the timecard update. If the update then
fails, the result is a recorded intent against an unchanged record — recoverable
and visible. The reverse order could silently change payroll with no trail.

## Authorization

Correcting attendance requires `admin` or `pm`, enforced server-side against the
**effective** role. This is deliberately narrower than `canManageTimecards()`,
which also admits foreman/executive/operations: reading a roster and rewriting
payroll are not the same privilege.

Employees can **read** the corrections on their own timecards — someone whose
hours were changed is entitled to see who changed them and why — but the
`attendance_corrections` RLS policy grants `SELECT` only. There is deliberately
no insert/update/delete policy for authenticated users.

## What the manager sees

The timecard drawer shows three distinct things, in this order:

1. **The effective record** — what payroll uses.
2. **Corrections** — each with its field-level diff (`from → to`), the reason,
   who, and when; followed by "Originally recorded: …" reconstructed from the
   chain.
3. **The original event trail** — append-only, labelled with provenance and
   sync delay, explicitly captioned as never modified by a correction.

## Not covered by this PR

- End-to-end validation (PR 16).
- **No physical-device verification.** The `native_geofence` and `offline_sync`
  provenance values are written by code paths that have not been exercised on a
  device, because the native plugins are not yet wired into the builds.
