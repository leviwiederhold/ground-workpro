# Automatic departure and clock-out

The mirror of [scheduled clock-in](./attendance-scheduled-clock-in.md). A
geofence exit does **not** clock anyone out — it opens a *departure pending*
state, and only staying away for the whole grace period confirms it.

## The pieces

| Piece | File | Responsibility |
| --- | --- | --- |
| Exit detection | native geofence → `POST /api/jobsite-time/events` | Sets `pending_departure_at`, logs `departure_pending` |
| Decision engine (pure) | `src/lib/attendance/departure.ts` | Clock out / hold / cancel / skip |
| DB pass | `src/lib/attendance/departureRunner.ts` | Applies decisions, writes audit events |
| Scheduled process | `GET/POST /api/attendance/reconcile` | Runs arrivals then departures every minute |
| Monitoring plan | `src/lib/attendance/monitoringPlan.ts` + `GET /api/attendance/monitoring-plan` | What to monitor now, and when the next window opens |
| Foreground fallback | `src/lib/jobsite-time/finalizeAttendance.ts` | Same engines, run opportunistically |

The grace period **cannot** be enforced by a timer on the phone: with the app
closed nothing in the WebView runs. The server-side pass is the mechanism.

## Timeline

| Time | What happens | Record state |
| --- | --- | --- |
| 2:00 PM | Geofence exit | `pending_departure_at = 2:00`, `departure_pending` audit event |
| 2:00–2:10 | Cron passes; decision is `hold` | Unchanged — a brief exit is not a departure |
| 2:04 (alt) | Employee returns | `pending_departure_at` cleared, `departure_cancelled` audit event. **Shift continues** |
| 2:11 | Grace elapsed | `clock_out_at = 2:00` (**not** 2:11), `clock_out_method = departure_grace`, `auto_clock_out` + `monitoring_stopped` audit events |

The clock-out is recorded at the **original validated departure time**, so a
delayed, offline, or duplicated confirmation produces the identical timecard.
Total minutes are computed against that time, so processing delay can never
inflate paid hours.

## Grace period

`companies.attendance_departure_grace_minutes` (default 10). Where the older
`jobsite_departure_grace_minutes` also has a value, the **longer** of the two
wins — the conservative direction, since a longer grace means fewer employees
wrongly clocked out for stepping off site.

Out-of-order events are handled by timestamp, not arrival order:

- A re-entry only cancels a departure if the **re-entry's own timestamp** falls
  inside the grace window. A late-flushed re-entry cannot resurrect a shift
  whose departure was already confirmed.
- The **earliest** observed exit anchors `pending_departure_at`. An offline
  queue flushing out of order can move a departure earlier (to when it actually
  happened) but never later.

## Missed exit events

If no exit ever arrives — app killed, permission revoked, dead battery, native
event dropped — the shift would otherwise run forever. Past
`attendance_end_of_day_cutoff_minutes` (default 180) after the scheduled end,
end-of-day reconciliation closes it at the **scheduled end** and marks it
`needs_review` with a `fallback_clock_out` audit event. `detected_departure_at`
is deliberately left null: nothing was detected, and a guessed boundary must
never look like an observed one.

Setting the cutoff to `0` disables the fallback. With no scheduled end there is
no defensible boundary, so nothing is closed and the record is left for a
manager.

The fallback runs **only** in the scheduled process, never in the opportunistic
foreground pass — closing a shift is not something an incidental page load
should do.

## Monitoring lifecycle

`GET /api/attendance/monitoring-plan` returns the regions the device should
have registered right now, plus why not and what is next when it should have
none.

- Monitoring **stops** for a workday once it is clocked out (`resolved`). The
  plan returns an empty region set, which is the instruction to deregister.
  Otherwise the regions stay live and re-trigger arrivals for a finished shift.
- The **next** scheduled workday still reports its window start, so tomorrow
  activates normally without the app being opened.
- `inactiveReason` distinguishes `no_job`, `no_schedule`, `before_window`,
  `day_resolved`, and `after_window`, so the UI (PR 14) can say something true
  instead of "waiting for arrival".

## Audit events

| Event | Meaning |
| --- | --- |
| `exited_geofence` | The raw exit was received (unchanged) |
| `departure_pending` | Grace period started. Logged once, on the first exit |
| `departure_cancelled` | Employee returned during the grace period |
| `auto_clock_out` | Departure confirmed; clock-out at the original exit time |
| `fallback_clock_out` | No exit ever arrived; closed at the scheduled end |
| `clock_out_rejected` | Exit event with no open timecard to close |
| `monitoring_stopped` | Workday resolved; monitoring ended for the assignment |

## Route rename

`/api/attendance/scheduled-clock-in` (PR 11) is renamed to
`/api/attendance/reconcile` — one cron now runs both halves. Arrivals run
first, so an employee who arrives and departs inside a single tick is clocked
in before the departure pass considers them. `vercel.json` is updated to match;
**update the cron path if PR 11 was already deployed.**

## Not covered by this PR

- Offline queue durability and retry policy (PR 13).
- Employee/manager UI for these states (PR 14) — the monitoring-plan endpoint
  is the data source it will consume.
- Manager corrections (PR 15).
- **Physical-device verification (PR 16). Nothing in this PR has been compiled
  or run on a physical iPhone or Android device.**
