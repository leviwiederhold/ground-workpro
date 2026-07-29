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

test("generic clock controls are restricted to the CEO/owner/admin role", () => {
  const source = withoutComments(page());
  assert.match(source, /canUseTimeClock=\{isCeoRole\}/);
  assert.match(source, /isOpen=\{isCeoRole && showModal\.type === 'time-clock'\}/);
  assert.match(source, /if \(item\.action === 'time-clock'\) return canUseTimeClock;/);
  assert.match(source, /currentRole === 'executive' && \(/);

  const dashboard = withoutComments(read("app/components/views/DashboardView.tsx"));
  assert.match(dashboard, /canUseTimeClock/);
  assert.match(dashboard, /action\.key !== 'time_clock'/);
  assert.match(dashboard, /action\.href !== 'time-clock'/);

  const dashboardApi = read("app/api/dashboard/summary/route.ts");
  const nonAdmin = dashboardApi.slice(
    dashboardApi.lastIndexOf('if (role === "pm")'),
  );
  assert.ok(!nonAdmin.includes('label: "Time Clock"'));
  assert.ok(!nonAdmin.includes('label: "Crew On-Site"'));

  const liveDashboardApi = read("app/api/dashboard/route.ts");
  const nonAdminActions = liveDashboardApi.slice(
    liveDashboardApi.indexOf('if (role === "pm")'),
    liveDashboardApi.indexOf("export async function GET"),
  );
  assert.ok(!/Clock In|Clock Out|Time Clock/.test(nonAdminActions));
  assert.ok(!nonAdminActions.includes('label: "Crew On-Site"'));
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
