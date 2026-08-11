import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateEmployeeSetup,
  SETUP_PROBLEM_FIX,
  SETUP_PROBLEM_LABEL,
  summarizeSetupHealth,
  type EmployeeSetupInput,
} from "../../src/lib/attendance/setupHealth.ts";
import { buildJobsiteRegions } from "../../src/lib/attendance/nativeGeofence.ts";

const NOW = "2026-07-30T12:00:00.000Z";
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 24 * 3600_000).toISOString();

function employee(over: Partial<EmployeeSetupInput> = {}): EmployeeSetupInput {
  return {
    employeeId: "emp-1",
    userId: "user-1",
    name: "Levi",
    hasAppAccess: true,
    hasAssignmentToday: true,
    jobsiteVerified: true,
    jobName: "Shop",
    requiredRegionIds: ["shop:arrival"],
    credential: {
      expiresAt: "2026-08-20T00:00:00.000Z",
      revokedAt: null,
      // A phone may legitimately have no event for days. Readiness is a setup
      // contract, not an app-open/activity heartbeat.
      lastUsedAt: daysAgo(7),
    },
    nativeReadiness: {
      locationServicesEnabled: true,
      backgroundRefreshEnabled: true,
      background: "granted",
      precise: true,
      serviceSupported: true,
      serviceHealthy: true,
      hasSecureCredential: true,
      requiredRegionIds: ["shop:arrival"],
      registeredRegionIds: ["shop:arrival"],
      reportedAt: daysAgo(7),
    },
    automaticAttendanceEnabled: true,
    ...over,
  };
}

test("a complete native report remains configured even when the app has stayed closed for days", () => {
  const result = evaluateEmployeeSetup(employee(), NOW);
  assert.equal(result.configured, true);
  assert.deepEqual(result.problems, []);
});

test("CEO readiness uses the same collapsed region plan as native registration", () => {
  const regions = buildJobsiteRegions(
    {
      jobId: "shop",
      lat: 40,
      lng: -75,
      addressVerified: true,
    },
    1609,
    1609
  );
  assert.deepEqual(
    regions.map((region) => region.identifier),
    ["shop:arrival"]
  );

  const result = evaluateEmployeeSetup(
    employee({
      requiredRegionIds: regions.map((region) => region.identifier),
      nativeReadiness: {
        ...employee().nativeReadiness!,
        requiredRegionIds: ["shop:arrival"],
        registeredRegionIds: ["shop:arrival"],
      },
    }),
    NOW
  );
  assert.equal(result.configured, true);
  assert.deepEqual(result.problems, []);
});

test("app access defines the CEO setup population", () => {
  const summary = summarizeSetupHealth(
    [
      employee(),
      employee({
        employeeId: "no-app",
        userId: null,
        name: "No account",
        hasAppAccess: false,
        credential: null,
        nativeReadiness: null,
      }),
    ],
    NOW
  );
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.configuredCount, 1);
  assert.deepEqual(
    summary.items.map((item) => item.name),
    ["Levi"]
  );
});

test("missing assignment is reported alone before region requirements", () => {
  const result = evaluateEmployeeSetup(
    employee({ hasAssignmentToday: false, jobsiteVerified: false, nativeReadiness: null }),
    NOW
  );
  assert.deepEqual(result.problems, ["no_assignment"]);
});

test("missing native readiness is distinct from a missing server credential", () => {
  assert.deepEqual(evaluateEmployeeSetup(employee({ nativeReadiness: null }), NOW).problems, [
    "native_readiness_missing",
  ]);
  assert.deepEqual(
    evaluateEmployeeSetup(employee({ credential: null, nativeReadiness: null }), NOW).problems,
    ["device_not_enrolled", "native_readiness_missing"]
  );
});

test("required iOS authorization, Precise Location and native health are independent", () => {
  const result = evaluateEmployeeSetup(
    employee({
      nativeReadiness: {
        ...employee().nativeReadiness!,
        locationServicesEnabled: false,
        background: "prompt",
        precise: false,
        serviceHealthy: false,
      },
    }),
    NOW
  );
  assert.deepEqual(result.problems, [
    "native_service_unhealthy",
    "background_location_required",
    "precise_location_required",
  ]);
});

test("disabled Background App Refresh is an unhealthy native service report", () => {
  const result = evaluateEmployeeSetup(
    employee({
      nativeReadiness: {
        ...employee().nativeReadiness!,
        backgroundRefreshEnabled: false,
        serviceHealthy: false,
      },
    }),
    NOW
  );
  assert.deepEqual(result.problems, ["native_service_unhealthy"]);
});

