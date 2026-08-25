import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getTeamRolePresentation,
  isEmployeeRoleReviewPending,
} from "../../src/lib/team/roleReview.ts";
import { getWebAppAccessDecision } from "../../src/lib/auth/webAccess.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
test("a code-joined Employee is queued for optional role review", () => {
  assert.equal(
    isEmployeeRoleReviewPending({
      joinedViaCompanyCodeAt: "2026-08-22T15:00:00.000Z",
      roleReviewedAt: null,
      currentRole: "operator",
    }),
    true
  );
});

test("an unreviewed code-joined Employee remains pending after 30+ days", () => {
  for (const role of ["operator", "employee", "team_member"]) {
    assert.equal(
      isEmployeeRoleReviewPending({
        joinedViaCompanyCodeAt: "2025-01-01T00:00:00.000Z",
        roleReviewedAt: null,
        currentRole: role,
      }),
      true
    );
  }
});

test("Keep Employee clears review state through the explicit review timestamp", () => {
  assert.equal(
    isEmployeeRoleReviewPending({
      joinedViaCompanyCodeAt: "2025-01-01T00:00:00.000Z",
      roleReviewedAt: "2026-08-22T15:30:00.000Z",
      currentRole: "operator",
    }),
    false
  );
});

test("changing a code-joined Employee to another role clears review state", () => {
  for (const role of ["foreman", "pm", "manager", "mechanic", "fieldstaff", "admin"]) {
    assert.equal(
      isEmployeeRoleReviewPending({
        joinedViaCompanyCodeAt: "2025-01-01T00:00:00.000Z",
        roleReviewedAt: null,
        currentRole: role,
      }),
      false
    );
  }
});

test("pending role review does not block Employee mobile access", () => {
  const pending = isEmployeeRoleReviewPending({
    joinedViaCompanyCodeAt: "2025-01-01T00:00:00.000Z",
    roleReviewedAt: null,
    currentRole: "operator",
  });
  assert.equal(pending, true);
  assert.equal(
    getWebAppAccessDecision({ role: "operator", isNativeApp: true }),
    "allow"
  );
  assert.equal(
    getWebAppAccessDecision({ role: "team_member", isNativeApp: true }),
    "allow"
  );
});

test("Team role labels explain both role and access surface", () => {
  assert.deepEqual(getTeamRolePresentation("operator"), {
    label: "Employee",
    access: "Mobile app · Standard field access",
  });
  assert.deepEqual(getTeamRolePresentation("pm"), {
    label: "Manager",
    access: "Mobile app · Manager permissions",
  });
  assert.deepEqual(getTeamRolePresentation("admin"), {
    label: "Co-Owner",
    access: "Full web and mobile access · Owner-level permissions",
  });
  assert.deepEqual(getTeamRolePresentation("owner"), {
    label: "Owner",
    access: "Company owner · Full web and mobile access",
  });
});

test("join acceptance records provenance and Team exposes the lightweight review UI", () => {
  const acceptRoute = readFileSync(join(repoRoot, "app/api/join/accept/route.ts"), "utf8");
  const teamRoute = readFileSync(join(repoRoot, "app/api/team/route.ts"), "utf8");
  const memberRoute = readFileSync(
    join(repoRoot, "app/api/team/members/[id]/permissions/route.ts"),
    "utf8"
  );
  const roleReviewSource = readFileSync(
    join(repoRoot, "src/lib/team/roleReview.ts"),
    "utf8"
  );
  const teamPage = readFileSync(join(repoRoot, "app/page.tsx"), "utf8");
  const migration = readFileSync(
    join(repoRoot, "supabase/migrations/20260822_02_employee_role_review.sql"),
    "utf8"
  );

  assert.match(acceptRoute, /accept_employee_company_join/);
  assert.match(teamRoute, /roleReviewPending/);
  assert.match(memberRoute, /mark_reviewed/);
  assert.match(memberRoute, /actorRole !== "admin"/);
  assert.match(teamPage, /Review Roles/);
  assert.match(teamPage, /Keep Employee/);
  assert.match(teamPage, /role review is optional/i);
  assert.doesNotMatch(teamPage, /role review expires/i);
  assert.doesNotMatch(roleReviewSource, /Date\.parse|REVIEW_WINDOW|30 \* 24/);
  assert.match(migration, /joined_via_company_code_at timestamptz/);
  assert.match(migration, /role_reviewed_at timestamptz/);
  assert.match(migration, /joined_via_company_code_at = p_joined_at/);
  assert.match(migration, /role_reviewed_at = null/);
  assert.match(migration, /does not gate employee access/);
  assert.match(migration, /elapsed time does not clear it/);
});
