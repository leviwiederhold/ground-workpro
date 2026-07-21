# Automatic attendance — completion status

## Automatic attendance is NOT complete

The software layer is finished and tested. **Background detection does not run
on either platform**, because the native code that implements it is not part of
either native build. Do not describe automatic attendance as working in the
background, and do not ship it as a product promise, until the blockers below
are cleared and [`attendance-device-test-plan.md`](./attendance-device-test-plan.md)
is signed on real hardware.

## What was verified, and how

| Check | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | **pass** |
| Lint | `pnpm lint --max-warnings=0` | **pass** |
| Unit + state machine + end-to-end | `pnpm test:unit` | **pass** — 380 tests, 0 failures |
| Production web build | `pnpm build` | **pass** |
| iOS project compiles | `xcodebuild -scheme App -destination generic/platform=iOS` | **pass** — `** BUILD SUCCEEDED **` |
| Android project compiles | `./gradlew :app:assembleDebug` (JDK 21) | **pass** — `BUILD SUCCESSFUL` |
| Background behavior on a physical iPhone | — | **NOT RUN** |
| Background behavior on a physical Android | — | **NOT RUN** |

### The native builds pass for the wrong reason

Both native projects compile — **because the attendance native code is invisible
to them.**

**iOS.** `JobsiteGeofencePlugin.swift` and `AttendanceQueueStorePlugin.swift`
exist on disk but are not members of the Xcode target:

```
$ grep -o 'JobsiteGeofencePlugin\|AttendanceQueueStorePlugin' \
    ios/App/App.xcodeproj/project.pbxproj
(no output)
```

The compiler never sees them. `BUILD SUCCEEDED` says nothing about whether they
are correct.

**Android.** `JobsiteGeofencePlugin.kt`, `GeofenceBroadcastReceiver.kt`, and
`AttendanceQueueStorePlugin.kt` are all present, but `android/app/build.gradle`
applies only `com.android.application` — **no Kotlin Gradle plugin**:

```
$ head -1 android/app/build.gradle
apply plugin: 'com.android.application'
$ grep -c kotlin android/app/build.gradle
0
```

Gradle silently skips every `.kt` file. `BUILD SUCCESSFUL` on a build that
compiled none of the Kotlin sources.

`MainActivity.java` also registers no plugins:

```java
public class MainActivity extends BridgeActivity {}
```

So on both platforms the `Capacitor.Plugins.*` lookups in the JS layer resolve
to `undefined`, every native path falls back to its web fallback, and the app
behaves exactly as if the native work had never been written. That is why every
device row in the test plan is UNVERIFIED — there is currently nothing on a
device to verify.

## Blockers

- [ ] **iOS:** add `JobsiteGeofencePlugin.swift` and
      `AttendanceQueueStorePlugin.swift` to the App target in the Xcode project.
- [ ] **iOS:** add the background-location entitlement and the
      `NSLocationAlwaysAndWhenInUseUsageDescription` /
      `NSLocationWhenInUseUsageDescription` Info.plist keys.
- [ ] **Android:** apply the Kotlin Gradle plugin to `app/build.gradle` and add
      `play-services-location`.
- [ ] **Android:** register `JobsiteGeofencePlugin` and
      `AttendanceQueueStorePlugin` in `MainActivity`, and declare
      `GeofenceBroadcastReceiver` plus `ACCESS_BACKGROUND_LOCATION` in the
      manifest.
- [ ] **Both:** implement `SecureAttendanceStore` (Keychain / Keystore). Without
      it, `enrollDeviceCredential()` deliberately refuses to mint a token — it
      will not create a credential it cannot store securely — so background
      submission has no way to authenticate.
- [ ] **Both:** point the native geofence handlers at the same queue file as
      `AttendanceQueueStorePlugin`, so background transitions queued offline
      share one queue and diagnostics report one depth rather than two.
- [ ] **Deployment:** set `CRON_SECRET`, and confirm the Vercel plan permits a
      minute-granularity cron (Hobby does not — see
      [`attendance-scheduled-clock-in.md`](./attendance-scheduled-clock-in.md)).
      Without the cron, **nothing clocks anyone in**.
- [ ] **Database:** apply the four attendance migrations, including the
      append-only triggers, and confirm no existing job UPDATEs or DELETEs
      `jobsite_timecard_events` (it will now fail loudly).
- [ ] **Then:** execute the physical-device test plan and sign it.

## What the automated harness does prove

`tests/unit/attendance-e2e-scenarios.test.ts` drives the real decision engines,
scheduled runners, offline queue, and lifecycle derivation through all 30
required scenarios plus the required regression scenario, against an in-memory
database.

The important property it establishes: **the server-side pass produces the
correct records, at the correct timestamps, exactly once, with no client
involvement of any kind.** No fetch, no component, no app. That is the substance
of "works with the app closed", because the scheduled pass *is* the mechanism —
the phone's only job is to report the arrival.

It also holds under abuse: running the reconciliation twenty times over the same
arrival and departure yields one timecard and one audit event of each type.

What it cannot prove is that iOS or Android wake the app and deliver the
geofence transition in the first place. No test process can. That is the
device plan's job, and it has not been run.

## Honest summary by PR

| PR | Scope | Software | Device |
| --- | --- | --- | --- |
| 9 (#68) | Native geofence monitoring | reference code | **unverified** |
| 10 (#69) | Device-scoped credentials | complete | **unverified** |
| 11 (#70) | Automatic arrival + scheduled clock-in | complete, tested | **unverified** |
| 12 (#71) | Automatic departure + clock-out | complete, tested | **unverified** |
| 13 (#72) | Offline synchronization | complete, tested | **unverified** |
| 14 (#73) | Lifecycle UI | complete, tested | **unverified** |
| 15 (#74) | Audit trail + corrections | complete, tested | triggers unverified against live Postgres |
| 16 (this) | End-to-end validation | 34-scenario harness passing | **plan written, NOT RUN** |
