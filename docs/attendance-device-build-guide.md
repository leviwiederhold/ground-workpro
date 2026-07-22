# Building the attendance test app for a physical device

Read this before installing anything. **The most likely way to waste a device
testing session is to build this branch and test production by accident.**

## The trap

The iOS and Android apps are **remote-URL Capacitor shells**. They do not bundle
the web app — they load a deployed website. Right now both projects on this
branch are synced to:

```
server.url: https://ground-workpro.vercel.app     ← PRODUCTION
```

So building `attendance-native-test` and installing it gives you:

- ✅ the native plugins from this branch (they are compiled into the binary), but
- ❌ **production's web app and production's API**, which has none of the
  attendance backend — no `/api/attendance/reconcile`, no monitoring plan, no
  new schema, and nothing that calls the plugins.

The app would launch, register the plugins, and then sit there doing nothing,
because the site it loaded has no idea they exist. Every result would be
meaningless and the cause would not be obvious.

## What to do instead

### 1. Deploy this branch

Push `attendance-native-test` (done) and let Vercel build a preview, or:

```bash
vercel --prebuilt          # or however you normally cut a preview
```

Note the preview URL, e.g. `https://ground-workpro-git-attendance-native-test-….vercel.app`.

### 2. Apply the migrations to whatever database that preview uses

Six migrations, in filename order:

```
20260720_03_automatic_attendance_settings.sql
20260720_04_employee_location_permissions.sql
20260720_05_device_attendance_credentials.sql
20260721_01_attendance_scheduled_clock_in.sql
20260721_02_attendance_departure_clock_out.sql
20260721_03_attendance_audit_corrections.sql
```

Order matters: `_01` and `_02` each rewrite the
`jobsite_timecard_events.event_type` check constraint, and `_02` carries the
union. Applying `_01` after `_02` would silently drop five event types and every
departure event would fail its constraint.

⚠️ **Do not point the preview at production data.** `20260721_03` installs
append-only triggers that permanently change delete behavior — see
[`attendance-deployment-checklist.md`](./attendance-deployment-checklist.md).

### 3. Set up the scheduler for that environment

Without it **nothing clocks anyone in**, and the regression scenario cannot
pass:

- Set `ATTENDANCE_SCHEDULER_SECRET` in the preview's environment.
- Run [`scripts/setup-attendance-scheduler.sql`](../scripts/setup-attendance-scheduler.sql)
  against that database, pointing at the preview URL.
- Confirm rows are appearing:
  ```sql
  select started_at, trigger, candidates, clocked_in from attendance_scheduler_runs
  order by started_at desc limit 5;
  ```

### 4. Point the native builds at the preview

**iOS** — this script verifies the URL actually landed in the generated config,
rather than trusting `cap sync`'s exit code:

```bash
CAPACITOR_SERVER_URL=https://<your-preview>.vercel.app pnpm ios:preview
pnpm cap:open:ios      # then Run on the device
```

**Android** — no preview wrapper exists yet, so sync directly:

```bash
CAPACITOR_SERVER_URL=https://<your-preview>.vercel.app pnpm exec cap sync android
grep -o '"url":"[^"]*"' android/app/src/main/assets/capacitor.config.json   # VERIFY
pnpm cap:open:android  # then Run on the device
```

Then **check the config actually changed** before installing:

```bash
grep -o '"url": *"[^"]*"' ios/App/App/capacitor.config.json
grep -o '"url":"[^"]*"' android/app/src/main/assets/capacitor.config.json
```

Both must show the preview URL, not `ground-workpro.vercel.app`.

### 5. Smoke-test the bridge before anything else

On device, with Safari Web Inspector (iOS) or `chrome://inspect` (Android):

```js
Object.keys(window.Capacitor.Plugins)
// must include: JobsiteGeofence, AttendanceQueueStore, SecureAttendanceStore
```

If any is missing, **stop** — registration has regressed and no other result in
the test plan means anything.

Then confirm the native layer reports real state:

```js
await window.Capacitor.Plugins.JobsiteGeofence.getHealth()
// { supported: true, authorized: …, registeredCount: …, hasCredential: …, pendingQueuedCount: 0 }
```

`hasCredential: false` after granting permissions means enrollment failed — the
secure store is not working, and background submission will not authenticate.

### 6. Then run the test plan

[`attendance-device-test-plan.md`](./attendance-device-test-plan.md).

## Restoring production afterwards

```bash
pnpm ios:sync                                   # back to production
pnpm exec cap sync android                      # ditto
```

Do not leave a device build pointing at a preview and forget about it.

## Android build note

Gradle 8.14.3 rejects JDK 25, which is the default on at least one machine here.
If `./gradlew` fails with `Unsupported class file major version 69`:

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 21) ./gradlew :app:assembleDebug
```
