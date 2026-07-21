# Device attendance credentials (background-event authentication)

Lets the native app submit attendance events while backgrounded/closed — with no
WebView cookies — using a restricted, device-scoped bearer credential.

## Properties

- **Restricted:** scope is `attendance:events` only. The credential carries **no
  user password** and is **not** a general Supabase token — it authenticates
  attendance event submission and nothing else.
- **Bound:** to the authenticated `(company, user, device)`. Events for any other
  employee, company, job, or device are rejected (identity is taken from the
  credential; the job must be assigned to that employee in that company).
- **Hashed at rest:** only `sha256(token)` is stored. The plaintext is returned
  by the mint endpoint exactly once, for storage in the OS secure store.
- **Lifecycle:** expires (default 30d), rotates (mint revokes the device's prior
  active credential), can be revoked, and is cleaned up on logout.

## Endpoints

- `POST /api/attendance/device-credential` — session-authenticated. Body
  `{ deviceId, platform? }`. Mints/rotates and returns `{ token, expiresAt }`
  once.
- `DELETE /api/attendance/device-credential` — session-authenticated. Revokes
  this device's credential (or all of the user's when `deviceId` is omitted).
- Logout (`POST /api/logout`) revokes **all** of the user's device credentials
  before tearing down the session.

## Event authentication (`POST /api/jobsite-time/events`)

The route resolves identity from a bearer credential first, else the session
cookie. On the credential path it additionally enforces:

- **per-credential rate limiting**,
- **timestamp validation** (reject stale > 1h or future-skewed > 5m),
- **idempotency + audit**: an `attendance_event_audit` row keyed by a unique
  `credentialId|jobId|zone|transition|minute` key dedupes duplicate native
  deliveries and records who/what/when/outcome,
- the existing **assignment validation** (job must be assigned to the
  credential's employee) and **verified-coordinates** requirement.

A malformed/expired bearer returns `401` (it does not silently fall through to
the cookie path).

## Native secure storage (required; reference only in this PR)

The plaintext token MUST live in the **iOS Keychain** / **Android Keystore**, not
in WebView storage or Capacitor `Preferences`. The web layer hands the minted
token to a native secure-store plugin:

```
interface SecureAttendanceStore {
  setToken(opts: { token: string; expiresAt: string }): Promise<void>;
  clear(): Promise<void>;
}
```

The geofence plugin reads the token from the secure store when POSTing a
background event (`Authorization: Bearer <token>`). Implementing that native
secure store (Keychain/Keystore) and wiring it is part of finishing PR 9; it is
not verified here.

## Verification checklist (device)

- [ ] Enroll a device → token stored in Keychain/Keystore, never in JS storage.
- [ ] Background event authenticates with the credential (no cookies).
- [ ] Event for an unassigned job / another employee is rejected.
- [ ] Duplicate native delivery of the same transition dedupes (idempotency).
- [ ] Stale / future-dated event is rejected.
- [ ] Rotation revokes the prior credential; the old token stops working.
- [ ] Logout revokes the credential; the device can no longer submit events.
