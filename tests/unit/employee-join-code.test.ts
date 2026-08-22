import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPLOYEE_JOIN_CODE_LIFETIME_MS,
  EMPLOYEE_JOIN_MEMBERSHIP_ROLE,
  EMPLOYEE_JOIN_PROFILE_ROLE,
  createEmployeeJoinCodeTimes,
  employeeJoinAcceptSchema,
  generateEmployeeJoinCode,
  getEmployeeJoinCodeStatus,
  hashEmployeeJoinCode,
  normalizeEmployeeJoinCode,
  type EmployeeJoinCodeRow,
} from "../../src/lib/team/joinCode.ts";
import { getWebAppAccessDecision } from "../../src/lib/auth/webAccess.ts";
import { isCeoMembershipRole } from "../../src/lib/auth/ceoGuard.ts";
import {
  getDefaultPermissionsByRole,
  resolveStoredInvitationRole,
} from "../../src/lib/permissions/access.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function row(input: Partial<EmployeeJoinCodeRow> = {}): EmployeeJoinCodeRow {
  return {
    company_id: "company-a",
    code_digest: hashEmployeeJoinCode("ABC234"),
    created_at: "2026-08-22T13:45:00.000Z",
    expires_at: "2026-08-23T13:45:00.000Z",
    ...input,
  };
}

test("employee join codes are normalized and generated in the 6-character alphabet", () => {
  assert.equal(normalizeEmployeeJoinCode(" ab-c 234 "), "ABC234");
  for (let index = 0; index < 100; index += 1) {
    assert.match(generateEmployeeJoinCode(), /^[A-HJ-NP-Z2-9]{6}$/);
  }
});

test("employee join code expiration is exactly 24 hours after creation", () => {
  const now = new Date("2026-08-22T13:45:00.000Z");
  const times = createEmployeeJoinCodeTimes(now);
  assert.equal(times.createdAt, now.toISOString());
  assert.equal(Date.parse(times.expiresAt) - Date.parse(times.createdAt), EMPLOYEE_JOIN_CODE_LIFETIME_MS);
  assert.equal(times.expiresAt, "2026-08-23T13:45:00.000Z");
});

test("the same current code remains valid for multiple employees until expiration", () => {
  const current = row();
  const input = {
    row: current,
    submittedDigest: hashEmployeeJoinCode("ABC234"),
    companyActive: true,
    now: new Date("2026-08-23T13:44:59.999Z"),
  };
  assert.equal(getEmployeeJoinCodeStatus(input), "valid");
  assert.equal(getEmployeeJoinCodeStatus(input), "valid");
});

test("a code stops working at its expiration timestamp", () => {
  assert.equal(
    getEmployeeJoinCodeStatus({
      row: row(),
      submittedDigest: hashEmployeeJoinCode("ABC234"),
      companyActive: true,
      now: new Date("2026-08-23T13:45:00.000Z"),
    }),
    "expired"
  );
});

test("regeneration invalidates the old digest immediately and keeps the new code company-scoped", () => {
  const replacement = row({
    company_id: "company-a",
    code_digest: hashEmployeeJoinCode("XYZ789"),
    created_at: "2026-08-22T14:00:00.000Z",
    expires_at: "2026-08-23T14:00:00.000Z",
  });
  assert.equal(
    getEmployeeJoinCodeStatus({
      row: replacement,
      submittedDigest: hashEmployeeJoinCode("ABC234"),
      companyActive: true,
      now: new Date("2026-08-22T14:00:01.000Z"),
    }),
    "not_found"
  );
  assert.equal(
    getEmployeeJoinCodeStatus({
      row: replacement,
      submittedDigest: hashEmployeeJoinCode("XYZ789"),
      companyActive: true,
      now: new Date("2026-08-22T14:00:01.000Z"),
    }),
    "valid"
  );
});

test("codes for inactive companies are rejected", () => {
  assert.equal(
    getEmployeeJoinCodeStatus({
      row: row(),
      submittedDigest: hashEmployeeJoinCode("ABC234"),
      companyActive: false,
      now: new Date("2026-08-22T14:00:00.000Z"),
    }),
    "company_inactive"
  );
});

