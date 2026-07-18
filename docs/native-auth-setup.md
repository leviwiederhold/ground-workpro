# Native Google and Apple Sign-In Setup

Groundwork Pro's Capacitor app uses native provider ID tokens. Do not configure
native Google or Apple sign-in as browser redirect OAuth in the embedded WebView
— Google blocks OAuth redirects inside embedded WebViews, which is the reason
this flow exists.

The app calls `supabase.auth.signInWithIdToken(...)` with the token the native
sheet returns. There is no `/auth/callback`, no deep link, and no redirect.

## Bundle identifier

**The production bundle ID is `com.leviwiederhold.groundworkpro`.**

This is the identity of the already-shipped app. It is not a new identifier, and
it must not be changed — changing it creates an unrelated app that existing users
would not receive as an update, and invalidates the Apple/Google/Supabase
configuration below.

Verified against the Xcode archives on the release machine (all five archives,
most recently `App 5-12-26, 2.46 PM.xcarchive`), each of which records:

```
ApplicationProperties:CFBundleIdentifier = com.leviwiederhold.groundworkpro
```

It is set in exactly these places, which are asserted to agree by
`tests/unit/native-auth-config.test.ts`:

| Location | Setting |
| --- | --- |
| `ios/App/App.xcodeproj/project.pbxproj` (Debug + Release) | `PRODUCT_BUNDLE_IDENTIFIER` |
| `capacitor.config.ts` | `appId` |
| `src/lib/auth/nativeOAuth.ts` | `IOS_BUNDLE_ID` |

## Apple Developer

1. Use the **existing** production App ID `com.leviwiederhold.groundworkpro`
   (team `79NJ4256WZ`). Do not create a new App ID.
2. Enable the `Sign in with Apple` capability on that existing App ID.
3. Regenerate/download provisioning profiles after enabling the capability.

The app requests Apple's identity token with a nonce: the app sends
SHA-256(rawNonce) to Apple and the raw nonce to Supabase, which re-hashes and
compares. The `aud` claim of that token is the bundle ID above.

## Google Cloud

1. In the same Google Cloud project used for Supabase Google auth, create an
   OAuth client of type **iOS**.
2. Set its bundle ID to `com.leviwiederhold.groundworkpro`.
3. Copy the iOS client ID into `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` (Vercel) and
   `GOOGLE_IOS_CLIENT_ID` (Xcode, see below).
4. Copy the **iOS URL scheme** (the reversed client ID) into
   `GOOGLE_IOS_REVERSED_CLIENT_ID` (Xcode).
5. Keep the existing **Web application** OAuth client. Copy that web client ID
   into `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
6. If the OAuth consent screen is in Testing mode, add every test Google account
   under Audience > Test users.

The iOS and Web client IDs are two different OAuth clients. The app refuses to
start Google sign-in if they are equal, missing, or malformed.

## Vercel environment variables

The iOS app loads the deployed site (`https://ground-workpro.vercel.app`), so
these are read from the **Vercel build**, not from any local `.env` file. Next.js
inlines `NEXT_PUBLIC_*` at build time.

Add both variables to the Vercel project (Settings > Environment Variables), to
every environment the app can load — Production, and Preview if you test preview
builds on device:

```
NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID
NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID
```

**You must redeploy Vercel after adding or changing them.** Environment variables
are baked into the JavaScript bundle at build time; adding them without
triggering a new build leaves the shipped bundle with `undefined`, and Google
sign-in continues to fail with the "not configured for this build" error.

Neither value is a secret — an OAuth *client ID* is public and ships inside the
app binary. The Google **client secret** belongs only in Supabase, never in
Vercel `NEXT_PUBLIC_*` variables, the Xcode project, or this repository.

## Supabase

### Apple

1. Enable the Apple provider.
2. Add `com.leviwiederhold.groundworkpro` as an Apple **authorized client ID**.
   This is required because the native token's `aud` claim is the bundle ID.
3. Configure the Apple Services ID / team ID / key values Supabase requires for
   Apple auth.

### Google

1. Enable the Google provider.
2. Configure the **Web** OAuth client ID and its client secret. Supabase uses
   these for the standard web OAuth flow.
