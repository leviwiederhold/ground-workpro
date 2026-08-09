# Android / Google Play release readiness

Audit date: 2026-08-09

Audited baseline: `610e2c08ea7abc9b3807476b42c71585783bec89`

This project is the Android container for the existing Groundwork Pro product.
It loads the same production application and uses the same company, auth,
messaging, attendance, attachment, and push backends as iOS/web.

## Status matrix

Status means the state after the Android release-readiness PR. “Needs physical
verification” means the implementation and build wiring exist but Android OS,
Play Services, OEM battery management, or a device picker must be exercised on
real hardware before release.

| Area | iOS production comparison | Android status | Evidence / remaining work |
| --- | --- | --- | --- |
| Capacitor project | Production shell | **Working** | Capacitor 8.3 project and plugins sync/build with JDK 21. |
| Application identity | `com.leviwiederhold.groundworkpro` | **Working; needs console confirmation** | Android's existing Gradle identity is `com.groundworkpro.app`. Confirm it before creating the permanent Play/Firebase records. |
| Version | TestFlight 1.1 (11) | **Needs configuration** | Defaults to 1.1 (1); query Play Console for the next unused version code before upload. |
| Release signing | App Store signing configured | **Needs configuration** | Gradle supports a gitignored upload keystore or `ANDROID_UPLOAD_*`; no upload key exists in the repository. Play App Signing should hold the app-signing key. |
| Target / 64-bit | Current iOS toolchain | **Working** | compile/target SDK 36, min SDK 24; Release AAB contains arm64-v8a (plus armv7/x86/x86_64) native libraries. |
| Permissions | Always + precise location, notifications | **Working; needs physical verification** | Manifest has fine/coarse/background location, notifications, boot, and internet. Runtime permission/Settings flow exists. |
| Automatic attendance | `AttendanceGeofenceCoordinator`, durable headless delivery | **Needs physical verification** | Android has Play Services geofencing, a `BroadcastReceiver` that runs without the WebView, authenticated direct delivery, a shared `AtomicFile` queue, and reboot restore kept alive with `goAsync()`. Physical terminated/Doze/reboot/OEM testing remains mandatory. |
| CEO readiness | Live iOS authorization/credential/regions | **Working; needs physical verification** | Android health now reports actual background authorization, location-services, precision, background restriction, credential, and registered regions. Foreground changes raise the same blocking gate and persist Android platform readiness. |
| Message push | APNs live | **Needs configuration and physical verification** | Same PR #89 registry/jobs/worker now sends Android devices through FCM HTTP v1. Requires Firebase client file and server credentials. |
| Notification tap | Opens exact iOS thread | **Working; needs physical verification** | Same retained Capacitor action routes to `/messages?thread=<id>`; Android launch mode is `singleTask`. No external App Link is required for notification data taps. |
| External deep links | Native routes are internal | **Missing (non-blocking)** | No verified HTTPS App Links intent filter. Add only if marketing/invite links must open the app; notification taps do not depend on it. |
| Google native auth | iOS client + Web client | **Needs configuration and physical verification** | Android Credential Manager uses the Web client ID at runtime and an Android OAuth client selected by package + signing SHA-1. Apple action is not exposed on Android. |
| Password/session storage | Supabase remote WebView session | **Working; needs physical verification** | Same remote-origin Supabase session model as iOS. Attendance bearer credential is AES-GCM protected by Android Keystore. Backups are disabled. |
| Camera/photo/file/video | Web picker + private signed attachment URLs | **Needs physical verification** | Shared upload/preview code preserves image/file/video support and private storage; verify Android camera, Files/Photos providers, mixed attachments, reload, and playback. |
| Production server | Production Vercel origin | **Working** | Synced origin is `https://ground-workpro.vercel.app`; native start path is `/native?gw_native=1`. Headless attendance stores that exact synced origin rather than guessing. |
| Account deletion | Required by stores | **Working; production validation needed** | In-app authenticated deletion and public `/account-deletion` instructions exist. Active paid company owners remain protected by the existing database guard. |
| Store listing | App Store listing exists | **Missing / needs configuration** | Android launcher branding is restored. Play icon export, 1024×500 feature graphic, Android screenshots, copy, category, contact details, and declarations remain. |

## Automatic attendance audit

Android did already contain native geofencing; Capacitor sync was not the proof.
`GeofenceBroadcastReceiver` is invoked by a Play Services `PendingIntent` when
the Activity/WebView is absent. It reads the Keystore credential, posts the
discrete arrival/departure event directly, and enqueues every failed delivery in
the same durable queue drained by the web runtime. `BootReceiver` restores the
registered region set after reboot.

The pre-audit implementation was not release-equivalent to iOS because it never
persisted a production server origin or stable native device ID, returned an
incomplete health contract, hard-coded several credential/readiness writes as
iOS, did not surface authorization changes, allowed the reboot receiver to end
before Play Services completed, and described a rename-based queue as atomic.
The PR corrects those gaps without weakening the iOS coordinator.

Android and iOS cannot be byte-for-byte identical: iOS uses Core Location
region monitoring and the `AttendanceGeofenceCoordinator`; Android uses Google
Play Services geofencing and broadcast delivery. Functional parity must be
confirmed on physical Android hardware under background, locked, naturally
terminated, rebooted, Doze, battery-restricted, and restored-permission states.

## FCM configuration

No database migration is required. PR #89 already made `push_devices`,
`message_push_jobs`, delivery attempts, registration RPCs, membership
revocation, and the retry scheduler platform-neutral.

