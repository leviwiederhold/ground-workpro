import test from "node:test";
import assert from "node:assert/strict";
import {
  automaticAttendanceClaimable,
  detectRegressions,
  isBackgroundReady,
  resolveOnboardingStatus,
  shouldPromptOnboarding,
  type LocationPermissionSnapshot,
} from "../../src/lib/attendance/backgroundLocation.ts";

const NOW = "2026-07-20T13:00:00.000Z";

function snap(over: Partial<LocationPermissionSnapshot> = {}): LocationPermissionSnapshot {
  return {
    locationServicesEnabled: true,
    foreground: "granted",
    background: "granted",
    precise: true,
    platform: "ios",
    capturedAt: NOW,
    ...over,
  };
}

test("isBackgroundReady requires services + foreground + background + precise not off", () => {
  assert.equal(isBackgroundReady(snap()), true);
  assert.equal(isBackgroundReady(snap({ locationServicesEnabled: false })), false);
  assert.equal(isBackgroundReady(snap({ foreground: "denied" })), false);
  assert.equal(isBackgroundReady(snap({ background: "prompt" })), false);
  assert.equal(isBackgroundReady(snap({ background: "unknown" })), false);
  assert.equal(isBackgroundReady(snap({ precise: false })), false);
  // Unknown precise is tolerated (many devices don't report it).
  assert.equal(isBackgroundReady(snap({ precise: null })), true);
  assert.equal(isBackgroundReady(null), false);
});

test("automatic attendance is never claimable without background permission", () => {
  assert.equal(automaticAttendanceClaimable(snap()), true);
  assert.equal(automaticAttendanceClaimable(snap({ background: "denied" })), false);
  assert.equal(automaticAttendanceClaimable(snap({ background: "unknown" })), false);
});

test("do not re-prompt once background is ready; prompt when never completed or regressed", () => {
  assert.equal(shouldPromptOnboarding(null, snap()), false); // ready → no prompt
  assert.equal(shouldPromptOnboarding(null, snap({ background: "prompt" })), true); // never completed
  assert.equal(
    shouldPromptOnboarding({ onboardingCompletedAt: NOW, snapshot: snap() }, snap({ background: "denied" })),
    true // completed before but regressed
  );
  assert.equal(
    shouldPromptOnboarding({ onboardingCompletedAt: NOW, snapshot: snap() }, snap()),
    false // completed and still ready
  );
});

test("detectRegressions reports each downgraded dimension", () => {
  const prev = snap();
  assert.deepEqual(detectRegressions(prev, snap({ background: "denied" })), ["background_revoked"]);
  assert.deepEqual(detectRegressions(prev, snap({ locationServicesEnabled: false })), ["location_services_disabled"]);
  assert.deepEqual(detectRegressions(prev, snap({ precise: false })), ["precise_disabled"]);
  assert.deepEqual(
    detectRegressions(prev, snap({ foreground: "denied", background: "denied" })),
    ["foreground_revoked", "background_revoked"]
  );
  assert.deepEqual(detectRegressions(prev, snap()), []); // no change
  assert.deepEqual(detectRegressions(null, snap()), []); // nothing to compare
});

test("resolveOnboardingStatus separates ready / services / settings / onboarding", () => {
  assert.equal(resolveOnboardingStatus(null, snap()), "ready");
  assert.equal(resolveOnboardingStatus(null, snap({ locationServicesEnabled: false })), "services_disabled");
  assert.equal(resolveOnboardingStatus(null, snap({ background: "denied" })), "settings_required");
  assert.equal(resolveOnboardingStatus(null, snap({ precise: false })), "settings_required");
  // Promptable (never asked) with a soft "prompt" state → needs onboarding.
  assert.equal(
    resolveOnboardingStatus(null, snap({ background: "prompt" })),
    "needs_onboarding"
  );
});
