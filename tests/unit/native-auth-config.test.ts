import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { IOS_BUNDLE_ID, validateGoogleClientConfig } from "../../src/lib/auth/nativeOAuth.ts";

// Source-level regression tests for the native-auth build configuration.
//
// These guard the failure mode that motivated them: a Release/Archive build that
// compiles, installs, and launches perfectly but ships an empty Google URL
// scheme, so sign-in fails only on a real device. Unit tests can't build an
// .ipa, but they CAN assert that the wiring which makes Release resolve the
// values is still present.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const PRODUCTION_BUNDLE_ID = "com.leviwiederhold.groundworkpro";

// Whether git tracks a path. Local files holding real credentials are expected
// to EXIST on a configured machine — what must never happen is them being
// committed, which is what this checks.
function trackedByGit(relativePath: string): boolean {
  const output = execFileSync("git", ["ls-files", "--", relativePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return output.trim().length > 0;
}

// ── Bundle identity ──────────────────────────────────────────────────────────
// The shipped app is com.leviwiederhold.groundworkpro (verified against the
// Xcode archives). A silent change here creates an unrelated app identity and
// invalidates the Apple/Google/Supabase configuration.
test("production bundle ID is consistent across pbxproj, capacitor config, and app code", () => {
  assert.equal(IOS_BUNDLE_ID, PRODUCTION_BUNDLE_ID);

  const capacitorConfig = read("capacitor.config.ts");
  assert.match(
    capacitorConfig,
    new RegExp(`appId:\\s*"${PRODUCTION_BUNDLE_ID.replace(/\./g, "\\.")}"`),
    "capacitor.config.ts appId must match the production bundle ID",
  );

  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");
  const bundleIds = [...pbxproj.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) =>
    m[1].trim(),
  );
  assert.ok(bundleIds.length >= 2, "expected Debug and Release bundle identifiers");
  for (const id of bundleIds) {
    assert.equal(id, PRODUCTION_BUNDLE_ID, "every build configuration must use the production bundle ID");
  }
});

// ── xcconfig wiring: the actual Release bug ──────────────────────────────────
test("release.xcconfig exists and shares Google config with debug.xcconfig", () => {
  assert.ok(existsSync(join(repoRoot, "ios/release.xcconfig")), "ios/release.xcconfig must exist");
  assert.ok(existsSync(join(repoRoot, "ios/Shared.xcconfig")), "ios/Shared.xcconfig must exist");

  for (const file of ["ios/debug.xcconfig", "ios/release.xcconfig"]) {
    assert.match(read(file), /#include "Shared\.xcconfig"/, `${file} must include Shared.xcconfig`);
  }

  const shared = read("ios/Shared.xcconfig");
  for (const key of ["GOOGLE_IOS_CLIENT_ID", "GOOGLE_IOS_REVERSED_CLIENT_ID"]) {
    assert.match(shared, new RegExp(`^${key}\\s*=`, "m"), `Shared.xcconfig must define ${key}`);
  }
  assert.match(
    shared,
    /#include\? "Google\.local\.xcconfig"/,
    "Shared.xcconfig must optionally include the untracked local overrides",
  );
});

test("BOTH Debug and Release build configurations reference an xcconfig", () => {
  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");

  // Each XCBuildConfiguration block ends with `name = Debug;` / `name = Release;`.
  const blocks = [...pbxproj.matchAll(/isa = XCBuildConfiguration;([\s\S]*?)name = (Debug|Release);/g)];
  assert.equal(blocks.length, 4, "expected project-level and target-level Debug + Release");

  for (const [, body, name] of blocks) {
    assert.match(
      body,
      /baseConfigurationReference = [0-9A-F]{24} \/\* (debug|release)\.xcconfig \*\//,
      `the ${name} configuration must have a baseConfigurationReference — without it, ` +
        `$(GOOGLE_IOS_*) expands to empty and the build silently ships a broken URL scheme`,
    );
  }

  const releaseRefs = blocks.filter(([, body, name]) => name === "Release" && /release\.xcconfig/.test(body));
  assert.equal(releaseRefs.length, 2, "both Release configurations must use release.xcconfig");
});

// ── URL scheme plumbing ──────────────────────────────────────────────────────
test("Info.plist feeds the reversed client ID into CFBundleURLSchemes and GIDClientID", () => {
  const infoPlist = read("ios/App/App/Info.plist");
  assert.match(infoPlist, /<key>CFBundleURLSchemes<\/key>/);
  assert.match(
    infoPlist,
    /<string>\$\(GOOGLE_IOS_REVERSED_CLIENT_ID\)<\/string>/,
    "the URL scheme must come from the build setting",
  );
  assert.match(
    infoPlist,
    /<key>GIDClientID<\/key>\s*<string>\$\(GOOGLE_IOS_CLIENT_ID\)<\/string>/,
    "GIDClientID must come from the build setting",
  );
});

test("a build phase blocks Release builds with an empty Google URL scheme", () => {
  const script = "ios/Scripts/validate-google-config.sh";
  assert.ok(existsSync(join(repoRoot, script)), `${script} must exist`);

  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.match(pbxproj, /PBXShellScriptBuildPhase/, "the validation phase must be registered");
  assert.match(pbxproj, /validate-google-config\.sh/, "the phase must run the validation script");

  const body = read(script);
  assert.match(body, /GOOGLE_IOS_REVERSED_CLIENT_ID/);
  assert.match(body, /CONFIGURATION.*Release/, "Release must be treated differently from Debug");
  assert.match(body, /exit 1/, "Release must fail the build, not just warn");
});

// ── Apple ────────────────────────────────────────────────────────────────────
test("Sign in with Apple entitlement is wired for both configurations", () => {
  const entitlements = read("ios/App/App/App.entitlements");
  assert.match(entitlements, /com\.apple\.developer\.applesignin/);

  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");
  const entitlementRefs = [...pbxproj.matchAll(/CODE_SIGN_ENTITLEMENTS = ([^;]+);/g)];
  assert.equal(entitlementRefs.length, 2, "Debug and Release must both set CODE_SIGN_ENTITLEMENTS");
  for (const [, value] of entitlementRefs) {
    assert.equal(value.trim(), "App/App.entitlements");
  }
});

// ── No committed secrets ─────────────────────────────────────────────────────
test("no real Google credentials are committed", () => {
  // The property that matters is that the file is not TRACKED — a correctly
  // configured machine always has it on disk with real values.
  assert.equal(
    trackedByGit("ios/Google.local.xcconfig"),
    false,
    "ios/Google.local.xcconfig holds real client IDs and must never be tracked",
  );
  assert.match(read("ios/.gitignore"), /^Google\.local\.xcconfig$/m);

  // The template must contain only obvious placeholders, never a client secret.
  const example = read("ios/Google.local.xcconfig.example");
  assert.match(example, /000000000000-a+\.apps\.googleusercontent\.com/);
  assert.doesNotMatch(example, /GOCSPX-/, "a Google client secret must never be committed");

  for (const file of ["ios/Shared.xcconfig", "ios/debug.xcconfig", "ios/release.xcconfig"]) {
    assert.doesNotMatch(read(file), /GOCSPX-/, `${file} must not contain a client secret`);
    assert.doesNotMatch(
      read(file),
      /^GOOGLE_IOS_CLIENT_ID\s*=\s*\d/m,
      `${file} must not hardcode a real client ID`,
    );
  }
});

// ── Privacy manifest ─────────────────────────────────────────────────────────
test("privacy manifest exists, is bundled, and makes only supported declarations", () => {
  const rel = "ios/App/App/PrivacyInfo.xcprivacy";
  assert.ok(existsSync(join(repoRoot, rel)), `${rel} must exist`);

  const manifest = read(rel);
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /<key>NSPrivacyCollectedDataTypes<\/key>/);

  // Every declared data type must be a real Apple identifier, and every purpose
  // a real Apple purpose — a typo here is silently accepted by Xcode.
  const declaredTypes = [...manifest.matchAll(/<key>NSPrivacyCollectedDataType<\/key>\s*<string>([^<]+)<\/string>/g)].map(
    (m) => m[1],
  );
  const supportedTypes = new Set([
    "NSPrivacyCollectedDataTypeEmailAddress",
    "NSPrivacyCollectedDataTypeName",
    "NSPrivacyCollectedDataTypeUserID",
    "NSPrivacyCollectedDataTypePreciseLocation",
    "NSPrivacyCollectedDataTypePhotosorVideos",
  ]);
  assert.ok(declaredTypes.length > 0, "expected at least one declared data type");
  for (const type of declaredTypes) {
    assert.ok(supportedTypes.has(type), `unsupported privacy data type declared: ${type}`);
  }

  const purposes = [...manifest.matchAll(/<string>(NSPrivacyCollectedDataTypePurpose[^<]*)<\/string>/g)].map(
    (m) => m[1],
  );
  for (const purpose of purposes) {
    assert.equal(purpose, "NSPrivacyCollectedDataTypePurposeAppFunctionality");
  }

  // Must be in the Resources build phase, or it never reaches the .ipa.
  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.match(
    pbxproj,
    /PrivacyInfo\.xcprivacy in Resources/,
    "the privacy manifest must be in the Resources build phase to be bundled",
  );
});

// ── Google client ID validation ──────────────────────────────────────────────
test("validateGoogleClientConfig accepts a well-formed pair", () => {
  const result = validateGoogleClientConfig({
    iosClientId: "111-ios.apps.googleusercontent.com",
    webClientId: "111-web.apps.googleusercontent.com",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.config, {
    iosClientId: "111-ios.apps.googleusercontent.com",
    webClientId: "111-web.apps.googleusercontent.com",
  });
});

test("validateGoogleClientConfig names the exact missing Vercel variables", () => {
  const none = validateGoogleClientConfig({ iosClientId: undefined, webClientId: undefined });
  assert.equal(none.ok, false);
  assert.match(none.ok === false ? none.message : "", /NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
  assert.match(none.ok === false ? none.message : "", /NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID/);
  assert.match(none.ok === false ? none.message : "", /redeploy/i);

  // Only one missing — the message must name only that one.
  const onlyWeb = validateGoogleClientConfig({
    iosClientId: undefined,
    webClientId: "111-web.apps.googleusercontent.com",
  });
  assert.equal(onlyWeb.ok, false);
  assert.match(onlyWeb.ok === false ? onlyWeb.message : "", /NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
  assert.doesNotMatch(onlyWeb.ok === false ? onlyWeb.message : "", /NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID/);
});

test("validateGoogleClientConfig rejects blank, malformed, and duplicated client IDs", () => {
  // Whitespace-only is treated as missing, not as a valid value.
  const blank = validateGoogleClientConfig({ iosClientId: "   ", webClientId: "   " });
  assert.equal(blank.ok, false);
  assert.match(blank.ok === false ? blank.message : "", /missing/);

  // A reversed client ID pasted into the wrong variable.
  const reversed = validateGoogleClientConfig({
    iosClientId: "com.googleusercontent.apps.111-ios",
    webClientId: "111-web.apps.googleusercontent.com",
  });
  assert.equal(reversed.ok, false);
  assert.match(reversed.ok === false ? reversed.message : "", /apps\.googleusercontent\.com/);

  // Same client ID used for both — means no iOS OAuth client was ever created,
  // which Supabase would reject as an audience mismatch.
  const duplicated = validateGoogleClientConfig({
    iosClientId: "111-web.apps.googleusercontent.com",
    webClientId: "111-web.apps.googleusercontent.com",
  });
  assert.equal(duplicated.ok, false);
  assert.match(duplicated.ok === false ? duplicated.message : "", /same value/);
});
