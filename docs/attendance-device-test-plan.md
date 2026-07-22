# Automatic attendance — physical-device test plan

**Status: NOT EXECUTED. Every device result below is UNVERIFIED.**

This plan exists to be run on real hardware by a person. Nothing in it has been
performed. Do not treat any row as passing until someone has signed it with a
device, an OS version, and a date.

## Before any of this can be run

The native code is **not in the builds**. See
[`attendance-completion-status.md`](./attendance-completion-status.md) for the
evidence. Until the blockers there are cleared, this plan cannot be executed at
all — there is no background detection on either platform to test.

## Automated coverage vs. device coverage

| Layer | Covered by | Status |
| --- | --- | --- |
| Decision engines, state machine, timezone/DST | `tests/unit/*.test.ts` | **Passing** |
| Server-side lifecycle end to end | `tests/unit/attendance-e2e-scenarios.test.ts` | **Passing** (34 scenarios) |
| OS wakes the app while backgrounded / locked / terminated | this plan | **UNVERIFIED** |
| Native geofence registration survives reboot | this plan | **UNVERIFIED** |
| Native offline queue durability on device | this plan | **UNVERIFIED** |
| Background credential submission from native | this plan | **UNVERIFIED** |

The automated harness proves the **server** produces the right records at the
right timestamps with no client involvement — which is the substance of
"works with the app closed", because the scheduled pass is the mechanism. It
cannot prove the OS delivers the arrival event in the first place. That is what
this plan is for.

## Setup

| Item | Value |
| --- | --- |
| Test company timezone | America/New_York |
| Work hours | 07:00 – 16:00, Mon–Fri |
| Monitoring lead | 120 minutes |
| Arrival dwell | 2 minutes |
| Departure grace | 10 minutes |
| End-of-day cutoff | 180 minutes |
| Early arrival mode | `scheduled_start` |
| Jobsite | A real, address-verified location with a ~200 m arrival radius |

Record for every run: device model, OS version, app build, tester, date, and
the resulting `jobsite_timecards` row + `jobsite_timecard_events` trail.

## The required regression scenario

> Shift starts at 7:00 AM. Monitoring starts 120 minutes before. The employee is
> onsite before 7:00 AM. **The app is not open.** The employee is automatically
> clocked in at 7:00 AM. The employee later leaves the jobsite and is
> automatically clocked out after the configured grace period.

| Step | Expected | iPhone | Android |
| --- | --- | --- | --- |
| 1. Assign the employee, verify the jobsite address | Monitoring plan reports `active: false`, next window 5:00 AM | UNVERIFIED | UNVERIFIED |
| 2. Force-quit the app the night before | Regions remain registered with the OS | UNVERIFIED | UNVERIFIED |
| 3. Arrive onsite at ~6:50 AM, app still closed | `entered_geofence` event at 6:50, `pending_arrival_at` set | UNVERIFIED | UNVERIFIED |
| 4. Wait, phone in pocket, screen locked | `onsite_before_shift` event; **no clock-in** | UNVERIFIED | UNVERIFIED |
| 5. 7:00 AM passes, app still never opened | `clock_in_at = 07:00`, `clock_in_method = scheduled_start` | UNVERIFIED | UNVERIFIED |
| 6. Open the app at ~7:30 | Shows "Clocked in automatically". **No duplicate record** | UNVERIFIED | UNVERIFIED |
| 7. Leave the jobsite at ~2:00 PM, close the app | `departure_pending` event at the exit time | UNVERIFIED | UNVERIFIED |
| 8. Stay away past the 10-minute grace | `clock_out_at = 14:00` (**not** the processing time) | UNVERIFIED | UNVERIFIED |
| 9. Check total hours | 7.0 h — the processing delay is not paid | UNVERIFIED | UNVERIFIED |

**PR 16 does not mark automatic attendance complete. It cannot, until every row
in this table is signed.**

## Scenario matrix

