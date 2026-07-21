# Native geofencing for automatic attendance

Status: **IN PROGRESS — NOT COMPLETE.** The software layer is in place and the
native plugin reference code is provided, but automatic background attendance is
**not** finished: it has not been wired into the native builds, the background
auth path does not exist yet, and nothing has been verified on a physical device.
Do not describe automatic attendance as working in the background until the
checklist at the bottom passes on a real phone.

## Why this must be native

The iOS/Android app is a **remote-URL Capacitor shell** — it loads the deployed
website rather than bundling the web app. While the app is backgrounded or
terminated, **no WebView JavaScript runs**. Therefore arrival/departure detection
that works when the phone is in a pocket must be implemented in native code:

- **iOS:** CoreLocation region monitoring (`CLLocationManager` +
  `CLCircularRegion`) wakes the app for enter/exit transitions even after
  termination.
- **Android:** the platform Geofencing API delivers transitions to a
  `BroadcastReceiver` even when the app is not running.

The JavaScript foreground watch (`startForegroundGeofenceWatch`) remains the
fallback for the web and for native builds that haven't bundled the plugin yet.

## What is implemented (and verifiable)

- `src/lib/attendance/nativeGeofence.ts` — the JS side of the plugin contract:
  `buildJobsiteRegions()`, `registerGeofences()`, `getRegisteredGeofences()`,
  `onGeofenceTransition()`. All safe no-ops when the native plugin is absent.
- `JobsiteTimeEmployeeCard` registers the assigned jobs' regions when the native
  plugin is present, forwards foreground transitions to
  `/api/jobsite-time/events`, and stands the foreground watch down so events
  aren't duplicated.
- Reference native plugins:
  - `ios/App/App/JobsiteGeofencePlugin.swift`
  - `android/app/src/main/java/com/groundworkpro/app/JobsiteGeofencePlugin.kt`
  - `android/app/src/main/java/com/groundworkpro/app/GeofenceBroadcastReceiver.kt`

Each region identifier is `${jobId}:${zone}` (`arrival` = clock-in boundary,
`wake` = wide monitoring zone). iOS monitors ≤ 20 regions, so only the nearest
`MAX_NATIVE_GEOFENCE_JOBS` assigned jobs are registered.

## Remaining work (native — requires a device build)

### Background authentication (backend, required first)

`/api/jobsite-time/events` currently authenticates via the Supabase **session
cookie**. A background native POST has no WebView cookies, so:

1. Add an **attendance-scoped bearer token** the web app mints for the signed-in
   employee and hands to native (via Capacitor `Preferences` under
   `gw_attendance_token`, plus `gw_server_base_url`).
2. Accept that token in the events route (verify → resolve the user/company)
   **in addition to** the cookie path. Scope it to attendance event ingestion
   only.

Until this exists the native POSTs cannot authenticate — this is the single
biggest blocker to "works in the background".

### iOS wiring
- Register the plugin (add `JobsiteGeofencePlugin.swift` to the Xcode target and
  the Capacitor plugin registry).
- Entitlements/Info.plist: `NSLocationAlwaysAndWhenInUseUsageDescription`,
  `UIBackgroundModes: location`, and the background-location capability.
- Requires the user to have granted **Always** + **Precise** (see PR 8).

### Android wiring
- Add `play-services-location` to `android/app/build.gradle`.
- Declare `JobsiteGeofencePlugin` and `GeofenceBroadcastReceiver` in
  `AndroidManifest.xml`; add `ACCESS_FINE_LOCATION` +
  `ACCESS_BACKGROUND_LOCATION`.
- Replace the receiver's raw POST with a `WorkManager` job for retry/reliability.

## Device-verification checklist (the definition of done)

Automatic background attendance is complete only when, on a physical phone with
**Always + Precise** location granted:

- [ ] Registered regions are confirmed on device (`getRegistered`).
- [ ] Walking into the arrival radius with the app **backgrounded** creates a
      clock-in.
- [ ] Walking into the arrival radius with the app **force-quit** creates a
      clock-in.
- [ ] Leaving the radius records a departure/clock-out (after the grace period).
- [ ] The background POST authenticates and the event appears in the manager
      roster.
- [ ] No duplicate events between the native layer and the foreground fallback.

Until every box is checked, treat automatic attendance as foreground-only.
