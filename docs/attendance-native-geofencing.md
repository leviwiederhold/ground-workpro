# Native geofencing for automatic attendance

The iOS attendance path is native end to end. Core Location callbacks are
queued before network I/O, authenticated from the Keychain, and delivered by
Swift without waiting for a Capacitor WebView or a signed-in page.

## Durable iOS path

1. The signed-in app enrolls the device once and stores the access/refresh pair
   in the Keychain.
2. The authenticated monitoring plan registers the assigned job's wake and
   arrival regions. Desired region definitions are persisted natively.
3. `AppDelegate` installs the coordinator before any WebView work on every
   launch, including a Core Location relaunch.
4. On cold start, native code restores missing persisted regions, drains the
   event queue, refreshes credentials when needed, and fetches the current
   monitoring plan with the device bearer.
5. A region enter/exit is written to the native queue before HTTP delivery. A
   recent GPS sample is included when Core Location has one; the callback
   remains valid when the optional sample is absent.
6. The server rechecks device identity, company, employee, assignment, verified
   job coordinates, work schedule, and transition semantics. A bearer-authenticated
   Core Location boundary callback does not fabricate a point at `(0,0)`.
7. Only a completed 2xx response removes the queued transition. Retryable
   failures stay pending; permanent 4xx rejections are retained as quarantined
   diagnostics so they cannot block later transitions. The ingest audit records
   processing, accepted, ignored, or rejected outcomes so a retry cannot turn a
   prior failure into a false duplicate success.

Fixed assigned regions remain registered overnight. The schedule is enforced
at ingestion time. Deregistering every evening would create a circular
dependency: iOS does not promise a time-based wake the next morning to restore
the regions.

Assignment changes are reconciled on process launch, authorization restoration,
significant-location movement, and every region callback. Significant movement
is useful here because travel toward a newly assigned job is itself likely to
wake the native process. After a new region is installed, native code requests
its current state so an employee already inside can generate the arrival.

Foreground reconciliation remains a recovery fallback and is explicitly
attributed as `foreground_reconciliation`; it is not the primary clock-in path.

## Genuine iOS limits

- If the user swipe-force-quits the app, iOS suppresses location relaunch until
  the user opens it again. Application code and silent push cannot override
  this platform rule.
- Disabling Always Location, Precise Location, Location Services, or Background
  App Refresh can prevent or degrade background execution.
- iOS decides exactly when significant-location and region events are
  delivered. There is no exact background scheduling deadline.
- A server-side assignment change while the phone is completely stationary
  cannot execute code on the phone immediately. Retained prior regions plus a
  significant-movement reconciliation trigger are the reliable low-power
  architecture. Silent push may accelerate reconciliation but is best-effort
  and must not be the only trigger.
- Region callbacks are discrete OS events, not continuous employee tracking.

"App closed" acceptance means backgrounded or terminated by the system. A
swipe-force-quit must be tested separately and documented as the iOS limitation
above.

## Physical acceptance test

Use a production-like TestFlight build on a physical iPhone with Always +
Precise enabled:

- [ ] Install/update, confirm the assigned arrival/wake regions, then background
      the app. For an existing legacy credential, verify the first native wake
      creates the refresh pair without opening or signing in again.
- [ ] Do not open the app. Enter the arrival radius and verify one native
      `entered_geofence` event and the expected scheduled/pending clock-in.
- [ ] Leave the radius and verify departure/grace/clock-out behavior.
- [ ] Re-enter the same day and verify the intended second-session behavior
      without duplicates.
- [ ] Terminate the app through normal system lifecycle, repeat enter/exit, and
      verify native launch diagnostics and manager roster updates.
- [ ] Keep the app unopened across the 30-day access expiry (or shorten expiry
      in a test environment) and verify native refresh plus event delivery.
- [ ] Revoke the device credential and verify refresh and event submission both
      return `401`, the queue remains, and the UI requires signed-in re-enrollment.
- [ ] Change the assigned job while the app is unopened, travel far enough to
      trigger significant-location delivery, and verify the new regions are
      installed and the old ones removed.
- [ ] Disable network during an arrival, restore it, trigger another native wake,
      and verify the original timestamp is delivered exactly once.
- [ ] Confirm foreground fallback does not duplicate native events.

Swift code changed, so this fix requires a new TestFlight build; a web deploy
alone cannot deliver it.
