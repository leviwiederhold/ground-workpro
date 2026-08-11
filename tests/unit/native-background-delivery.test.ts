import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

test("a Core Location relaunch restores the delegate and requests surviving region state", () => {
  const appDelegate = read("ios/App/App/AppDelegate.swift");
  const geofence = read("ios/App/App/JobsiteGeofencePlugin.swift");
  assert.match(appDelegate, /launchOptions\?\[\.location\] != nil \? "core_location"/);
  assert.match(geofence, /launchReason == "core_location"/);
  assert.match(
    geofence,
    /launchReason == "core_location"[\s\S]{0,700}manager\.monitoredRegions[\s\S]{0,500}manager\.requestState/,
  );
  assert.match(geofence, /persistedRegionState/);
  assert.match(geofence, /setPersistedRegionState/);
});

test("native delivery drains without Capacitor or a WebView", () => {
  const geofence = read("ios/App/App/JobsiteGeofencePlugin.swift");
  const appDelegate = read("ios/App/App/AppDelegate.swift");
  assert.match(geofence, /enum AttendanceNativeDelivery/);
  assert.match(geofence, /static func drain\(\)/);
  assert.match(geofence, /AttendanceNativeQueue\.pendingEvents\(\)/);
  assert.match(geofence, /AttendanceNativeQueue\.markDelivered/);
  assert.match(geofence, /AttendanceNativeQueue\.markFailed/);
  assert.match(geofence, /SecureAttendanceStorePlugin\.loadToken\(\)/);
  assert.match(appDelegate, /AttendanceGeofenceCoordinator\.shared\.start/);
  assert.ok(
    !geofence.slice(
      geofence.indexOf("enum AttendanceNativeDelivery"),
      geofence.indexOf("final class AttendanceGeofenceCoordinator"),
    ).includes("CAPPluginCall"),
    "native drain must not depend on a Capacitor bridge call",
  );
});

test("a native callback cannot report a successful queue write unless disk persistence succeeds", () => {
  const queue = read("ios/App/App/AttendanceNativeQueue.swift");
  const geofence = read("ios/App/App/JobsiteGeofencePlugin.swift");
  assert.match(queue, /private static func writeUnlocked[\s\S]{0,900}-> Bool/);
  assert.match(queue, /guard writeUnlocked\(payload\) else \{ return nil \}/);
  assert.match(
    geofence,
    /guard let eventId = AttendanceNativeQueue\.enqueue[\s\S]{0,700}code: "queue_write"[\s\S]{0,200}status: "failed"/,
  );
});

test("native diagnostics cover every required background lifecycle stage", () => {
  const source = read("ios/App/App/JobsiteGeofencePlugin.swift");
  for (const code of [
    "region_registered",
    "region_state_requested",
    "process_launch",
    "did_enter_region",
    "did_exit_region",
    "credential_loaded",
    "credential_load_failed",
    "queue_write",
    "http_attempt",
    "http_result",
  ]) {
    assert.ok(source.includes(`code: "${code}"`), `missing durable diagnostic ${code}`);
  }
  assert.match(source, /UserDefaults\.standard\.set\(records, forKey: key\)/);
  assert.match(source, /\/api\/attendance\/native-readiness/);
});

test("native readiness diagnostics are bearer-authenticated and employee-invisible", () => {
  const route = read("app/api/attendance/native-readiness/route.ts");
  const migration = read(
    "supabase/migrations/20260730_01_native_attendance_readiness.sql",
  );
  assert.match(route, /verifyAttendanceCredential/);
  assert.match(route, /attendance_native_diagnostics/);
  assert.doesNotMatch(route, /["'](?:latitude|longitude|coordinates)["']/);
  assert.match(
    migration,
    /alter table public\.attendance_native_diagnostics enable row level security/,
  );
  assert.doesNotMatch(
    migration,
    /create policy[\s\S]{0,160}attendance_native_diagnostics/,
  );
  for (const employeeSurface of [
    "app/components/location/LocationRequiredGate.tsx",
    "app/components/location/RequireLocationAccess.tsx",
  ]) {
    assert.ok(
      !read(employeeSurface).includes("attendance_native_diagnostics"),
      `${employeeSurface} must not render lifecycle diagnostics`,
    );
  }
});

test("CEO configured count and warnings share one setup-health payload", () => {
  const view = read("app/components/views/JobsiteTimeView.tsx");
  const card = read("app/components/views/AutoAttendanceSetupCard.tsx");
  const route = read("app/api/attendance/setup-health/route.ts");
  assert.equal(
    (view.match(/fetch\(["']\/api\/attendance\/setup-health["']/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(card, /fetch\(/);
  assert.match(view, /<AutoAttendanceSetupCard items=\{setupHealth\?\.items/);
  assert.match(view, /setupHealth\.items\s*\.filter\(\(item\) => !item\.healthy\)/);
  assert.doesNotMatch(view, /location-permission\?scope=company/);
  assert.match(route, /employeesResult\.error/);
  assert.match(route, /result\.error\.message/);
  assert.match(route, /Failed to load attendance setup health/);
  assert.match(route, /buildJobsiteRegions/);
});

test("a revoked server credential cannot masquerade as a healthy Keychain token", () => {
  const route = read("app/api/attendance/device-credential/route.ts");
  const client = read("src/lib/attendance/deviceCredentialClient.ts");
  const gate = read("app/components/location/LocationRequiredGate.tsx");
  const wrapper = read("app/components/location/RequireLocationAccess.tsx");
  assert.match(route, /export async function GET\(request: Request\)/);
  assert.match(route, /\.is\("revoked_at", null\)/);
  assert.match(route, /\.gt\("expires_at"/);
  assert.match(client, /hasActiveDeviceCredential/);
  assert.match(client, /await store\.clear\(\)/);
  assert.match(gate, /hasActiveDeviceCredential/);
  assert.match(wrapper, /hasActiveDeviceCredential/);
});
