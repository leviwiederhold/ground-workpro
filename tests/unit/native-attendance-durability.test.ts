import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

test("attendance credential and server context are available before WebView startup", () => {
  const appDelegate = read("ios/App/App/AppDelegate.swift");
  const native = read("ios/App/App/JobsiteGeofencePlugin.swift");
  const configure = appDelegate.indexOf("configureAttendanceBackgroundContext()", appDelegate.indexOf("didFinishLaunching"));
  const coordinator = appDelegate.indexOf("AttendanceGeofenceCoordinator.shared.start", configure);
  const webView = appDelegate.indexOf("configureWebViewBackground", coordinator);
  assert.ok(configure >= 0 && coordinator > configure && webView > coordinator);
  assert.match(native, /AttendanceNativeCredentialRefresher[\s\S]*loadRefreshToken/);
  assert.match(native, /device-credential\/refresh/);
  assert.match(native, /storedRefreshToken \?\? legacyAccessToken/);
  assert.match(native, /saveCredential/);
  const refreshRoute = read("app/api/attendance/device-credential/refresh/route.ts");
  assert.match(refreshRoute, /bootstrapLegacyAttendanceRefreshCredential/);
  assert.match(refreshRoute, /verifyAttendanceCredential/);
});

test("persisted and server-assigned regions self-heal without authenticated JavaScript", () => {
  const native = read("ios/App/App/JobsiteGeofencePlugin.swift");
  const plan = read("app/api/attendance/monitoring-plan/route.ts");
  assert.match(native, /restorePersistedRegions\(\)/);
  assert.match(native, /gw_desired_attendance_regions_v1/);
  assert.match(native, /startMonitoringSignificantLocationChanges\(\)/);
  assert.match(native, /didUpdateLocations[\s\S]*AttendanceNativePlanSync\.sync/);
  assert.match(native, /api\/attendance\/monitoring-plan/);
  assert.match(plan, /verifyAttendanceCredential/);
  assert.match(plan, /hasMonitorableJob && assignedJob/);
});

test("headless enter, exit, and same-day re-entry stay in the native queue path", () => {
  const native = read("ios/App/App/JobsiteGeofencePlugin.swift");
  const lifecycle = read("src/lib/attendance/geofenceEvent.ts");
  assert.match(native, /didEnterRegion[\s\S]*handleTransition\(region: region, transition: "enter"\)/);
  assert.match(native, /didExitRegion[\s\S]*handleTransition\(region: region, transition: "exit"\)/);
  assert.match(native, /handleTransition[\s\S]*AttendanceNativeDelivery\.enqueueAndDrain/);
  assert.match(lifecycle, /card\.clockInAt && card\.clockOutAt[\s\S]*kind: "open_session"/);
});

test("rejected native attempts replay their real status instead of a false duplicate success", () => {
  const route = read("app/api/jobsite-time/events/route.ts");
  const migration = read("supabase/migrations/20260810_01_native_attendance_durability.sql");
  assert.match(route, /result: "processing"/);
  assert.match(route, /previous\.data\.result === "processing"/);
  assert.match(route, /claimAgeMs < 2 \* 60 \* 1000/);
  assert.match(route, /response_reason: "recovered_stale_claim"/);
  assert.match(route, /priorStatus >= 400/);
  assert.match(route, /finishAudit\("rejected"/);
  assert.match(read("ios/App/App/JobsiteGeofencePlugin.swift"), /status != 408 && status != 409 && status != 429/);
  assert.match(read("ios/App/App/AttendanceNativeQueue.swift"), /static func markQuarantined/);
  assert.match(migration, /response_status/);
  assert.match(migration, /response_reason/);
});

test("foreground reconciliation remains an explicitly attributed recovery fallback", () => {
  const runtime = read("app/components/location/LocationBackgroundRuntime.tsx");
  const route = read("app/api/jobsite-time/events/route.ts");
  assert.match(runtime, /const reconcileForeground/);
  assert.match(route, /foreground_reconciliation/);
  assert.match(route, /viaToken[\s\S]*native_geofence/);
});