1. In Firebase, select or create the Groundwork Pro project and add an Android
   app with package `com.groundworkpro.app`.
2. Download `google-services.json` to `android/app/google-services.json`. The
   file is intentionally gitignored.
3. Enable the Firebase Cloud Messaging API (HTTP v1).
4. Create/select a narrowly scoped service account permitted to send FCM and
   add `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY` to Vercel
   Production. Do not expose them as `NEXT_PUBLIC_*` values.
5. Keep the existing scheduler and `PUSH_DISPATCH_SECRET`; Android jobs go
   through the same dispatcher. Do not add a second cron or client-send path.
6. Register Android OAuth clients in Google Cloud for the same package using
   the debug, upload, and Play App Signing SHA-1 certificates. The runtime keeps
   using the existing `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID` as its server client.

The local debug certificate SHA-1 observed during this audit is:

`F1:E5:98:DA:29:A3:09:AA:44:95:7E:FA:CD:5F:3B:58:6A:3E:0C:B5`

The upload-key SHA-1 is available after the upload keystore is created. The
Play App Signing SHA-1 is available only after enrolling the app in Play App
Signing; add both rather than replacing the debug OAuth client.

## Signing and bundle

Google Play accepts an Android App Bundle. Keep the upload key separate from
the Play app-signing key and back it up securely. Configure either:

- `android/keystore.properties`, copied from the committed example; or
- `ANDROID_UPLOAD_STORE_FILE`, `ANDROID_UPLOAD_STORE_PASSWORD`,
  `ANDROID_UPLOAD_KEY_ALIAS`, and `ANDROID_UPLOAD_KEY_PASSWORD` in release CI.

Set `ANDROID_VERSION_CODE` to the next unused Play version code and
`ANDROID_VERSION_NAME` to the public version. Then run:

```sh
pnpm android:sync
JAVA_HOME=$(/usr/libexec/java_home -v 21) pnpm android:bundle
```

`android:bundle` runs signing and Firebase package guards and refuses a Play
bundle when upload credentials are incomplete, `google-services.json` is
missing, or that file belongs to another package. Neither key nor password
belongs in Git.

## Google Play configuration and policy

- Target SDK: the project targets API 36. Google says new apps and updates must
  target Android 16/API 36 beginning August 31, 2026:
  https://developer.android.com/google/play/requirements/target-sdk
- 64-bit: the Release AAB contains arm64 code:
  https://developer.android.com/google/play/requirements/64-bit
- App signing/AAB:
  https://developer.android.com/studio/publish/app-signing and
  https://developer.android.com/studio/publish/upload-bundle
- Background location: automatic attendance is the core feature justifying the
  permission. Complete the declaration, provide a video (30 seconds or less)
  showing the employee-facing prominent disclosure and Settings flow, and make
  the privacy policy accessible in-app and on the listing:
  https://support.google.com/googleplay/android-developer/answer/9799150?hl=en
- Notifications: Android 13+ permission is requested at runtime:
  https://developer.android.com/develop/ui/compose/notifications/notification-permission
- Account deletion: provide the in-app action and public
  `https://ground-workpro.vercel.app/account-deletion` URL:
  https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-EN
- Data safety: declare actual collection/sharing for account/company identity,
  precise/background location, messages and attachments (including photos and
  videos), device/push identifiers, attendance/operational activity, billing,
  and diagnostics. Verify every SDK's behavior before answering:
  https://support.google.com/googleplay/android-developer/answer/10787469?hl=en
- Testing: if this is a personal developer account created after November 13,
  2023, production access requires at least 12 opted-in closed-test users for
  14 continuously enrolled days:
  https://support.google.com/googleplay/android-developer/answer/14151465?hl=en
- Listing assets: supply a 512×512 Play icon, 1024×500 feature graphic, and
  representative Android phone screenshots:
  https://support.google.com/googleplay/android-developer/answer/9866151?hl=en

Also complete app access instructions for a reviewer account, ads declaration,
content rating, target audience, privacy-policy URL, support contact, category,
and pricing/countries. Background-location review applies to active testing
tracks as well as production.

## Physical Android test plan

Use at least one Android 13+ Google Play Services device and, if possible, a
second OEM with aggressive battery controls.

1. Fresh install, email login, Google login, logout/relogin, and account-delete
   entry point.
2. Notification denial, grant, token rotation/reinstall, foreground message,
   background/locked/terminated message, exact-thread tap, second device, and
   stale-token handling.
3. Location prominent disclosure, foreground grant, “Allow all the time,”
   precise toggle, device-wide location toggle, and battery restriction.
4. Assigned job geofence enter/exit with app foreground, background, locked,
   naturally terminated, after Doze, and after reboot. Confirm queue/drain and
   CEO readiness after every authorization downgrade/restore.
5. Camera/photo/file selection, MP4/MOV/WebM selection where the provider
   exposes it, upload progress/failure, mixed image+video, reload, playback,
   private-access denial, and an oversized upload.
6. Stripe checkout/portal return flow, production server URL, and orientation /
   process recreation without credential loss.

## Responsibility split

Codex can finish code/tests, build unsigned or locally signed AABs, verify
bundle contents, create the draft PR, and assist with Firebase/Play Console once
an authenticated session is available. The account owner must complete or
approve legal/attestation forms, accept Play agreements, handle Google 2FA,
confirm the permanent package identity, retain the upload-key backup, supply
review credentials/media/listing assets, and perform physical device travel and
geofence tests.
