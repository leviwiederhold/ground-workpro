# Attendance stack — deployment checklist

Status of the five deployment items raised against PRs #68 and #70–#75.

| # | Item | Status |
| --- | --- | --- |
| 1 | Vercel Pro or an external scheduler | **RESOLVED** — Hobby, so the scheduler runs from Supabase pg_cron |
| 2 | Will PR 11 ever deploy alone? | **RESOLVED** — keep 11 and 12 stacked |
| 3 | Append-only triggers on staging | **NOT RUN** — needs a staging database |
| 4 | Nothing updates/deletes `jobsite_timecard_events` | **VERIFIED CLEAN** (with one finding) |
| 5 | Arrival dwell 2 min / departure grace 10 min | **CONFIRMED** — both kept |

---

## 1. Scheduler — resolved: Supabase pg_cron

Production is on **Vercel Hobby**, which caps cron frequency at once per day.
A daily run makes clock-in timing meaningless, so the Vercel cron has been
**removed from `vercel.json`** and the scheduler runs from the database.

pg_cron is the better home for it regardless of plan: it sits beside the data,
fires on time, and does not depend on the hosting tier. (GitHub Actions `schedule:`
was considered and rejected — it is best-effort and routinely runs 5–15 minutes
late, which is exactly the error budget a clock-in does not have.)

### Setup

1. Set `ATTENDANCE_SCHEDULER_SECRET` in the Vercel project (any long random
   string: `openssl rand -hex 32`).
2. Run [`scripts/setup-attendance-scheduler.sql`](../scripts/setup-attendance-scheduler.sql)
   in the Supabase SQL editor, replacing the endpoint and the secret. It
   installs `pg_cron` + `pg_net`, stores the endpoint and secret in a
   service-role-only table (so the secret is not visible in `cron.job.command`),
   and schedules `/api/attendance/reconcile` every minute.

`CRON_SECRET` is not needed on this path — that variable only authenticates
Vercel's own cron.

### Verify after deploy

A green pg_cron run only proves the request was *dispatched*. The one that
matters is whether the app received it:

```sql
select started_at, finished_at, trigger, candidates, clocked_in, clocked_out, error
from attendance_scheduler_runs
order by started_at desc
limit 20;
```

Expect roughly one row per minute with `trigger = 'scheduler_secret'`. **Gaps
are missed clock-ins**, and nothing else in the system will report them — this
query is the monitoring.

## 2. PR 11 deploying alone — resolved

**Decision: PRs 11 and 12 stay stacked and merge together.**

PR 12 renames `/api/attendance/scheduled-clock-in` → `/api/attendance/reconcile`
and updates `vercel.json` to match. If PR 11 shipped alone and PR 12 followed
later, there would be a window where the deployed cron path and the deployed
route disagreed — and the symptom would be silence, not an error: no clock-ins,
no alert, nothing in the logs except a 404 nobody is watching.

Merging them together makes that window impossible. There is no scenario where
shipping arrival-without-departure is desirable anyway: it would clock people in
and never clock them out.

---

## 3. Append-only triggers — must be tested on staging

**Not run.** This needs a live Postgres; the unit suite cannot exercise a
database trigger.

Apply the four attendance migrations to staging, then run:

```sql
-- Both of these MUST fail.
update public.jobsite_timecard_events set notes = 'tampered' where id = (
  select id from public.jobsite_timecard_events limit 1
);
-- expected: ERROR ... jobsite_timecard_events is append-only: UPDATE is not permitted.

delete from public.jobsite_timecard_events where id = (
  select id from public.jobsite_timecard_events limit 1
);
-- expected: ERROR ... jobsite_timecard_events is append-only: DELETE is not permitted.

-- And the same for corrections.
update public.attendance_corrections set reason = 'x' where id = (
  select id from public.attendance_corrections limit 1
);
-- expected: ERROR ... attendance_corrections is append-only.
```

Then confirm the normal paths still work: submit an attendance event, run the
reconcile endpoint, record a correction.

### Finding: the triggers also block timecard deletion

`jobsite_timecard_events.timecard_id` is `ON DELETE CASCADE`. A cascade issues a
real `DELETE` against the child table, which now fires the append-only trigger
and raises — so **deleting a `jobsite_timecards` row fails whenever it has
events.**

That is arguably correct (a payroll record with an audit trail should not be
hard-deleted), and no application code deletes timecards — see item 4. But it
is a behavior change, and any manual cleanup script or admin tool that deletes
timecards will now fail loudly. Decide deliberately whether to keep it.

Company deletion still works: `companies → jobsite_timecards` cascades, but the
same trigger will block it once events exist. **If tenant deletion is a
supported operation, test it on staging** — it may need the triggers
temporarily disabled inside the teardown transaction.

---

## 4. Nothing updates or deletes the event trail — verified clean

Audited every access to the two append-only tables:

| Table | insert | select | update | delete |
| --- | --- | --- | --- | --- |
| `jobsite_timecard_events` | 10 | 3 | **0** | **0** |
| `attendance_corrections` | 1 | 1 | **0** | **0** |

No code path deletes `jobsite_timecards` either, so the cascade described above
is not reachable from the application.

---

## 5. Resolved defaults — confirmed

Both kept. Confirmed as matching intended product behavior.

| Setting | Was | Now | Effect |
| --- | --- | --- | --- |
| Arrival dwell | 45 s | **2 min** | An employee must stay inside the radius for 2 minutes before arrival counts. Fewer false clock-ins from driving past. Early arrivals are unaffected (they are held until scheduled start anyway); this only shifts the clock-in for someone arriving *after* their shift began. |
| Departure grace | 5 min | **10 min** | An employee must be outside the radius for 10 minutes before clocking out. Fewer wrong clock-outs from stepping to a truck or a GPS wobble. **Costs no paid time** — the clock-out is always recorded at the original exit; this only delays when the record closes. |

Both are single-column changes (`attendance_arrival_dwell_minutes`,
`attendance_departure_grace_minutes`) if a company needs different values.

## Merge gate

The attendance stack (#68, #70–#75) stays blocked until **all** of:

- [x] PR 17 complete — native plugins wired into both builds
- [x] iOS compiles with the attendance plugins in the target
- [x] Android compiles with the Kotlin sources included
- [ ] Physical iPhone arrival and departure verified
      ([test plan](./attendance-device-test-plan.md))
- [ ] Physical Android arrival and departure verified
- [ ] pg_cron scheduler running and `attendance_scheduler_runs` filling (item 1)
- [ ] Migrations run cleanly on staging, triggers verified (item 3)
- [x] Defaults confirmed (item 5)
