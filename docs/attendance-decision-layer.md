# The attendance decision layer

Attendance drives payroll, so there is exactly one place each decision is made.
HTTP routes authenticate, validate, load rows, and serialize answers. They do not
decide anything.

## Design principles

The contract. A change that breaks one of these is a change to the product, not
a refactor, and needs to be argued as such.

1. **Native plugins detect events only.** They emit enter/exit transitions with
   coordinates and a timestamp. No payroll logic, no attendance decisions, no UI.
2. **Routes authenticate and validate only.** Identity, rate limits,
   idempotency, schema, tenancy, and loading the rows a decision needs. If you
   are writing an `if` about arrivals, departures, or transfers in a route, it
   belongs in the decision layer.
3. **Decision functions are pure.** No database, no clock, no HTTP. They take a
   snapshot and return effects. This is what makes the rules testable without a
   device, and what lets the foreground pass and the scheduled process reach the
   same answer.
4. **Runner functions perform all writes.** Every row written to
   `jobsite_timecards` comes from a runner applying a decision. There is no
   other writer.
5. **Attendance corrections are the only way to modify recorded hours.** A
   correction carries a reason, an original-values snapshot, and an immutable
   row. No endpoint may offer a shortcut around it — that includes voiding a
   record, which changes what someone is paid.
6. **Manual attendance exists only when automatic attendance cannot operate.**
   Not as a convenience, not as a shortcut, not as a power-user affordance.

### On principle 6 specifically

The product is that an employee grants location once and never thinks about
attendance again. Every button that says "Quick Clock In", "Override Clock In",
"Emergency Clock In", or "Temporary Clock In" is a step back toward an app that
asks employees to press things — and each one arrives with a reasonable-sounding
local justification.

The rule is not "manual attendance should be de-emphasized". It is:

> **If automatic attendance is healthy, there is no manual attendance UI.**

The only permitted condition for rendering a manual control is
`manualFallbackAvailable && manualFallbackRecommended`, which means the company
allows manual entry *and* the automatic path genuinely cannot record right now.
`tests/unit/attendance-manual-fallback-guard.test.ts` fails if a manual control
is rendered outside that branch. If that test is in your way, the change you are
making is the thing it exists to stop.

## The layer

| Module | Decides |
| --- | --- |
| `decideGeofenceEvent()` — `src/lib/attendance/geofenceEvent.ts` | what a geofence transition does to the record: open a session, resolve a transfer, cancel or begin a departure |
| `decideArrivalClockIn()` — `src/lib/attendance/scheduledClockIn.ts` | whether a pending arrival has matured into a clock-in |
| `decideClockOut()` — `src/lib/attendance/departure.ts` | whether a pending departure has matured into a clock-out |

All three are pure. They take a snapshot and return effects; none of them touch
the database, the clock, or HTTP.

Three appliers perform the writes, and they are the only code that writes
attendance:

- `applyGeofenceDecision()` — `src/lib/attendance/geofenceEventRunner.ts`
- `applyClockInDecision()` — `src/lib/attendance/scheduledClockInRunner.ts`
- `applyClockOutDecision()` — `src/lib/attendance/departureRunner.ts`

`finalizePendingAttendance()` composes the second and third so the foreground
pass and the scheduled process cannot race each other into duplicate records.

## What happens on ENTER

`POST /api/jobsite-time/events` with `transition: "enter"`:

1. `verifyAttendanceCredential()` — device credential, or the session cookie.
2. `bodySchema.safeParse()` — shape.
3. `enforceRateLimit()`, `validateEventTimestamp()`, `buildIdempotencyKey()` —
   background path only. A duplicate native delivery stops here.
4. `mapCompanyJobsiteSettings()`, `resolveCompanyWorkSchedule()`,
   `mapRowToAttendanceSettings()` — company settings.
5. Job lookup — must belong to the company; must have a verified address for
   automatic events.
6. Employee + `job_employees` assignment lookup — an unassigned job is ignored.
7. `finalizePendingAttendance()` — matures anything already due.
8. `buildCompanyScheduleWindow()` + `schedule_assignments` — the work date and
   the scheduled window.
9. `evaluateJobsiteEvent()` — recomputes distance from the job's own
   coordinates, applies the arrival radius and the schedule window, and returns
   confidence / needsReview / arrivalStatus.
10. Load today's record for this job, and any records still open at other jobs.
11. **`decideGeofenceEvent()`** — the only place the outcome is decided.
12. **`applyGeofenceDecision()`** — transfers first, then this job's record,
    then the audit rows.

The first row is written in step 12. Steps 1–11 write nothing to
`jobsite_timecards`.

## What happens on EXIT

Identical through step 10, except step 10 does not load other jobs' records —
only an arrival can resolve those. Then the same `decideGeofenceEvent()` and
`applyGeofenceDecision()`.

An exit with no open record writes no timecard row at all; it writes one
`clock_out_rejected` audit row, so a device emitting exits for someone who was
never clocked in is visible rather than silently dropped.

## Corrections

Recorded hours change through exactly one path: `POST /api/attendance/corrections`.
It requires a reason of at least 10 characters (enforced in the API *and* a
database `CHECK`), writes an `attendance_corrections` row before touching the
timecard, and captures the original values so the chain stays replayable.

`PATCH /api/jobsite-time/timecards/[id]` deliberately **cannot** change
`clock_in_at`, `clock_out_at`, the break timestamps, or the job, and cannot void
a record. It returns 422 pointing at the corrections endpoint. It handles
approval, notes, and workflow status only.

The privileges differ: approving is open to `canManageTimecards()` (which
includes foreman, executive, and operations); correcting is `admin`/`pm` only.

## Manual fallback

Automatic attendance is the product. Manual controls are not shown during a
normal workday — they appear only when `manualFallbackRecommended` is true,
which means the automatic path genuinely cannot record: permission missing,
native geofencing unavailable, an unsupported runtime, an unverified jobsite
address, or the company switch turned off.

`decideGeofenceEvent()` never applies the validation gates to a manual event, for
the same reason: manual exists to cover the conditions that make validation fail.

## Known duplication

`reconcileAttendanceState()` in `src/lib/jobsite-time/reconcileAttendance.ts`
independently evaluates onsite / before-shift / early-arrival and returns its own
7-value `AttendanceStatus`. It writes nothing — it returns `shouldCreateClockIn`
and the caller posts to `/api/jobsite-time/events`, so every record still goes
through the decision layer above. The exposure is rule drift, not a second write
path. Merging it into `decideArrivalClockIn()` is tracked separately. Until then,
a rule change in one must be made in both.

## Row-level security

`jobsite_timecards` and `jobsite_timecard_events` currently carry
`for all to authenticated` policies scoped by company with no role predicate, so
the database itself does not enforce that writes come from this layer. Tightening
that is tracked as its own change.