3. Add **both** client IDs to Supabase's Google **authorized client IDs** list:
   - the **Web** client ID
   - the **iOS** client ID

   This second entry is the one most easily missed. Supabase validates the `aud`
   claim of the ID token it is given. The token minted by the native iOS sheet
   has `aud` = the **iOS** client ID, not the Web client ID — so if only the Web
   client ID is registered, native Google sign-in fails with an audience
   mismatch even though web Google sign-in works perfectly. Registering both
   keeps web and native working simultaneously.

4. Do **not** add a native callback/deep link for this token exchange.

## Xcode / build configuration

Google client configuration is supplied through xcconfig files and reaches
`Info.plist` as `GIDClientID` and the `CFBundleURLSchemes` entry:

```
ios/Shared.xcconfig            <- defines GOOGLE_IOS_* (empty defaults)
  #include? Google.local.xcconfig   <- your real values (gitignored)
ios/debug.xcconfig             <- #include "Shared.xcconfig"
ios/release.xcconfig           <- #include "Shared.xcconfig"
```

Both `debug.xcconfig` and `release.xcconfig` include the same shared file, and
**both** the Debug and Release build configurations reference them in
`project.pbxproj`. This matters: previously only Debug had a
`baseConfigurationReference`, so Archive/TestFlight builds resolved
`$(GOOGLE_IOS_CLIENT_ID)` to an empty string and shipped an app with an empty
`GIDClientID` and an empty URL scheme — an app that installed and launched fine
but could never complete Google sign-in.

Local setup:

```sh
cp ios/Google.local.xcconfig.example ios/Google.local.xcconfig
# then fill in the two values from Google Cloud Console
```

`ios/Google.local.xcconfig` is gitignored. `Shared.xcconfig` pulls it in with the
optional `#include?` form, so a fresh clone still builds without it.

### Build-time guard

The `Validate Google Sign-In config` build phase runs
`ios/Scripts/validate-google-config.sh` on every build:

- **Release**: hard build **error** if either value is empty, or if
  `GOOGLE_IOS_REVERSED_CLIENT_ID` is not a `com.googleusercontent.apps.*` value
  or `GOOGLE_IOS_CLIENT_ID` is not a `*.apps.googleusercontent.com` value.
  Release therefore cannot silently build with an empty URL scheme.
- **Debug**: **warning** only, so unrelated work does not require Google setup.

### Checklist

1. Open `ios/App/App.xcodeproj`.
2. Confirm the App target bundle identifier is `com.leviwiederhold.groundworkpro`.
3. Confirm `CODE_SIGN_ENTITLEMENTS` is `App/App.entitlements` in Debug **and**
   Release, and that `App.entitlements` contains
   `com.apple.developer.applesignin`.
4. Confirm Signing & Capabilities lists `Sign in with Apple`.
5. Confirm both configurations resolve the Google values:

   ```sh
   xcodebuild -project ios/App/App.xcodeproj -target App \
     -configuration Release -showBuildSettings | grep GOOGLE_IOS
   ```

## Privacy manifest

`ios/App/App/PrivacyInfo.xcprivacy` declares this target's own data collection:
email address, name, user ID, precise location, and photos — each linked to the
user, none used for tracking, all for App Functionality. `NSPrivacyTracking` is
`false` and `NSPrivacyAccessedAPITypes` is empty, because the target's own Swift
code uses no required-reason APIs.

Third-party SDKs (Capacitor, GoogleSignIn-iOS, GTMSessionFetcher, AppAuth,
Alamofire) ship their own privacy manifests inside their frameworks; Apple
aggregates them into the App Store privacy report, so they are intentionally not
restated in this file.

## Swift package resolution

`ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`
is tracked in git so a fresh clone resolves the same native dependency versions
(GoogleSignIn-iOS, GTMSessionFetcher, AppAuth, AppCheck, GoogleUtilities,
Promises, Alamofire, Facebook SDK). Commit it whenever a Capacitor plugin is
added or upgraded.

## Testing against a PR preview deployment

