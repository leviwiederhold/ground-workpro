# Device attendance credentials

Native attendance uses a device-scoped bearer credential because a headless iOS
Core Location launch has no WebView, session cookie, or signed-in JavaScript
runtime.

## Credential model

- The access token is scoped to attendance APIs, bound to one
  `(company, user, device)` record, SHA-256 hashed at rest, and valid for 30
  days.
- A separate refresh-only token is SHA-256 hashed at rest, stored in the iOS
  Keychain with `AfterFirstUnlockThisDeviceOnly`, and valid for 365 days. It can
  only rotate that row's attendance access token; it is not a Supabase token and
  cannot create a user session.
- Native iOS refreshes the access token three days before expiry and retries one
  failed request after a `401`. This runs without Capacitor or the WebView.
- Revoking the device row invalidates both tokens immediately. Logout revokes
  credentials and clears the Keychain. A revoked or refresh-expired device must
  be re-enrolled from an authenticated session; native code never self-enrolls.
- Existing builds have only the legacy access token. On the first native wake
  after installing this release, Swift uses that still-valid attendance bearer
  for a one-time, compare-and-set refresh upgrade. No WebView or sign-in is
  needed. If the old 30-day token expired before the updated app ever received
  a native wake, an authenticated re-enrollment is the recovery path.

The stable refresh secret survives a lost refresh response. Only the access
token is rotated, so a network interruption between the database update and the
phone's Keychain write cannot permanently strand the device.

## Endpoints

- `POST /api/attendance/device-credential` is session-authenticated and returns
  the access and refresh pair once.
- `POST /api/attendance/device-credential/refresh` accepts the refresh bearer
  and returns a new access token. It also accepts a still-valid legacy access
  bearer only while that credential has no refresh secret, allowing
  a headless one-time upgrade without replacing an established refresh token.
- `GET /api/attendance/monitoring-plan` accepts either a normal session or the
  device access bearer so native iOS can reconcile assignments headlessly.
- `POST /api/jobsite-time/events` accepts either a session or the device access
  bearer. Device requests get per-credential rate limiting, timestamp bounds,
  assignment/schedule checks, and replay-safe ingest auditing.
- `DELETE /api/attendance/device-credential` and logout revoke credentials.

Plaintext secrets never go into WebView storage, Capacitor Preferences, native
diagnostics, or attendance audit rows.

## Deployment order

Deploy `20260810_01_native_attendance_durability.sql` before the server routes.
It adds the refresh hash/expiry fields and replay response fields. Deploy the
server next, then distribute the iOS build. Reversing the first two steps can
make enrollment fail because the server would write columns that do not exist.