`A` = covered by the automated harness (server/state-machine level).
`D` = requires a physical device.

| # | Scenario | A | D | iPhone | Android |
| --- | --- | :-: | :-: | --- | --- |
| 1 | Employee arrives before shift | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 2 | Employee arrives after shift start | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 3 | Already onsite when monitoring activates | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 4 | App backgrounded | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 5 | App closed / WebView inactive | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 6 | Phone locked | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 7 | Device offline during arrival | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 8 | Device offline during departure | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 9 | App reopened after a missed event | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 10 | Brief exit and return | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 11 | Permanent departure | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 12 | Assignment changed before the shift | ✅ | — | n/a | n/a |
| 13 | Assignment changed while onsite | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 14 | Multiple nearby jobs | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 15 | Overlapping job assignments | ✅ | — | n/a | n/a |
| 16 | Duplicate native events | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 17 | Out-of-order events | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 18 | Expired or revoked credential | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 19 | Permission revoked and restored | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 20 | Precise location disabled | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 21 | Phone restarted | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 22 | App updated | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 23 | Company timezone changed | ✅ | — | n/a | n/a |
| 24 | Daylight-saving transition | ✅ | — | n/a | n/a |
| 25 | Jobsite coordinates changed | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 26 | No verified jobsite coordinates | ✅ | — | n/a | n/a |
| 27 | Remains onsite past scheduled end | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 28 | Missing exit event | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 29 | Offline queue survives restart | ✅ | ✅ | UNVERIFIED | UNVERIFIED |
| 30 | Full lifecycle without opening the app | ✅ | ✅ | UNVERIFIED | UNVERIFIED |

Scenarios marked `— / n/a` are pure server or timezone logic with no device
component; the automated harness is sufficient for them.

## Device procedures for the ones that need care

**4/5/6 — backgrounded, closed, locked.** Force-quit from the app switcher (not
just background it). Lock the phone. Drive/walk in from at least 1 km away so
the wake region fires before the arrival region. Do **not** open the app at any
point until step 6 of the regression scenario.

**7/8 — offline.** Enable Airplane Mode *before* crossing the boundary and keep
it on for at least 30 minutes. Confirm the event arrives later carrying its
**original** timestamp, not the reconnect time.

**16 — duplicate native events.** iOS can deliver a region transition more than
once. Cross the boundary slowly, back and forth within the dwell, and confirm
exactly one timecard and one `scheduled_clock_in` audit event.

**18 — expired credential.** Set the credential's `expires_at` to the past
directly in the database, generate an arrival, and confirm the event is **held**
(pending, attempts not incremented) rather than quarantined — then confirm it
delivers after the app re-enrolls.

**21 — phone restarted.** Queue an event offline, then reboot. On iOS, do **not**
unlock the phone immediately: the queue file uses
`completeUntilFirstUserAuthentication`, and the point is to confirm the
background handler can still append before first unlock.

**22 — app updated.** Install the previous build, queue an event, then install
the new build over it. The event must survive and flush.

**24 — daylight saving.** Set the device and company timezone to
America/New_York and the device clock to 2026-03-08. Confirm the clock-in still
lands at 7:00 **local**.

## Battery and permission sanity

Not a numbered scenario, but a release blocker in practice:

- [ ] iOS: "Always" location, precise on, background app refresh on.
- [ ] Android: "Allow all the time", precise on, battery optimization
      **disabled** for the app. Verify on at least one aggressive OEM
      (Samsung/Xiaomi/OnePlus) where geofences are commonly killed.
- [ ] Measure battery drain across a full 9-hour shift with monitoring active.
      Region monitoring should be near-free; anything measurable means something
      is polling that should not be.

## Sign-off

No sign-off has been given. This table is intentionally empty.

| Platform | Device | OS | Build | Tester | Date | Result |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone | — | — | — | — | — | **NOT RUN** |
| Android | — | — | — | — | — | **NOT RUN** |