The iOS app is a remote-URL shell: it loads a deployed site rather than bundling
the web app. Production (`https://ground-workpro.vercel.app`) does not contain
unmerged UI, so to test native auth from a PR you must point the app at that
PR's Vercel preview deployment.

Which deployment the app loads is baked into `ios/App/App/capacitor.config.json`
by `npx cap sync ios`, driven by `CAPACITOR_SERVER_URL`. Production remains the
default; nothing is hardcoded to a preview.

### 1. Find the PR preview URL

On the PR, open the Vercel bot comment or the "View deployment" link, or:

```sh
gh pr view 56 --json url
```

Use the bare origin — `https://<something>.vercel.app`, no path or query string.

### 2. Make sure Preview has the Google variables

Vercel scopes environment variables per environment. Variables set only for
Production are **absent** from Preview builds, so Google sign-in fails on a
preview with the "not configured for this build" error even though production
works.

In Vercel > Settings > Environment Variables, confirm both exist with the
**Preview** environment checked:

```
NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID
NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID
```

If you add them now, **redeploy the preview** — these are inlined at build time.

### 3. Sync the app to the preview

```sh
CAPACITOR_SERVER_URL=https://<pr-56-preview>.vercel.app pnpm ios:preview
```

Or persist it so you don't retype it each time:

```sh
cp .env.capacitor.local.example .env.capacitor.local
# edit CAPACITOR_SERVER_URL, then:
pnpm ios:preview
```

`.env.capacitor.local` is gitignored — preview URLs are branch-scoped and
short-lived, so they are never committed.

`ios:preview` requires the variable, rejects a malformed value, prints the URL
being synced, runs `cap sync ios`, and then **reads the generated config back**
to prove the URL actually landed. A successful run means the app really will
load that URL.

### 4. Build to a physical device

```sh
pnpm ios:open
```

Then in Xcode:

1. **Delete the existing Groundwork Pro app from the iPhone.** The WebView
   caches aggressively, and a stale install is the most common reason a "new"
   build appears to show the old login screen.
2. Product > Clean Build Folder (⇧⌘K).
3. Select your physical device and Run (⌘R). A Debug build on device is
   required — the native Apple/Google sheets do not work in the Simulator.

### 5. Confirm the app is on the preview

In the Xcode console, look for the debug-only diagnostics:

```
[Groundwork] Loading app at https://<preview>.vercel.app/?gw_native=1
[Groundwork] capacitor.config.json server.url: https://<preview>.vercel.app
[Groundwork] Bundle identifier: com.leviwiederhold.groundworkpro
[Groundwork] Native runtime detection: {"marker":true,"platform":"ios","capacitorNative":true,...}
```

If the URL is production, the sync did not take effect — re-run step 3 and
confirm the "Verified" line. If `marker` is `false`, the web app will not treat
this as a native runtime and the Apple/Google buttons will not render.

These logs are compiled out of Release builds and contain no tokens or secrets.

### 6. Return to production when done

```sh
pnpm ios:sync
```

`ios:sync` always targets production and ignores any `CAPACITOR_SERVER_URL` left
in your environment or `.env.capacitor.local`.

You do not have to remember this before shipping: the `Validate native build
config` build phase **fails any Release/archive build** whose synced URL is not
the production URL. To archive against another host deliberately, set
`ALLOW_NON_PRODUCTION_SERVER_URL=1`.

### Script reference

| Script | Purpose |
| --- | --- |
| `pnpm ios:preview` | Sync to `CAPACITOR_SERVER_URL` (required); verifies the result |
| `pnpm ios:sync` | Sync back to production; verifies the result |
| `pnpm ios:open` | Open the Xcode project |

## Real-device checks

Run these on a physical iPhone after the Apple/Google/Supabase setup is complete:

1. Returning Google user signs in and lands in the existing company.
2. Returning Apple user signs in and lands in the existing company.
3. Invited employee opens an invite, uses Apple or Google, accepts the invite
   once, and lands in the invited company.
4. A native social user is not asked for an email/password.
5. Cancelling each native provider sheet returns to the login screen without an
   error.
6. An Archive build (not just Debug) completes Google sign-in — this is the case
   the missing Release xcconfig used to break.
