// Guards against the failure mode PR 16 uncovered: native attendance code that
// exists on disk, is never compiled, and therefore silently does nothing while
// both native builds report success.
//
// These are file-content assertions, not compilation. They cannot prove the
// native code is correct — only that it is still WIRED IN. That is exactly the
// property that was missing and that no other test could see: `xcodebuild` and
// `gradlew` both said BUILD SUCCEEDED while ignoring every attendance source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

/**
 * Source with `//` comments removed.
 *
 * Every assertion about what a file must NOT contain has to run against code,
 * not prose — these files explain the traps they avoid by naming them, and a
 * naive substring check would flag the explanation as the offence.
 */
const code = (rel: string) =>
  read(rel)
    .split("\n")
    .map((line) => {
      const marker = line.indexOf("//");
      return marker === -1 ? line : line.slice(0, marker);
    })
    .join("\n");

// ── iOS ──────────────────────────────────────────────────────────────────────

const IOS_PLUGIN_SOURCES = [
  "AttendanceNativeQueue.swift",
  "GroundworkBridgeViewController.swift",
  "JobsiteGeofencePlugin.swift",
  "AttendanceQueueStorePlugin.swift",
  "SecureAttendanceStorePlugin.swift",
];

test("every iOS attendance source exists", () => {
  for (const name of IOS_PLUGIN_SOURCES) {
    assert.ok(existsSync(join(repoRoot, "ios/App/App", name)), `${name} is missing`);
  }
});

test("every iOS attendance source is in the Xcode target's Sources phase", () => {
  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");
  const sourcesPhase = pbxproj.slice(
    pbxproj.indexOf("Begin PBXSourcesBuildPhase"),
    pbxproj.indexOf("End PBXSourcesBuildPhase")
  );
  for (const name of IOS_PLUGIN_SOURCES) {
    // A file reference alone is NOT enough — a file can be in the project
    // navigator and still never reach the compiler. Membership in the Sources
    // build phase is the property that matters.
    assert.ok(
      sourcesPhase.includes(`${name} in Sources`),
      `${name} is not compiled by the App target (this is how the plugins shipped as dead code)`
    );
  }
});

test("iOS plugins declare Capacitor registration", () => {
  // Capacitor 6+ registers Swift plugins via CAPBridgedPlugin. Without it the
  // class compiles, ships, and is never registered — Capacitor.Plugins.X stays
  // undefined at runtime.
  const expectations: Array<[string, string]> = [
    ["ios/App/App/JobsiteGeofencePlugin.swift", "JobsiteGeofence"],
    ["ios/App/App/AttendanceQueueStorePlugin.swift", "AttendanceQueueStore"],
    ["ios/App/App/SecureAttendanceStorePlugin.swift", "SecureAttendanceStore"],
  ];
  for (const [path, jsName] of expectations) {
    const source = read(path);
    assert.ok(source.includes("CAPBridgedPlugin"), `${path} does not conform to CAPBridgedPlugin`);
    assert.ok(source.includes(`jsName = "${jsName}"`), `${path} does not expose jsName "${jsName}"`);
    assert.ok(source.includes("pluginMethods"), `${path} declares no pluginMethods`);
  }
});

test("the iOS bridge explicitly registers every app-target attendance plugin", () => {
  const bridge = read("ios/App/App/GroundworkBridgeViewController.swift");
  for (const plugin of [
    "JobsiteGeofencePlugin",
    "AttendanceQueueStorePlugin",
    "SecureAttendanceStorePlugin",
  ]) {
    assert.ok(
      bridge.includes(`registerPluginInstance(${plugin}())`),
      `${plugin} is compiled but never registered with the Capacitor bridge`,
    );
  }

  const storyboard = read("ios/App/App/Base.lproj/Main.storyboard");
  assert.ok(
    storyboard.includes('customClass="GroundworkBridgeViewController"'),
    "the registered bridge controller is not the app's startup controller",
  );
});

test("iOS declares the location usage descriptions background monitoring needs", () => {
  const plist = read("ios/App/App/Info.plist");
  // "Always" is the one that matters: WhenInUse alone cannot deliver a region
  // transition with the app closed, which is the entire feature.
  assert.ok(plist.includes("NSLocationAlwaysAndWhenInUseUsageDescription"));
  assert.ok(plist.includes("NSLocationWhenInUseUsageDescription"));
  assert.ok(plist.includes("UIBackgroundModes"));
  assert.equal(
    (plist.match(/Groundwork Pro uses location for accuracy\./g) ?? []).length,
    3,
    "all location permission prompts must use neutral approved wording",
  );
});

