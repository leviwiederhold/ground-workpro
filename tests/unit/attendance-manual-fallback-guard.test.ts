import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const page = () => read("app/page.tsx");
const runtime = () => read("app/components/location/LocationBackgroundRuntime.tsx");

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("the employee attendance card and its manual fallback UI are deleted", () => {
  assert.equal(
    existsSync(join(root, "app/components/views/JobsiteTimeEmployeeCard.tsx")),
    false,
  );
  assert.equal(
    existsSync(join(root, "app/components/native/LocationOnboarding.tsx")),
    false,
  );
});

test("the employee dashboard mounts only a headless location runtime", () => {
  const source = withoutComments(page());
  assert.match(source, /<LocationBackgroundRuntime\s*\/>/);
  assert.ok(!source.includes("JobsiteTimeEmployeeCard"));
});

test("the employee runtime preserves background behavior but renders no UI or controls", () => {
  const source = withoutComments(runtime());
  assert.match(source, /startAttendanceQueueAutoFlush/);
  assert.match(source, /startForegroundGeofenceWatch/);
  assert.match(source, /ensureDeviceCredential/);
  assert.match(source, /registerGeofences/);
  assert.match(source, /onGeofenceTransition/);
  assert.match(source, /return null;/);
  assert.ok(!/<(?:button|Button|Card|Modal)\b/.test(source));
  assert.ok(!/source:\s*['"]manual['"]/.test(source));
  assert.ok(!/submitManual/.test(source));
});

test("employee navigation and deep links cannot expose the management view", () => {
  const nav = read("src/lib/nav/config.ts");
  const admin = nav.slice(nav.indexOf("admin: ["), nav.indexOf("pm: ["));
  const pm = nav.slice(nav.indexOf("pm: ["), nav.indexOf("foreman: ["));
  assert.match(admin, /"jobsite_time"/);
  assert.ok(!pm.includes('"jobsite_time"'));
  assert.match(nav, /"\/jobsite-time": \["admin"\]/);

  const source = withoutComments(page());
  assert.match(source, /case 'jobsite_time': return isCeoRole/);
  assert.match(source, /isCeoRole\s*\?\s*<JobsiteTimeView/);
  assert.match(source, /Access Restricted/);
});

test("normal product UI has no manual clock-in or clock-out entry point", () => {
  const source = withoutComments(page());
  const dashboard = withoutComments(read("app/components/views/DashboardView.tsx"));
  const dashboardApi = read("app/api/dashboard/summary/route.ts");
  const liveDashboardApi = read("app/api/dashboard/route.ts");
  const attendanceSettings = read("app/components/views/JobsiteTimeSettingsCard.tsx");

  for (const uiSource of [source, dashboard, dashboardApi, liveDashboardApi, attendanceSettings]) {
    assert.ok(!/TimeClockModal|Time Clock|time_clock|time-clock|manual clock-in fallback/i.test(uiSource));
  }

  assert.ok(!source.includes("/api/time-clock/clock-in"));
  assert.ok(!source.includes("/api/time-clock/clock-out"));
});

test("employee-rendered location UI contains only neutral setup language", () => {
  const gateSource = withoutComments(
    read("app/components/location/LocationRequiredGate.tsx"),
  );
  const renderedGate = gateSource.slice(gateSource.lastIndexOf("return ("));
  const settingsSource = withoutComments(read("src/lib/runtime/openAppSettings.ts"));
  const visibleSource = `${renderedGate}\n${settingsSource}`;
  const forbidden = [
    /\battendance\b/i,
    /\bclock(?:ing)?\b/i,
    /\bclock[\s-]*(?:in|out)\b/i,
    /\barrival\b/i,
    /\bdeparture\b/i,
    /\bgeofence\b/i,
    /\bmonitor(?:ing)?\b/i,
    /\btrack(?:ing)?\b/i,
  ];

  for (const pattern of forbidden) {
    assert.ok(
      !pattern.test(visibleSource),
      `location setup exposes forbidden employee wording: ${pattern}`,
    );
  }
});

test("authorized management UI remains available", () => {
  const source = read("app/components/views/JobsiteTimeView.tsx");
  assert.match(source, /export function JobsiteTimeView/);
  assert.match(source, /Correction/);
  assert.match(source, /Approve/);

  const domain = read("src/lib/jobsite-time/domain.ts");
  assert.match(
    domain,
    /return r === "admin" \|\| r === "executive" \|\| r === "ceo" \|\| r === "owner";/,
  );
});

test("break settings and exception copy stay in CEO-only management surfaces", () => {
  const settings = withoutComments(page());
  const management = read("app/components/views/JobsiteTimeView.tsx");
  const employeeRuntime = withoutComments(runtime());
  const employeeGate = withoutComments(
    read("app/components/location/LocationRequiredGate.tsx"),
  );

  assert.match(settings, /Use a scheduled lunch break/);
  assert.match(settings, /Lunch start/);
  assert.match(settings, /Lunch end/);
  assert.match(settings, /isAdmin && \(/);
  assert.match(management, /Not returned from break/);
  assert.match(management, /Returned late from break/);

  for (const employeeSource of [employeeRuntime, employeeGate]) {
    assert.ok(!/\blunch\b/i.test(employeeSource));
    assert.ok(!/\bbreak exceptions?\b/i.test(employeeSource));
    assert.ok(!/not returned from break/i.test(employeeSource));
  }
});
