# Native message push notifications

## Architecture

Message creation remains authoritative in the existing Next.js message route.
After the message and attachments are saved, the route inserts one durable
`message_push_jobs` row containing only the saved message/thread identity. The
provider call runs through Next.js `after()`, so it happens after the HTTP
response. A Supabase `pg_cron` call to `/api/push/dispatch` retries queued or
interrupted jobs every minute.

The worker re-reads the message, participants, current company memberships, and
enabled devices. It never accepts recipient IDs, preview copy, or an arbitrary
payload from a client. APNs/FCM responses are recorded per device; invalid
tokens are revoked and transient failures use bounded exponential retry.

`push_devices.platform` supports `ios` and `android`. iOS uses APNs directly;
Android uses FCM HTTP v1 through the same provider boundary, durable job table,
retry worker, delivery-attempt table, registration endpoint, and tap-routing
payload. There is no second Android notification architecture.

## Production configuration

Apply `supabase/migrations/20260808_02_native_message_push.sql`, then configure
these Vercel Production variables:

- `APNS_TEAM_ID`: Apple Developer Team ID.
- `APNS_KEY_ID`: identifier of a Push Notifications APNs auth key.
- `APNS_PRIVATE_KEY`: the complete `.p8` private key (literal newlines or `\n`
  escapes are accepted).
- `APNS_BUNDLE_ID`: `com.leviwiederhold.groundworkpro`.
- `FCM_PROJECT_ID`: Firebase/Google Cloud project ID.
- `FCM_CLIENT_EMAIL`: service-account email permitted to send FCM messages.
- `FCM_PRIVATE_KEY`: the complete service-account RSA private key (literal
  newlines or `\n` escapes are accepted).
- `PUSH_DISPATCH_SECRET`: a strong random secret used only by the retry worker.

For Android, register Firebase application ID `com.groundworkpro.app`, put the
downloaded (untracked) file at `android/app/google-services.json`, enable the
Firebase Cloud Messaging API, and give the Vercel service account only the
permission needed to send messages. The Capacitor plugin obtains and rotates
the FCM token; the existing `/api/push/devices` registration stores it in the
same private table used for iOS.

In Apple Developer Certificates, Identifiers & Profiles:

1. Enable Push Notifications for `com.leviwiederhold.groundworkpro`.
2. Create or select an APNs authentication key that can send for this app.
3. Regenerate/download the development and App Store provisioning profiles if
   automatic signing does not refresh them.

Run `scripts/setup-push-scheduler.sql` in the production Supabase SQL editor
after replacing its secret placeholder with the same `PUSH_DISPATCH_SECRET`.

## Physical verification

Install a new TestFlight build after the migration and server variables are
deployed. On two accounts that belong to the same company and conversation:

1. Allow notifications on the recipient iPhone and confirm a `push_devices`
   row is registered with environment `production`.
2. Background Groundwork Pro, send a message from the other account, and verify
   the alert title/preview.
3. Tap the alert and confirm the exact conversation opens.
4. Force-quit the app, repeat the send/tap test, and confirm cold-start routing.
5. Keep the conversation open in the foreground and verify no system banner or
   sound duplicates the in-app message refresh.
6. Revoke notification permission or uninstall/reinstall, then confirm APNs
   invalid-token responses disable stale registrations without affecting the
   saved message.