test("iOS exposes the authorization details required for setup completion", () => {
  const source = read("ios/App/App/JobsiteGeofencePlugin.swift");
  assert.match(source, /CAPPluginMethod\(name: "requestAlwaysAuthorization"/);
  assert.match(source, /manager\.requestAlwaysAuthorization\(\)/);
  assert.match(source, /"authorized_when_in_use"/);
  assert.match(source, /"authorized_always"/);
  assert.match(source, /CLLocationManager\.locationServicesEnabled\(\)/);
  assert.match(source, /manager\.accuracyAuthorization == \.fullAccuracy/);
});

test("iOS never uses a background URLSession for a data task", () => {
  // URLSessionConfiguration.background rejects dataTask — the request is never
  // sent and nothing reports an error. The original implementation did exactly
  // this, so every background attendance POST silently vanished.
  assert.ok(
    !/URLSessionConfiguration\.background/.test(code("ios/App/App/JobsiteGeofencePlugin.swift")),
    "background URLSession configurations cannot carry data tasks"
  );
});

// ── Android ──────────────────────────────────────────────────────────────────

const ANDROID_SOURCES = [
  "AttendanceNativeQueue.kt",
  "JobsiteGeofencePlugin.kt",
  "AttendanceQueueStorePlugin.kt",
  "SecureAttendanceStorePlugin.kt",
  "GeofenceBroadcastReceiver.kt",
  "BootReceiver.kt",
];

test("every Android attendance source exists", () => {
  for (const name of ANDROID_SOURCES) {
    assert.ok(
      existsSync(join(repoRoot, "android/app/src/main/java/com/groundworkpro/app", name)),
      `${name} is missing`
    );
  }
});

test("the Android app module applies the Kotlin plugin", () => {
  // Without it Gradle SILENTLY skips every .kt file and still reports
  // BUILD SUCCESSFUL. That is precisely how six Kotlin sources shipped as dead
  // code while the build looked healthy.
  const appGradle = read("android/app/build.gradle");
  assert.match(appGradle, /apply plugin: 'org\.jetbrains\.kotlin\.android'/);

  const rootGradle = read("android/build.gradle");
  assert.match(rootGradle, /kotlin-gradle-plugin/);
});

test("Android declares the geofencing dependency", () => {
  assert.match(read("android/app/build.gradle"), /play-services-location/);
});

test("Android registers all three attendance plugins with Capacitor", () => {
  const mainActivity = code("android/app/src/main/java/com/groundworkpro/app/MainActivity.java");
  for (const plugin of [
    "JobsiteGeofencePlugin",
    "AttendanceQueueStorePlugin",
    "SecureAttendanceStorePlugin",
  ]) {
    assert.ok(
      mainActivity.includes(`registerPlugin(${plugin}.class)`),
      `${plugin} is never registered — Capacitor.Plugins would resolve to undefined`
    );
  }
  // Registration after super.onCreate() is too late: the bridge is already built.
  const registerIndex = mainActivity.indexOf("registerPlugin(");
  const superIndex = mainActivity.indexOf("super.onCreate");
  assert.ok(registerIndex >= 0 && registerIndex < superIndex, "plugins must be registered before super.onCreate");
});

test("the Android manifest grants what background geofencing requires", () => {
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  // Without ACCESS_BACKGROUND_LOCATION the platform silently drops transitions
  // once the app is closed — the failure is invisible at runtime.
  assert.ok(manifest.includes("android.permission.ACCESS_BACKGROUND_LOCATION"));
  assert.ok(manifest.includes("android.permission.ACCESS_FINE_LOCATION"));
  assert.ok(manifest.includes(".GeofenceBroadcastReceiver"), "the transition receiver must be declared");
  // Android clears geofences on reboot; without this, monitoring silently ends.
  assert.ok(manifest.includes(".BootReceiver"), "the boot receiver must be declared");
  assert.ok(manifest.includes("android.intent.action.BOOT_COMPLETED"));
});

test("the geofence PendingIntent stays mutable where the flag exists", () => {
  // The geofencing API fills transition details into this intent. FLAG_IMMUTABLE
  // would deliver empty events — a silent, data-losing failure.
  const source = code("android/app/src/main/java/com/groundworkpro/app/JobsiteGeofencePlugin.kt");
  assert.ok(source.includes("FLAG_MUTABLE"));
  assert.ok(!source.includes("FLAG_IMMUTABLE"));
  // …and it must be version-guarded, since FLAG_MUTABLE only exists from API 31.
  assert.ok(source.includes("Build.VERSION_CODES.S"));
});

// ── Both platforms feed the same queue ───────────────────────────────────────

test("native transitions are queued rather than dropped when they cannot be sent", () => {
  // This is what makes "native enter/exit events reach the offline queue" true:
  // a failed POST appends to the same file the JS layer flushes, instead of
  // vanishing.
  const swift = read("ios/App/App/JobsiteGeofencePlugin.swift");
  assert.ok(swift.includes("AttendanceNativeQueue.enqueue"), "iOS drops failed transitions");

  const kotlin = read("android/app/src/main/java/com/groundworkpro/app/GeofenceBroadcastReceiver.kt");
  assert.ok(kotlin.includes("AttendanceNativeQueue.enqueue"), "Android drops failed transitions");
});

test("both platforms share ONE queue file with the JS layer", () => {
  // Two queues would mean diagnostics report two different depths and neither
  // is the truth.
  assert.ok(read("ios/App/App/AttendanceQueueStorePlugin.swift").includes("AttendanceNativeQueue.fileURL"));
  assert.ok(
    read("android/app/src/main/java/com/groundworkpro/app/AttendanceQueueStorePlugin.kt")
      .includes("AttendanceNativeQueue.queueFile")
  );
  // The filename the JS storage adapter documents must match both natives.
  for (const rel of [
    "ios/App/App/AttendanceNativeQueue.swift",
    "android/app/src/main/java/com/groundworkpro/app/AttendanceNativeQueue.kt",
  ]) {
    assert.ok(read(rel).includes("attendance-queue.json"), `${rel} uses a different queue file`);
  }
});

test("the queue shape written natively matches the JS schema version", () => {
  const jsVersion = read("src/lib/attendance/offlineQueue.ts").match(/QUEUE_SCHEMA_VERSION = (\d+)/)?.[1];
  assert.ok(jsVersion, "could not read the JS schema version");
  assert.ok(read("ios/App/App/AttendanceNativeQueue.swift").includes(`schemaVersion = ${jsVersion}`));
  assert.ok(
    read("android/app/src/main/java/com/groundworkpro/app/AttendanceNativeQueue.kt")
      .includes(`SCHEMA_VERSION = ${jsVersion}`)
  );
});

test("the native secure store is the credential's only home", () => {
  // Reading the token from UserDefaults/SharedPreferences would put a bearer
  // credential in world-readable-ish storage. Both platforms must go through
  // the Keychain/Keystore.
  const swift = code("ios/App/App/JobsiteGeofencePlugin.swift");
  assert.ok(swift.includes("SecureAttendanceStorePlugin.loadToken"));
  assert.ok(!swift.includes('UserDefaults.standard.string(forKey: "gw_attendance_token")'));

  const kotlin = code("android/app/src/main/java/com/groundworkpro/app/GeofenceBroadcastReceiver.kt");
  assert.ok(kotlin.includes("SecureAttendanceStorePlugin.loadToken"));
  assert.ok(!kotlin.includes('prefs.getString("gw_attendance_token"'));
});

// ── Scheduler configuration ──────────────────────────────────────────────────

test("vercel.json declares no sub-daily cron", () => {
  // This project is on Vercel Hobby, where cron is capped at once per day.
  // A `crons` entry at "* * * * *" would look configured, be silently
  // downgraded or rejected, and clock nobody in — the exact failure mode this
  // whole stack exists to avoid. The scheduler runs from Supabase pg_cron
  // instead (scripts/setup-attendance-scheduler.sql).
  const vercel = JSON.parse(read("vercel.json")) as { crons?: Array<{ schedule?: string }> };
  const crons = vercel.crons ?? [];
  for (const cron of crons) {
    assert.ok(
      /^0 \d+ \* \* \*$|^@daily$/.test(String(cron.schedule ?? "")),
      `Hobby cannot run "${cron.schedule}" — use the pg_cron scheduler instead`
    );
  }
});

test("the pg_cron setup script targets the reconcile route every minute", () => {
  const sql = read("scripts/setup-attendance-scheduler.sql");
  assert.ok(sql.includes("/api/attendance/reconcile"), "the scheduler must target the reconcile route");
  assert.ok(sql.includes("'* * * * *'"), "attendance reconciliation must run every minute");
  // The secret must not be inlined into the cron command, where anyone able to
  // read cron.job could see it.
  assert.ok(
    !/cron\.schedule\([^)]*secret/i.test(sql),
    "the scheduler secret must not appear in the cron command"
  );
});
