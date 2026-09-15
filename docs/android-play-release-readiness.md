# Android / Google Play release readiness

Last audited: 2026-09-15

Repository base: `main` at `55236b4`

Android application ID: `com.groundworkpro.app`

Production web origin: `https://ground-workpro.vercel.app`

This is the release record and operator runbook for Groundwork Pro's first
Google Play release. It distinguishes repository checks from work that requires
Firebase, Google Cloud, a signing secret, a physical device, or Play Console.

## Branch decision

Draft PR #91 was reviewed, but its branch was 15 production commits behind
`main`, contained merge conflicts, and would have removed newer application
work if merged as-is. Its Android-specific changes were reviewed individually
and selectively rebuilt on current `main`. The stale branch was not merged.

## Completed in the repository

- Android `namespace` and `applicationId` are `com.groundworkpro.app`. Android
  tests and generated Capacitor configuration use the same identity. The iOS
  bundle ID remains `com.leviwiederhold.groundworkpro`.
- Android sync is forced to the production HTTPS origin and native start route
  `/native?gw_native=1`. It fails if the generated ID, URL, start path, or
  social-provider configuration is wrong.
- Google and email sign-in remain available on Android. Apple sign-in is
  excluded from Android configuration and UI, but remains enabled on iOS.
- Kotlin is compiled and `MainActivity` registers the geofencing, attendance
  queue, and secure credential-storage plugins.
- The project uses Gradle 8.14.3, Android Gradle Plugin 8.13.0, Kotlin 2.0.21,
  Java 21, `compileSdk 36`, and `targetSdk 36`. API 36 is required for new
  submissions from August 31, 2026; AGP 8.13 supports API 36/36.1.
- The manifest includes network, notification, foreground precise/coarse
  location, background location, and boot-completed permissions. It includes
  the geofence and reboot receivers plus Firebase/Capacitor messaging
  components supplied by the dependency manifest.
- Automatic attendance preserves queued enter/exit events atomically, restores
  geofences after reboot or app replacement, and reports native readiness and
  permission failures instead of silently succeeding.
- Android message notifications use the existing durable push-job pipeline and
  FCM HTTP v1. The app creates the message channel and registers/rotates the FCM
  token. A monochrome notification icon and default channel metadata are set.
- Release builds require external signing configuration and a local Firebase
  file for `com.groundworkpro.app`. Missing or mismatched release inputs fail
  early. Debug, lint, unit-test, and sync workflows remain credential-free.
- Keystores, signing properties, `google-services.json`, service-account keys,
  and common credential files are ignored by Git. No credential is committed.
- Account deletion is available in Account Settings and at the public
  `/account-deletion` route. A current primary owner must transfer ownership and
  cancel any active subscription before deletion so shared data is not orphaned.
- The privacy page describes authentication, company/jobsite content, precise
  and background location, attendance events, messaging/uploads, push tokens,
  subscriptions, service providers, retention, and deletion.
- Branded adaptive launcher resources exist for every Android density, with a
  dedicated notification icon and app name `Groundwork Pro`.
- Tests guard the package ID, SDK, Kotlin/native registration, release guards,
  production Capacitor configuration, platform-specific login, permissions,
  adaptive icon, privacy route, and account-deletion route.

## Verification record

