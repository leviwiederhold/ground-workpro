# Automatic arrival and scheduled clock-in

How an employee who arrives at 6:50 AM for a 7:00 AM shift gets clocked in at
7:00 AM **with the app closed**.

## The pieces

| Piece | File | Responsibility |
| --- | --- | --- |
| Arrival detection | native geofence (PR 9) → `POST /api/jobsite-time/events` | Records the arrival at 6:50 and sets `pending_arrival_at` |
| Decision engine (pure) | `src/lib/attendance/scheduledClockIn.ts` | Decides clock in / hold / refuse. One implementation, four callers |
| DB pass | `src/lib/attendance/scheduledClockInRunner.ts` | Loads candidates + settings, applies decisions, writes audit events |
| Scheduled process | `GET/POST /api/attendance/reconcile` | Runs the pass every minute via Vercel Cron |
| Foreground fallback | `src/lib/jobsite-time/finalizeAttendance.ts` | Same engine, run opportunistically when a request happens to arrive |

The scheduled process is the **mechanism**, not an optimization. Nothing here
relies on a WebView timer, on the app being foregrounded, or on the phone
staying awake — with the app closed, the only thing that runs is the cron.

## Timeline (the acceptance scenario)

| Time | What happens | Record state |
| --- | --- | --- |
| 5:00 | Monitoring window opens (`monitoringLeadMinutes`, default 120) | — |
| 6:50 | Native geofence enter → events route | Timecard created, `pending_arrival_at = 6:50`, `arrival_status = early`, `entered_geofence` audit event |
| 6:52 | Arrival dwell elapses; cron pass runs | `onsite_before_shift_at = 6:50`, `onsite_before_shift` audit event. **No clock-in** |
| 6:53–6:59 | Cron keeps running; decision is `hold` | Unchanged (the stamp is written once) |
| 7:00 | Cron pass runs | `clock_in_at = 7:00`, `clock_in_method = scheduled_start`, `pending_arrival_at = null`, `scheduled_clock_in` audit event |
| 7:05 | Employee opens the app; foreground reconciliation runs | Decision is `skip: already_clocked_in`. **No duplicate** |

If the employee instead leaves at 6:55, the exit clears `pending_arrival_at`,
the decision becomes `skip: no_arrival_evidence`, and no clock-in is ever
created.

## `earlyArrivalMode`

Company setting (`companies.attendance_early_arrival_mode`), default
`scheduled_start`.

- **`scheduled_start`** — arrival is recorded at 6:50 and the employee is shown
  as onsite before shift; the clock-in is created at 7:00 by the scheduled
  process. Early arrival is never paid time.
- **`clock_in_on_arrival`** — the clock-in is created at the confirmed arrival
  (6:50). The scheduled process still handles it, so it also works with the app
  closed.

When the company has no configured work hours and the employee has no shift
assignment for that day, there is no scheduled start to hold for, and the
clock-in is created at the arrival under either mode. Such a timecard is already
flagged `needs_review` by `evaluateJobsiteEvent`.

## Backfill

If the scheduled process is delayed (a failed run, a deploy, a platform
incident), the clock-in is still written **at the correct scheduled start**, not
at the time the run eventually happened, provided the arrival evidence shows the
employee was onsite and never left. The run is capped at
`DEFAULT_MAX_BACKFILL_MINUTES` (12 hours) so an outage cannot resurrect an
arrival from a previous day.

A backfilled clock-in gets `clock_in_method = scheduled_start_backfilled` and an
extra `clock_in_backfilled` audit event recording when it was actually
processed.

## Duplicate prevention

Four independent paths can try to create the same clock-in: a native event, the
foreground reconciliation, the scheduled process, and an offline-queue retry.
Three layers stop a duplicate:

1. **One engine.** All four call `decideArrivalClockIn()`, which returns
   `skip: already_clocked_in` whenever `clock_in_at` is set.
2. **Guarded write.** Every clock-in update carries `.is("clock_in_at", null)`,
   so a lost race updates zero rows — the loser logs `duplicate_suppressed` and
   writes nothing.
3. **Database constraints.** A partial unique index allows at most one *open*
   timecard per `(company, user, job, work_date)`, and at most one
   `scheduled_clock_in` audit row per timecard.

The token ingest path additionally dedupes at the edge via
`attendance_event_audit.idempotency_key` (PR 10).

## Timezone and DST

All shift boundaries are resolved from the company timezone
(`companies.timezone`), never the server's. `scheduledWindowForWorkDate()`
resolves the configured local wall-clock time (e.g. `07:00`) to a UTC instant
*per work date*, iterating until the rendered local time matches — so on a
daylight-saving transition day, 07:00 local resolves to a different UTC instant
than the day before, and the clock-in still lands at 7:00 local.

## Conflicting jobs

A clock-in is refused when the employee already has an open clock-in at a
*different* job (`skip: clocked_in_elsewhere`, audit event
`clock_in_rejected`). A card that is already `pending_departure_at` does **not**
block — that is the ordinary "moved from job A to job B" case, where job A is
resolving and job B's clock-in is correct.

## Audit events

Added to `jobsite_timecard_events.event_type`:

| Event | Meaning |
| --- | --- |
| `onsite_before_shift` | Confirmed onsite before the scheduled start; clock-in held |
| `scheduled_clock_in` | Clock-in created at the scheduled start |
| `clock_in_backfilled` | Scheduled processing ran late; clock-in backdated |
| `clock_in_rejected` | Clock-in refused, with the reason in `notes` |
| `duplicate_suppressed` | A concurrent writer had already applied the clock-in |

Existing types are unchanged: `entered_geofence` still records the arrival, and
`auto_clock_in` still records a clock-in created at the arrival itself.

Each scheduled run is also recorded in `attendance_scheduler_runs` (start,
finish, trigger, counters, error) so a missed or slow run is visible after the
fact.

## Deployment

| Requirement | Value |
| --- | --- |
| Migration | `supabase/migrations/20260721_01_attendance_scheduled_clock_in.sql` |
| Cron | `vercel.json` → `/api/attendance/reconcile`, `* * * * *` |
| Required env | `SUPABASE_SERVICE_ROLE_KEY` (already required) |
| Optional env | `CRON_SECRET` — set it; without it the cron route falls through to admin-session auth and Vercel Cron requests are rejected |
| Optional env | `ATTENDANCE_SCHEDULER_SECRET` — for an external scheduler posting `x-attendance-scheduler-secret` |

**Minute-granularity crons require a Vercel Pro plan or above.** On Hobby, cron
frequency is limited to once per day, which is not sufficient for clock-in
accuracy; use `ATTENDANCE_SCHEDULER_SECRET` with an external scheduler
(GitHub Actions, Supabase `pg_cron` + `net.http_post`, Upstash QStash) instead.

Auth on the route, in order: Vercel Cron bearer (`CRON_SECRET`) → scheduler
secret header → an authenticated `admin`/`pm` session. The session path is
scoped to that user's own company; only the two machine paths sweep all
companies.

## Not covered by this PR

- Automatic **departure**/clock-out and the departure grace period — see
  [attendance-departure-clock-out.md](./attendance-departure-clock-out.md).
- Offline queue durability and retry policy (PR 13).
- Employee/manager UI for these states (PR 14).
- Physical-device background verification (PR 16). **Nothing in this PR has been
  verified on a physical iPhone or Android device.**
