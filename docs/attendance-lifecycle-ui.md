# Automatic attendance lifecycle UI

An employee must be able to tell whether attendance is actually working without
opening a debug panel — and the app must never claim it is working when it is
not.

## One rule

Every state is derived from a **real signal**. A signal we do not have produces
an honest "cannot confirm" state, never an optimistic one.

That rule lives in one pure function,
`deriveAttendanceLifecycle()` (`src/lib/attendance/lifecycleState.ts`), so the
UI cannot drift from it.

## The states

| State | Shown when |
| --- | --- |
| `automatic_attendance_disabled` | Company switch is off |
| `permission_setup_required` | Foreground location not granted |
| `background_permission_missing` | Native supports background, OS denied it |
| `precise_location_unavailable` | OS reports coarse location |
| `monitoring_starts_at` | Assigned and healthy, window not yet open |
| `monitoring_active` | Everything healthy, window open, location unknown or onsite |
| `waiting_for_arrival` | Everything healthy, window open, **provably away** |
| `onsite_before_shift` | Arrived early; clock-in held until shift start |
| `clocked_in_automatically` | Today's record has a clock-in |
| `departure_pending` | Left the jobsite; grace period running |
| `clocked_out_automatically` | Today's record is closed |
| `no_assignment_today` | No assignment |
| `jobsite_missing_coordinates` | Assigned job has no verified address |
| `native_geofence_unavailable` | No native support, regions not registered, or no device credential |
| `offline_events_pending` | Queue has un-synced events |
| `automatic_attendance_degraded` | More than one blocking problem at once |
| `last_sync_failed` | Last sync attempt failed after the last success |

## "Waiting for arrival" is the state most likely to lie

Shown loosely it means *"we have no idea what is happening"*, which an employee
reads as *"the system is working and I simply haven't arrived yet"*. So it is
gated on three separate conditions, all of which must hold
(`canShowWaitingForArrival`):

1. monitoring is active,
2. geofencing is healthy (no blocking setup problem),
3. the employee is **provably outside** the geofence.

The third is `onsite === false` specifically. A null fix means we do not know
where they are, which is **not** the same as knowing they are away — that case
shows `monitoring_active` instead, which claims nothing about position.

## Precedence

1. The company switch.
2. **Today's record** — what actually happened outranks what we predict. A
   clock-in that already exists is reported even if permission was revoked
   afterwards; the shift still happened. The setup problem is listed underneath
   and `monitoringActive` is still false.
3. Blocking setup problems. One problem names itself; several mean the whole
   path is unreliable, so the state becomes `automatic_attendance_degraded` with
   the full list.
4. The monitoring window.
5. Position.

`monitoringActive` is a single derived boolean: window open **and** company
switch on **and** zero blocking issues. It is the guard behind the acceptance
criterion that the UI never claims monitoring is active when permissions,
coordinates, native registration, or credentials are missing.

## Manual clock in/out is a fallback

It is rendered **below** the status, under a "Manual fallback" heading, in
secondary styling — the automatic path is the product, and a prominent manual
button teaches employees to distrust it. When `manualFallbackRecommended` is
true (the company switch is off, or something blocking is broken) the copy
changes to actively point at it rather than hiding it.

Manual entries post the same event the automatic pipeline does, tagged
`source: "manual"`, so they are audited and deduplicated by the same
server-side guards.

## Managers: who is not set up

`GET /api/attendance/setup-health` (admin/pm only) reports employees whose
automatic attendance cannot record. One authoritative roster combines app
access, assignment/job verification, active server credential, and the latest
native report (Always authorization, Precise Location, Background App Refresh,
native service health, Keychain credential, and required/registered regions).
The same roster supplies both the configured count and warning list.

| Problem | Meaning |
| --- | --- |
| `no_assignment` | Not assigned to a job |
| `jobsite_unverified` | Assigned job has no verified address |
| `native_readiness_missing` | The phone has not submitted a definitive native setup report |
| `background_location_required` | iOS authorization is not Always |
| `precise_location_required` | Precise Location is disabled |
| `native_service_unhealthy` | Location Services, Background App Refresh, or native monitoring is unavailable |
| `device_not_enrolled` | No active device credential |
| `credential_expired` | Credential expired; the phone must re-enroll |
| `regions_not_registered` | A required assigned-job region is missing from the OS registration report |

A missing assignment is reported **alone** — every other check is moot without
one, and listing four consequences of the same cause is noise. With the company
switch off, nothing is reported: automatic attendance is not in use, so nothing
is broken. Setup does not become unhealthy merely because the app has stayed
closed for days; the report represents durable configuration, not an app-open
heartbeat.

The panel renders above the roster, because an employee whose phone cannot
report is otherwise invisible: they look exactly like someone who simply hasn't
arrived.

## Privacy

- The setup report carries **no coordinates, no distances, no location
  history** — only whether the pieces required to record attendance exist. A
  test asserts the payload contains no positional field, to stop one being
  added later.
- The employee card shows **discrete attendance facts only** (clocked in at,
  on site since, clocked out at). No position, no distance-to-jobsite, no
  movement trail.
- Employee-facing copy carries no internal vocabulary — no geofence, credential,
  confidence, or ingestion terms. A test enforces it.

## Not covered by this PR

- Manager corrections to attendance records (PR 15).
- **Physical-device verification (PR 16).** The states that depend on native
  signals — background permission, native registration, device credential —
  are wired to the real plugin APIs but have not been observed on a physical
  device, because the native plugins are not yet wired into the builds.
