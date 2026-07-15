# Native Google and Apple Sign-In Setup

Groundwork Pro's Capacitor app uses native provider ID tokens. Do not configure
native Google or Apple sign-in as browser redirect OAuth in the embedded WebView.

## Apple Developer

1. Use the iOS bundle ID `com.groundworkpro.app`.
2. Enable the `Sign in with Apple` capability on that App ID.
3. Regenerate/download provisioning profiles after enabling the capability.

## Google Cloud

1. In the same Google Cloud project used for Supabase Google auth, create an
   OAuth client of type `iOS`.
2. Set the iOS bundle ID to `com.groundworkpro.app`.
3. Copy the iOS client ID to `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
4. Copy the reversed iOS client ID to Xcode build setting
   `GOOGLE_IOS_REVERSED_CLIENT_ID`.
5. Keep the existing Web application OAuth client. Copy that web client ID to
   `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID`.
6. If the OAuth consent screen is in Testing mode, add every test Google account
   under Audience > Test users.

## Supabase

1. Enable Apple provider auth.
2. Add `com.groundworkpro.app` as the Apple authorized client ID.
3. Configure the Apple Services ID/team/key values required by Supabase for
   Apple auth.
4. Enable Google provider auth.
5. Configure the Google Web client ID and secret in Supabase.
6. Do not add a native callback/deep link for this token exchange. The app calls
   `supabase.auth.signInWithIdToken(...)` directly after the native sheet returns.

## Xcode / Environment

1. Open `ios/App/App.xcodeproj`.
2. Confirm the App target bundle identifier is `com.groundworkpro.app`.
3. Confirm the App target has `App/App.entitlements` as
   `CODE_SIGN_ENTITLEMENTS`.
4. Confirm Signing & Capabilities includes `Sign in with Apple`.
5. Set these build settings for local/archive builds:
   - `GOOGLE_IOS_CLIENT_ID`: the Google iOS OAuth client ID.
   - `GOOGLE_IOS_REVERSED_CLIENT_ID`: the reversed iOS client ID used as the URL
     scheme.
6. Set these public environment variables for the Next.js build served to the
   native app:
   - `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID`
   - `NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID`

No client secrets belong in the Capacitor app, Xcode project, or public
environment variables.

## Real-device checks

Run these on a physical iPhone after the Apple/Google/Supabase setup is complete:

1. Returning Google user signs in and lands in the existing company.
2. Returning Apple user signs in and lands in the existing company.
3. Invited employee opens an invite, uses Apple or Google, accepts the invite
   once, and lands in the invited company.
4. A native social user is not asked for an email/password.
5. Cancelling each native provider sheet returns to the login screen without an
   error.
