# Attendance stack — deployment checklist

Status of the five deployment items raised against PRs #68 and #70–#75.

| # | Item | Status |
| --- | --- | --- |
| 1 | Vercel Pro or an external scheduler | **NEEDS A DECISION** — account fact I cannot read |
| 2 | Will PR 11 ever deploy alone? | **RESOLVED** — keep 11 and 12 stacked |
| 3 | Append-only triggers on staging | **NOT RUN** — needs a staging database |
| 4 | Nothing updates/deletes `jobsite_timecard_events` | **VERIFIED CLEAN** (with one finding) |
| 5 | Arrival dwell 2 min / departure grace 10 min | **NEEDS PRODUCT CONFIRMATION** |

---

## 1. Scheduler — needs a decision

`vercel.json` registers `/api/attendance/reconcile` at `* * * * *`. **Minute
granularity requires Vercel Pro or above.** On Hobby, cron frequency is capped
at once per day, which is useless for clock-in accuracy — a 7:00 AM shift would
be clocked in whenever the daily run happened to fire.

**If production is on Pro:** set `CRON_SECRET` in the Vercel project. Without
it, the route falls through to admin-session auth and rejects every cron
request — the scheduler would appear configured and do nothing.

**If production is not on Pro:** delete the `crons` block from `vercel.json`,
set `ATTENDANCE_SCHEDULER_SECRET`, and drive the endpoint externally every
minute:

```bash
curl -fsS -X POST https://<host>/api/attendance/reconcile \
  -H "x-attendance-scheduler-secret: $ATTENDANCE_SCHEDULER_SECRET"
```

Any of GitHub Actions (`schedule:` is best-effort and often runs late — not
recommended for this), Supabase `pg_cron` + `net.http_post` (recommended: it
lives beside the database and fires reliably), or Upstash QStash.

**Verify it is actually running** after deploy — a silent scheduler is
indistinguishable from a working one until payroll:

```sql
select started_at, finished_at, trigger, candidates, clocked_in, clocked_out, error
from attendance_scheduler_runs
order by started_at desc
limit 20;
```

Expect a row per minute. Gaps are missed clock-ins.

---

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

## 5. Resolved defaults — needs product confirmation

Both changed as a side effect of resolving two overlapping settings columns.
Each took the **more conservative** value so neither knob could silently loosen
the other — but conservative is a judgement, not a product decision.

| Setting | Was | Now | Effect of the change |
| --- | --- | --- | --- |
| Arrival dwell | 45 s | **2 min** | An employee must stay inside the radius for 2 minutes before arrival counts. Fewer false clock-ins from driving past; a genuine arrival is recorded up to ~75 s later than before. Because early arrivals are held until the scheduled start anyway, this is usually invisible — it only shifts the clock-in for someone arriving *after* their shift began. |
| Departure grace | 5 min | **10 min** | An employee must be outside the radius for 10 minutes before clocking out. Fewer wrong clock-outs from stepping to a truck or a GPS wobble; the recorded clock-out time is **unaffected** (it is always the original exit), so this costs no paid time — it only delays when the record closes. |

Neither is load-bearing for correctness; both are single-column changes if you
want different numbers. The question is whether 2 minutes and 10 minutes match
how your crews actually move on a jobsite.

---

## Merge gate

The attendance stack (#68, #70–#75) stays blocked until **all** of:

- [x] PR 17 complete — native plugins wired into both builds
- [x] iOS compiles with the attendance plugins in the target
- [x] Android compiles with the Kotlin sources included
- [ ] Physical iPhone arrival and departure verified
      ([test plan](./attendance-device-test-plan.md))
- [ ] Physical Android arrival and departure verified
- [ ] Scheduler confirmed operational in production (item 1)
- [ ] Migrations run cleanly on staging, triggers verified (item 3)
- [ ] Defaults confirmed (item 5)