test("join acceptance cannot request a role or permissions and always uses the Employee mapping", () => {
  assert.equal(employeeJoinAcceptSchema.safeParse({ code: "ABC234", full_name: "Sam Field" }).success, true);
  assert.equal(employeeJoinAcceptSchema.safeParse({ code: "ABC234", role: "admin" }).success, false);
  assert.equal(
    employeeJoinAcceptSchema.safeParse({ code: "ABC234", permissions: [{ module_key: "finance", access_level: "edit" }] }).success,
    false
  );
  assert.equal(EMPLOYEE_JOIN_MEMBERSHIP_ROLE, "operator");
  assert.equal(EMPLOYEE_JOIN_PROFILE_ROLE, "operator");
});

test("only owner/co-owner roles receive normal web app access; native field roles remain allowed", () => {
  for (const role of ["admin", "ceo", "owner", "co-owner", "executive"]) {
    assert.equal(getWebAppAccessDecision({ role, isNativeApp: false }), "allow");
  }
  for (const role of ["pm", "manager", "foreman", "crew_lead", "mechanic", "operator", "team_member", "fieldstaff", "employee"]) {
    assert.equal(getWebAppAccessDecision({ role, isNativeApp: false }), "mobile-app-only");
    assert.equal(getWebAppAccessDecision({ role, isNativeApp: true }), "allow");
  }
});

test("canonical live-database owner roles satisfy the owner onboarding guard", () => {
  for (const role of ["admin", "ceo", "executive", "owner", "co_owner"]) {
    assert.equal(isCeoMembershipRole(role), true);
  }
  for (const role of ["administrator", "manager", "crew_lead", "team_member", "operator"]) {
    assert.equal(isCeoMembershipRole(role), false);
  }
});

test("canonical live-database field roles retain their existing permission presentation", () => {
  assert.equal(resolveStoredInvitationRole("crew_lead"), "foreman");
  assert.equal(resolveStoredInvitationRole("manager"), "manager");
  assert.equal(
    resolveStoredInvitationRole("team_member", getDefaultPermissionsByRole("operator")),
    "operator"
  );
  assert.equal(
    resolveStoredInvitationRole("team_member", getDefaultPermissionsByRole("fieldstaff")),
    "fieldstaff"
  );
});

test("join-code migration keeps one private current code per company", () => {
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260822_01_company_employee_join_codes.sql"),
    "utf8"
  );
  assert.match(migration, /company_id uuid primary key/);
  assert.match(migration, /code_digest text not null unique/);
  assert.match(migration, /expires_at = created_at \+ interval '24 hours'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* from anon/i);
});

test("join-code guessing is database-rate-limited across server instances", () => {
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260822_01_company_employee_join_codes.sql"),
    "utf8"
  );
  const validateRoute = readFileSync(join(repoRoot, "app/api/join/validate/route.ts"), "utf8");
  const acceptRoute = readFileSync(join(repoRoot, "app/api/join/accept/route.ts"), "utf8");
  const limiter = readFileSync(join(repoRoot, "src/lib/team/joinCodeRateLimit.ts"), "utf8");

  assert.match(migration, /employee_join_code_rate_limits/);
  assert.match(migration, /consume_employee_join_code_rate_limit/);
  assert.match(migration, /grant execute [\s\S]*service_role/i);
  assert.match(limiter, /sha256/);
  assert.match(limiter, /consume_employee_join_code_rate_limit/);
  assert.match(validateRoute, /enforceEmployeeJoinCodeRateLimit/);
  assert.match(acceptRoute, /enforceEmployeeJoinCodeRateLimit/);
});

test("join acceptance is atomic and enforces one company membership per user", () => {
  const firstMigration = readFileSync(
    join(repoRoot, "supabase/migrations/20260822_01_company_employee_join_codes.sql"),
    "utf8"
  );
  const secondMigration = readFileSync(
    join(repoRoot, "supabase/migrations/20260822_02_employee_role_review.sql"),
    "utf8"
  );
  const acceptRoute = readFileSync(join(repoRoot, "app/api/join/accept/route.ts"), "utf8");

  assert.match(firstMigration, /unique index [\s\S]* memberships_user_id_unique/i);
  assert.match(secondMigration, /accept_employee_company_join/);
  assert.match(secondMigration, /pg_advisory_xact_lock/);
  assert.match(secondMigration, /for share/);
  assert.match(secondMigration, /insert into public\.memberships[\s\S]*'operator'/);
  assert.match(secondMigration, /insert into public\.employees[\s\S]*'operator'/);
  assert.match(acceptRoute, /rpc\("accept_employee_company_join"/);
  assert.doesNotMatch(acceptRoute, /from\("memberships"\)\.insert/);
  assert.doesNotMatch(acceptRoute, /from\("employees"\)\.insert/);
});
