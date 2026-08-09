import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeHealthToPermissionSnapshot } from "../../src/lib/attendance/backgroundLocationClient.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), "utf8");

test("Android release identity, API level, signing guard, and production start route are explicit", () => {
  const appGradle = read("android/app/build.gradle");
  const variables = read("android/variables.gradle");
  const capacitor = read("capacitor.config.ts");
  const serverUrl = read("src/lib/native/serverUrl.ts");

  assert.match(appGradle, /namespace = "com\.groundworkpro\.app"/);
  assert.match(appGradle, /applicationId "com\.groundworkpro\.app"/);
  assert.match(appGradle, /verifyReleaseSigning/);
  assert.match(appGradle, /verifyReleaseConfiguration/);
  assert.match(appGradle, /google-services\.json does not contain the release package/);
  assert.match(appGradle, /ANDROID_UPLOAD_STORE_FILE/);
  assert.match(appGradle, /ANDROID_VERSION_CODE/);
  assert.match(variables, /targetSdkVersion = 36/);
  assert.match(serverUrl, /https:\/\/ground-workpro\.vercel\.app/);
  assert.match(capacitor, /appStartPath: "\/native\?gw_native=1"/);
});

test("Android manifest declares release permissions without weakening storage or backup boundaries", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  const filePaths = read("android/app/src/main/res/xml/file_paths.xml");

  for (const permission of [
    "INTERNET",
    "POST_NOTIFICATIONS",
    "ACCESS_COARSE_LOCATION",
    "ACCESS_FINE_LOCATION",
    "ACCESS_BACKGROUND_LOCATION",
    "RECEIVE_BOOT_COMPLETED",
  ]) {
    assert.match(manifest, new RegExp(`android\\.permission\\.${permission}`));
  }
  assert.match(manifest, /android:allowBackup="false"/);
  assert.doesNotMatch(filePaths, /<external-path/);
});

test("terminated Android geofence delivery has a durable origin, device id, queue, and reboot lifetime", () => {
  const activity = read("android/app/src/main/java/com/groundworkpro/app/MainActivity.java");
  const receiver = read("android/app/src/main/java/com/groundworkpro/app/GeofenceBroadcastReceiver.kt");
  const queue = read("android/app/src/main/java/com/groundworkpro/app/AttendanceNativeQueue.kt");
  const boot = read("android/app/src/main/java/com/groundworkpro/app/BootReceiver.kt");

  assert.match(activity, /gw_server_base_url/);
  assert.match(activity, /CapConfig\.loadDefault/);
  assert.match(activity, /gw_device_id/);
  assert.match(receiver, /goAsync\(\)/);
  assert.match(receiver, /AttendanceNativeQueue\.enqueue/);
  assert.match(receiver, /\/api\/jobsite-time\/events/);
  assert.match(queue, /AtomicFile/);
  assert.match(boot, /val pending = goAsync\(\)/);
  assert.match(boot, /pending\.finish\(\)/);
});

test("Android native health reports the OS authorization gates used by CEO readiness", () => {
  const plugin = read("android/app/src/main/java/com/groundworkpro/app/JobsiteGeofencePlugin.kt");
  const runtime = read("app/components/location/LocationBackgroundRuntime.tsx");
  const readinessRoute = read("app/api/attendance/native-readiness/route.ts");
  const credentials = read("src/lib/attendance/deviceCredentialServer.ts");
  for (const field of [
    "authorizationStatus",
    "locationServicesEnabled",
    "backgroundRefreshEnabled",
    "preciseLocation",
  ]) {
    assert.match(plugin, new RegExp(`put\\(\"${field}\"`));
  }
  assert.match(plugin, /requestAlwaysAuthorization/);
  assert.match(plugin, /ACTION_APPLICATION_DETAILS_SETTINGS/);
  assert.match(plugin, /geofenceAuthorizationChanged/);
  assert.match(runtime, /ensureDeviceCredential\(getCapacitorNativePlatform\(\) \?\? 'ios'\)/);
  assert.doesNotMatch(runtime, /ensureDeviceCredential\('ios'\)/);
  assert.match(credentials, /device_id, platform, scope/);
  assert.match(readinessRoute, /platform: credential\.platform \?\? "unknown"/);
  assert.doesNotMatch(readinessRoute, /platform: "ios"/);

  const capturedAt = "2026-08-09T12:00:00.000Z";
  const snapshot = nativeHealthToPermissionSnapshot(
    {
      authorizationStatus: "authorized_always",
      locationServicesEnabled: true,
      preciseLocation: true,
    },
    "android",
    capturedAt,
  );
  assert.deepEqual(snapshot, {
    locationServicesEnabled: true,
    foreground: "granted",
    background: "granted",
    precise: true,
    platform: "android",
    capturedAt,
  });
});

test("Android credentials stay in Keystore and Firebase configuration stays untracked", () => {
  const secureStore = read("android/app/src/main/java/com/groundworkpro/app/SecureAttendanceStorePlugin.kt");
  const ignore = read("android/.gitignore");
  assert.match(secureStore, /AndroidKeyStore/);
  assert.match(secureStore, /AES\/GCM\/NoPadding/);
  assert.match(ignore, /google-services\.json/);
  assert.match(ignore, /\*\.jks/);
  assert.match(ignore, /keystore\.properties/);
});

test("Play account deletion is authenticated, explicit, owner-guarded, and linked publicly", () => {
  const route = read("app/api/account/route.ts");
  const settings = read("app/settings/account/AccountSettingsClient.tsx");
  const publicPage = read("app/account-deletion/page.tsx");
  const privacy = read("app/privacy/page.tsx");

  assert.match(route, /z\.literal\("DELETE"\)/);
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /ACTIVE_SUBSCRIPTION_STATUSES/);
  assert.match(route, /admin\.auth\.admin\.deleteUser\(user\.id, false\)/);
  assert.match(settings, /fetch\("\/api\/account", \{/);
  assert.match(settings, /Type DELETE to confirm/);
  assert.match(publicPage, /Delete your Groundwork Pro account/);
  assert.match(privacy, /href="\/account-deletion"/);
});