These checks were run from a clean clone on macOS with Node 22, pnpm 9, Android
SDK 36, and JDK 21:

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test:unit` | Passed (683 tests) |
| `pnpm build` | Passed in production mode with explicit non-secret placeholder build values |
| `pnpm android:sync` | Passed; generated Android config inspected |
| `./gradlew :app:assembleDebug` | Passed |
| `./gradlew :app:testDebugUnitTest :app:lintDebug` | Passed |
| Unsigned `./gradlew :app:bundleRelease` | Failed as designed with the signing guard |
| Debug APK manifest/config/dex inspection | Passed |
| `pnpm security:audit` (supplemental) | Reports two pre-existing tables outside this change as missing its `company_id` audit heuristic |

The inspected APK is `android/app/build/outputs/apk/debug/app-debug.apk`.
Inspection confirmed package `com.groundworkpro.app`, target SDK 36, version
`1.1` (`1`), the production URL/start path, `MainActivity`, both attendance
receivers, Capacitor/Firebase messaging services, and every custom attendance
Kotlin/Java class in dex.

The supplemental security audit names `attendance_scheduler_runs` and
`employee_join_code_rate_limits`. This branch changes no database migration or
row-level-security policy; that existing repository-wide finding is not hidden
or treated as an Android release verification failure.

Not yet verified because external configuration is required:

- a signed release `.aab` and its final bundle manifest/dex;
- FCM registration, background/terminated delivery, and tap routing;
- Google sign-in with Android OAuth and the production Web client;
- geofence enter/exit, reboot restoration, and queued upload on a physical
  Android device;
- Play Console declarations, review, closed testing, and production access.

## Required local files (never commit these)

| Purpose | Path |
| --- | --- |
| Firebase Android config | `android/app/google-services.json` |
| Upload signing properties | `android/keystore.properties` |
| Upload keystore | Absolute path outside this repository, such as `$HOME/.android/groundwork-pro-upload.jks` |

`android/keystore.properties.example` is the safe template. The environment
variables `ANDROID_UPLOAD_STORE_FILE`, `ANDROID_UPLOAD_STORE_PASSWORD`,
`ANDROID_UPLOAD_KEY_ALIAS`, and `ANDROID_UPLOAD_KEY_PASSWORD` are also accepted.
Do not put passwords on a shared command line or in a tracked CI file.

## Firebase Android app

1. In Groundwork Pro's Firebase project, add an Android app with package name
   **exactly** `com.groundworkpro.app`.
2. Download its `google-services.json` to
   `android/app/google-services.json`.
3. Enable the Firebase Cloud Messaging API. For server delivery, use a
   least-privilege service account permitted to send FCM messages. Store its
   project ID, client email, and private key only in the production server
   secret store as `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY`.
4. Never commit the downloaded JSON or service-account JSON. Before every
   commit, run `git status --short` and confirm neither appears.

## Signing and certificate fingerprints

Generate the upload key interactively outside the repository. Keep at least two
encrypted backups; losing it requires Play's upload-key reset process.

```sh
keytool -genkeypair -v \
  -keystore "$HOME/.android/groundwork-pro-upload.jks" \
  -alias groundwork-pro-upload \
  -keyalg RSA -keysize 2048 -validity 10000
cp android/keystore.properties.example android/keystore.properties
```

Edit the untracked properties file with the absolute path and values entered
interactively. Obtain fingerprints with:

```sh
cd android
JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew signingReport
keytool -list -v -keystore "$HOME/.android/groundwork-pro-upload.jks" \
  -alias groundwork-pro-upload
```

Register each identity that can sign an installed build:

- **Debug** SHA-1/SHA-256 for locally installed debug builds.
- **Upload** SHA-1/SHA-256 for locally signed upload bundles.
- **Play App Signing** SHA-1/SHA-256 shown after enabling Play App Signing; this
  signs builds delivered to testers and users.

This machine's current debug keystore reported SHA-1
`F1:E5:98:DA:29:A3:09:AA:44:95:7E:FA:CD:5F:3B:58:6A:3E:0C:B5` and SHA-256
`79:6A:23:BF:44:ED:CC:65:AC:CF:A4:C6:B5:9F:7A:64:C0:98:ED:34:A2:FE:1C:D0:71:C0:A7:3F:0E:91:44:F6`.
Recheck them if the debug keystore changes.

## Google OAuth on Android

1. Create Google Android OAuth clients for package `com.groundworkpro.app` and
   the debug, upload, and Play App Signing SHA-1 fingerprints as those
   certificates become available.
2. Keep the existing Web OAuth client. The production web build exposes its
   public client ID as `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
3. Keep the Web client and secret in Supabase Auth's Google provider and add the
   Android client IDs to its authorized client-ID list.
4. If the OAuth consent screen is in Testing, add every test account.

There is no Android redirect URI or custom-scheme callback. The native Google
sheet requests an ID token for the Web client ID and Supabase validates it
directly. Never put an OAuth client secret in a `NEXT_PUBLIC_*` variable, APK,
`google-services.json`, or Git.

## Build the release bundle

Choose a unique, increasing Play version code. The first release defaults to
version name `1.1` and code `1`; override these if Play Console history requires
different values.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
pnpm android:sync

cd android
JAVA_HOME=$(/usr/libexec/java_home -v 21) \
  ANDROID_VERSION_CODE=1 ANDROID_VERSION_NAME=1.1 \
  ./gradlew clean :app:testDebugUnitTest :app:lintDebug :app:bundleRelease
