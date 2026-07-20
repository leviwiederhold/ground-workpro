import test from "node:test";
import assert from "node:assert/strict";
import { runUnifiedSave, settingsSaveState } from "../../src/lib/settings/unifiedSave.ts";
import { mapCompanyJobsiteSettings } from "../../src/lib/jobsite-time/domain.ts";

// ── Attendance is permanent ──────────────────────────────────────────────────
// A false/null jobsite_time_enabled (the legacy attendance_enabled gate) must
// NOT disable Attendance: the mapper always reports enabled.
test("legacy attendance_enabled false does not disable Attendance", () => {
  assert.equal(mapCompanyJobsiteSettings({ jobsite_time_enabled: false }).enabled, true);
});

test("legacy attendance_enabled null/missing does not disable Attendance", () => {
  assert.equal(mapCompanyJobsiteSettings({ jobsite_time_enabled: null }).enabled, true);
  assert.equal(mapCompanyJobsiteSettings({}).enabled, true);
  assert.equal(mapCompanyJobsiteSettings(null).enabled, true);
});

test("a truthy legacy value also stays enabled (never toggled off anywhere)", () => {
  assert.equal(mapCompanyJobsiteSettings({ jobsite_time_enabled: true }).enabled, true);
});

// ── Single Save Changes orchestration ────────────────────────────────────────
// Only dirty sections are sent; a multi-section save runs every dirty section.
test("multi-section save runs every changed section and reports success", async () => {
  const ran: string[] = [];
  const result = await runUnifiedSave([
    { label: "Profile", dirty: true, run: async () => { ran.push("Profile"); return true; } },
    { label: "Company & work hours", dirty: true, run: async () => { ran.push("Company"); return true; } },
    { label: "Attendance", dirty: false, run: async () => { ran.push("Attendance"); return true; } },
    { label: "Cost defaults", dirty: true, run: async () => { ran.push("Cost"); return true; } },
  ]);
  assert.deepEqual(ran, ["Profile", "Company", "Cost"], "clean sections are skipped");
  assert.equal(result.ok, true);
  assert.deepEqual(result.failed, []);
  assert.equal(settingsSaveState(result), "saved");
});

// A partial failure must NOT display "Saved".
test("partial failure does not report Saved", async () => {
  const result = await runUnifiedSave([
    { label: "Profile", dirty: true, run: async () => true },
    { label: "Company & work hours", dirty: true, run: async () => false }, // API error
    { label: "Cost defaults", dirty: true, run: async () => true },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ["Company & work hours"]);
  assert.equal(settingsSaveState(result), "error");
});

test("a thrown section is counted as failed, not success, and others still run", async () => {
  const ran: string[] = [];
  const result = await runUnifiedSave([
    { label: "Profile", dirty: true, run: async () => { ran.push("Profile"); throw new Error("network"); } },
    { label: "Cost defaults", dirty: true, run: async () => { ran.push("Cost"); return true; } },
  ]);
  assert.deepEqual(ran, ["Profile", "Cost"], "a failure never blocks later sections");
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ["Profile"]);
  assert.equal(settingsSaveState(result), "error");
});

test("nothing dirty → nothing sent, and it is not an error", async () => {
  const result = await runUnifiedSave([
    { label: "Profile", dirty: false, run: async () => { throw new Error("should not run"); } },
  ]);
  assert.deepEqual(result.attempted, []);
  assert.equal(result.ok, true);
});