test("an active server credential cannot mask a missing native Keychain credential", () => {
  const result = evaluateEmployeeSetup(
    employee({
      nativeReadiness: {
        ...employee().nativeReadiness!,
        hasSecureCredential: false,
      },
    }),
    NOW
  );
  assert.deepEqual(result.problems, ["device_not_enrolled"]);
});

test("every assigned native region must appear in the latest OS registration report", () => {
  const missing = evaluateEmployeeSetup(
    employee({
      nativeReadiness: {
        ...employee().nativeReadiness!,
        requiredRegionIds: ["shop:arrival", "shop:wake"],
        registeredRegionIds: ["shop:wake"],
      },
      requiredRegionIds: ["shop:arrival", "shop:wake"],
    }),
    NOW
  );
  assert.deepEqual(missing.problems, ["regions_not_registered"]);

  const noneRequired = evaluateEmployeeSetup(
    employee({
      nativeReadiness: {
        ...employee().nativeReadiness!,
        requiredRegionIds: [],
        registeredRegionIds: [],
      },
    }),
    NOW
  );
  assert.deepEqual(noneRequired.problems, ["regions_not_registered"]);

  const phoneUnderreportedRequirements = evaluateEmployeeSetup(
    employee({
      requiredRegionIds: ["shop:arrival", "shop:wake"],
      nativeReadiness: {
        ...employee().nativeReadiness!,
        requiredRegionIds: ["shop:arrival"],
        registeredRegionIds: ["shop:arrival"],
      },
    }),
    NOW
  );
  assert.deepEqual(
    phoneUnderreportedRequirements.problems,
    ["regions_not_registered"],
    "server assignments, not the phone's claimed required set, are authoritative"
  );
});

test("expired and revoked credentials remain authoritative server failures", () => {
  assert.deepEqual(
    evaluateEmployeeSetup(
      employee({
        credential: {
          expiresAt: daysAgo(1),
          revokedAt: null,
          lastUsedAt: daysAgo(2),
        },
      }),
      NOW
    ).problems,
    ["credential_expired"]
  );
  assert.deepEqual(
    evaluateEmployeeSetup(
      employee({
        credential: {
          expiresAt: "2026-08-20T00:00:00.000Z",
          revokedAt: daysAgo(1),
          lastUsedAt: daysAgo(2),
        },
      }),
      NOW
    ).problems,
    ["device_not_enrolled"]
  );
});

test("the same full roster drives configured count and broken warning count", () => {
  const summary = summarizeSetupHealth(
    [
      employee({ employeeId: "ready", name: "Ana" }),
      employee({
        employeeId: "broken",
        name: "Zoe",
        nativeReadiness: null,
      }),
    ],
    NOW
  );

  assert.equal(summary.totalCount, 2);
  assert.equal(summary.configuredCount, 1);
  assert.equal(summary.healthyCount, 1);
  assert.equal(summary.brokenCount, 1);
  assert.equal(summary.items.filter((item) => !item.healthy).length, summary.brokenCount);
  assert.deepEqual(
    summary.items.map((item) => item.name),
    ["Ana", "Zoe"]
  );
});

test("with the company switch off, setup is not reported as broken", () => {
  const result = evaluateEmployeeSetup(
    employee({
      automaticAttendanceEnabled: false,
      jobsiteVerified: false,
      credential: null,
      nativeReadiness: null,
    }),
    NOW
  );
  assert.equal(result.healthy, true);
  assert.deepEqual(result.problems, []);
});

test("every problem has a label and an actionable fix", () => {
  for (const problem of Object.keys(SETUP_PROBLEM_LABEL) as Array<
    keyof typeof SETUP_PROBLEM_LABEL
  >) {
    assert.ok(SETUP_PROBLEM_LABEL[problem]);
    assert.ok(SETUP_PROBLEM_FIX[problem], `${problem} has no fix instruction`);
  }
});

test("the setup report never carries a location", () => {
  const serialized = JSON.stringify(
    evaluateEmployeeSetup(employee({ jobsiteVerified: false }), NOW)
  ).toLowerCase();
  for (const forbidden of ['"lat"', '"lng"', "latitude", "longitude", "distance", "accuracy"]) {
    assert.ok(!serialized.includes(forbidden), `setup health leaked ${forbidden}`);
  }
});
