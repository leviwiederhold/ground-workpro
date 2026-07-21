# Automatic attendance — completion status

## Automatic attendance is NOT complete

The software layer is finished and tested, and as of **PR 17** the native code
is compiled into both builds. What is still missing is the only thing that can
settle it: **nobody has run this on a phone.**

Do not describe automatic attendance as working in the background, and do not
ship it as a product promise, until
[`attendance-device-test-plan.md`](./attendance-device-test-plan.md) is signed
on real hardware.

## What was verified, and how

| Check | Command | Result |
| --- | --- | --- |
| Types | `pnpm typecheck` | **pass** |
| Lint | `pnpm lint --max-warnings=0` | **pass** |
| Unit + state machine + end-to-end | `pnpm test:unit` | **pass** — 380 tests, 0 failures |
| Production web build | `pnpm build` | **pass** |
| iOS compiles **with the plugins in the target** | `xcodebuild -scheme App -destination generic/platform=iOS` | **pass** — all four attendance sources logged as `Compiling … in target 'App'` |
| Android compiles **with the Kotlin sources** | `./gradlew :app:assembleDebug` (JDK 21) | **pass** — `:app:compileDebugKotlin` runs, no warnings |
| Build integration cannot silently regress | `tests/unit/native-build-integration.test.ts` | **pass** — 15 guards |
| Background behavior on a physical iPhone | — | **NOT RUN** |
| Background behavior on a physical Android | — | **NOT RUN** |

### RESOLVED in PR 17 — the native builds used to pass for the wrong reason

This section is kept because it is the reason the whole stack was blocked, and
because the guard tests that now prevent it only make sense against it.

Before PR 17, both native projects compiled — **because the attendance native
code was invisible to them.**

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

So on both platforms the `Capacitor.Plugins.*` lookups in the JS layer resolved
to `undefined`, every native path fell back to its web fallback, and the app
behaved exactly as if the native work had never been written.

`tests/unit/native-build-integration.test.ts` now asserts membership in the
Xcode Sources phase, the Kotlin plugin, and `registerPlugin` in `MainActivity`,
so this class of silent failure cannot come back unnoticed.

## Blockers

Cleared by PR 17:

- [x] **iOS:** all four attendance Swift sources added to the App target.
- [x] **iOS:** `CAPBridgedPlugin` conformance so Capacitor actually registers
      them (the classes previously compiled but were never registered).
- [x] **iOS:** `NSLocationAlwaysAndWhenInUseUsageDescription`,
      `NSLocationWhenInUseUsageDescription`, and `UIBackgroundModes: location`.
- [x] **iOS:** fixed a background POST that could never have worked —
      `URLSessionConfiguration.background` rejects data tasks, so every
      background attendance event was silently discarded.
- [x] **Android:** Kotlin Gradle plugin applied and `play-services-location`
      added; the `.kt` sources are compiled for the first time.
- [x] **Android:** all three plugins registered in `MainActivity` before
      `super.onCreate()`.
- [x] **Android:** `ACCESS_BACKGROUND_LOCATION`, the transition receiver, and a
      boot receiver (the platform clears geofences on reboot).
- [x] **Both:** `SecureAttendanceStore` implemented (Keychain / Keystore), so
      `enrollDeviceCredential()` can finally mint a token.
- [x] **Both:** native handlers append failed transitions to the SAME queue file
      the JS layer flushes — one queue, one reported depth.

Still open:

- [ ] **Deployment:** confirm the Vercel plan and the scheduler — see
      [`attendance-deployment-checklist.md`](./attendance-deployment-checklist.md).
      Without a working cron, **nothing clocks anyone in**.
- [ ] **Database:** apply the four migrations on staging and verify the
      append-only triggers.
- [ ] **Then:** execute the physical-device test plan and sign it. **This is the
      only remaining thing that can make automatic attendance complete.**

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
| 16 (#75) | End-to-end validation | 34-scenario harness passing | **plan written, NOT RUN** |
| 17 (this) | Native build integration | both builds compile the plugins; 15 guards | **NOT RUN on a device** |