```

Expected output:
`android/app/build/outputs/bundle/release/app-release.aab`.

Inspect it rather than trusting Gradle. With `bundletool.jar` available:

```sh
java -jar /absolute/path/to/bundletool.jar dump manifest \
  --bundle android/app/build/outputs/bundle/release/app-release.aab \
  --module base > /tmp/groundwork-manifest.xml

java -jar /absolute/path/to/bundletool.jar build-apks \
  --bundle android/app/build/outputs/bundle/release/app-release.aab \
  --output /tmp/groundwork-release.apks --mode universal \
  --ks "$HOME/.android/groundwork-pro-upload.jks" \
  --ks-key-alias groundwork-pro-upload
```

Confirm the manifest contains the permanent package ID, target SDK 36, required
permissions, receivers, and Firebase services. Unzip the universal APK from the
`.apks` archive and use Android Studio APK Analyzer or `apkanalyzer` to confirm
custom classes and native libraries. Record the checksum:

```sh
shasum -a 256 android/app/build/outputs/bundle/release/app-release.aab
```

## App links and native entry routing

No verified public Android App Link contract exists, so the manifest does not
claim one. Authentication does not need one: Google uses native token exchange
and email/password stays in the production web app. Notification taps route
through the native shell to an internal conversation path. Adding an intent
filter before hosting and verifying `/.well-known/assetlinks.json` would create
an incomplete link contract.

The shell starts at
`https://ground-workpro.vercel.app/native?gw_native=1`. Password-reset and
invitation links remain web links unless a complete App Links contract is added.

## Public policy URLs

- Privacy policy: `https://ground-workpro.vercel.app/privacy`
- Account deletion: `https://ground-workpro.vercel.app/account-deletion`

Both must be deployed and anonymously reachable before submission. Enter the
deletion URL in App content > Data safety. Google requires an in-app deletion
path and a working public deletion resource for an account-creating app.

## Data Safety draft based on current behavior

This is a code-based starting point, not authorization to submit the form. The
final answers must include production settings, vendor contracts, and SDK
behavior observed in the signed build. Because the app controls its remote web
application, data sent by that WebView counts as app collection.

Declare **data collected** for app functionality/account management unless the
final production audit proves a narrower answer:

| Play data type | Groundwork Pro behavior | Required / optional |
| --- | --- | --- |
| Name, email address, user IDs | Account, profile, membership, authentication | Required for an account |
| Precise location | Jobsite validation and geofence setup/events | Required only for location attendance |
| Photos and videos | User-uploaded jobsite/project/message content | Optional |
| Files and documents | User-uploaded attachments and project content | Optional |
| Messages | In-app company conversations | Optional feature use |
| App interactions / other user-generated content | Attendance, tasks, notes, jobsites, reports | Feature-dependent |
| Device or other IDs | Native device enrollment and FCM token | Required for native attendance/push |
| Purchase history | Company subscription status/plan IDs; card details stay with Stripe | Required for subscribed owners |
| Crash logs and diagnostics | Sentry when its production integration is enabled | Automatic when enabled |

The code does not request `AD_ID`, include an advertising SDK, or use data for
ads. Collection purposes are app functionality, account management,
security/fraud prevention, and diagnostics/reliability. Data is sent over HTTPS.
Users can request deletion in-app or through the public URL.

Do not answer Play's **sharing** questions solely from this table. Google has
specific service-provider exemptions. Confirm the production configuration and
controller/processor role for Supabase, Vercel, Google/Firebase, Stripe, Sentry,
and storage/email providers, then answer consistently with the privacy policy.
Optional uploads and location still count if they can be collected.

## Background-location declaration

`ACCESS_BACKGROUND_LOCATION` supports the core automatic-attendance feature:
jobsite enter/exit events must fire while the app is closed or not in use. Play
requires approval for this permission, including on testing tracks.

Use this single declared feature: **automatic jobsite arrival and departure
attendance**. The in-app disclosure immediately before the permission flow is:

> Groundwork Pro collects location data to enable automatic jobsite arrival and
> departure attendance, even when the app is closed or not in use. It records
> discrete jobsite events and does not create a continuous location history.

Before submission:

1. Mention automatic background attendance in the store listing and privacy
   policy.
2. Record a preferably 30-second-or-shorter Android video showing app launch,
   navigation to the feature, the full disclosure, runtime permission, consent
   and refusal/retry, and an arrival/departure result while backgrounded.
3. Supply durable reviewer credentials and navigation instructions.
4. Complete App content > Sensitive permissions and APIs > Location permissions
   with the same single feature and video URL.

Also prepare for Google's precise-location declaration becoming available in
November 2026 and mandatory policy compliance on January 27, 2027. Groundwork
Pro needs precision because neighbouring jobsites and geofence boundaries cannot
be resolved reliably at city-level accuracy.

## Store listing assets still required

- 512 x 512, 32-bit PNG Play icon, at most 1,024 KB. This is separate from the
  packaged adaptive launcher resources.
- 1024 x 500 JPEG or 24-bit PNG feature graphic with no alpha.
- At least two accurate phone screenshots; four or more should cover native
  login, dashboard, automatic attendance disclosure/status, jobsite workflow,
  and messaging. Never show real customer data.
- Title, short/full descriptions, support email, website, privacy URL,
  category/tags, and release notes.
- A separate unlisted background-location review video.

## Play Console sequence (manual; no upload performed here)

1. Create **Groundwork Pro**, choose English (United States), App, free/paid
   status, and required declarations. Confirm the package before first upload.
2. Enable Play App Signing, record its SHA-1/SHA-256, and add its SHA-1 to the
   Android OAuth configuration before testing the Play-delivered build.
3. Complete Store listing, App access/reviewer credentials, Ads, Content rating,
   Target audience, News apps, Data safety, Account deletion, Privacy policy,
   and Sensitive permissions/background location.
4. Create a closed-testing track, upload the inspected `.aab`, add release notes,
   resolve every issue, add testers, and roll out only after approval.
5. Install from the Play opt-in link, not Android Studio, and complete the
   physical-device matrix below.
6. Personal developer accounts created after November 13, 2023 must keep at
   least 12 testers opted in continuously for 14 days, then apply for production
   access and truthfully summarize engagement, feedback, fixes, and readiness.
   Account type and Console UI determine whether this applies.
7. After production access and an accepted test, prepare or promote the verified
   production release. Submit only with explicit owner approval.

## Physical-device release checklist

Use at least one Android 13 device and one Android 16/API 36 device if available.
Test a fresh install and upgrade.

- Email sign-up/sign-in, Google sign-in, sign-out, and session restoration.
- Apple absent on Android and unchanged on iOS.
- Notification denial/re-enable, channel creation, foreground/background/force-
  stopped delivery, token refresh, and exact conversation tap routing.
- Disclosure order; location denial, retry, and Settings recovery.
- Geofence enter/exit foregrounded, backgrounded, and terminated; confirm only
  discrete attendance events are recorded.
- Reboot and app-update geofence restoration.
- Offline enter/exit queue followed by authenticated upload after reconnect.
- Battery-optimization and location-services-disabled diagnostics.
- Account deletion for a normal member and protected behavior for a primary
  owner or company with an active subscription.
- Privacy/deletion links, rotation, process death, cold start, production start
  route, and no cleartext network traffic.

## Release checklist

- [ ] Firebase app and local `google-services.json` configured.
- [ ] Debug, upload, and Play App Signing OAuth fingerprints registered.
- [ ] Production Web client ID and Supabase authorized clients verified.
- [ ] Upload keystore generated, backed up, and configured outside Git.
- [ ] Production FCM service-account secrets configured server-side.
- [ ] Final version selected and full repository suite green.
- [ ] Signed `.aab` built, checksummed, and inspected.
- [ ] Public privacy/deletion pages deployed and anonymously reachable.
- [ ] Data Safety reviewed against production vendors/settings.
- [ ] Background-location declaration, video, and reviewer account ready.
- [ ] Store listing text/assets ready.
- [ ] Play-installed closed-test build passes the device matrix.
- [ ] Required closed-test participation completed if applicable.
- [ ] Production rollout has explicit owner approval.

## Policy references

- [Target API requirements](https://developer.android.com/google/play/requirements/target-sdk)
- [AGP 8.13 compatibility](https://developer.android.com/build/releases/agp-8-13-0-release-notes)
- [Background location requirements](https://support.google.com/googleplay/android-developer/answer/9799150)
- [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Data Safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469)
- [Store listing assets](https://support.google.com/googleplay/android-developer/answer/9866151)
- [Closed testing for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Prepare and roll out a release](https://support.google.com/googleplay/android-developer/answer/9859348)
