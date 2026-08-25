import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isPrimaryOwner,
  resolveCompanyTeamRole,
} from "../../src/lib/auth/companyOwnership.ts";
import {
  canAssignTeamRole,
  canonicalizeRoleWrite,
} from "../../src/lib/auth/teamRoles.ts";
import { getDefaultPermissionsByRole } from "../../src/lib/permissions/access.ts";
import { getTeamRolePresentation } from "../../src/lib/team/roleReview.ts";

test("company ownership resolves exactly one Owner and preserves duplicate full access as Co-Owner", () => {
  const primaryOwnerUserId = "primary";
  const roles = [
    resolveCompanyTeamRole({ storedRole: "owner", userId: "primary", primaryOwnerUserId }),
    resolveCompanyTeamRole({ storedRole: "owner", userId: "duplicate", primaryOwnerUserId }),
    resolveCompanyTeamRole({ storedRole: "manager", userId: "manager", primaryOwnerUserId }),
  ];
  assert.deepEqual(roles, ["owner", "co_owner", "manager"]);
  assert.equal(roles.filter((role) => role === "owner").length, 1);
  assert.equal(isPrimaryOwner({ userId: "primary", primaryOwnerUserId }), true);
});

test("Owner and Co-Owner labels agree with their permission templates", () => {
  assert.deepEqual(getTeamRolePresentation("owner"), {
    label: "Owner",
    access: "Company owner · Full web and mobile access",
  });
  assert.deepEqual(getTeamRolePresentation("co_owner"), {
    label: "Co-Owner",
    access: "Full web and mobile access · Owner-level permissions",
  });
  assert.deepEqual(getTeamRolePresentation("manager"), {
    label: "Manager",
    access: "Mobile app · Manager permissions",
  });
  assert.ok(Object.values(getDefaultPermissionsByRole("owner")).every((value) => value === "edit"));
  assert.ok(Object.values(getDefaultPermissionsByRole("co_owner")).every((value) => value === "edit"));
});

test("normal role administration promotes to Co-Owner, demotes Co-Owner, and never assigns Owner", () => {
  assert.equal(canAssignTeamRole("owner", "co_owner"), true);
  assert.equal(canAssignTeamRole("co_owner", "co_owner"), false);
  assert.equal(canAssignTeamRole("owner", "owner"), false);
  assert.equal(canonicalizeRoleWrite("admin").role, "co_owner");
  assert.equal(canonicalizeRoleWrite("co-owner").role, "co_owner");
  assert.equal(canonicalizeRoleWrite("manager").role, "manager");
});

test("migration backfills one marker, converts duplicate Owners, and protects the primary membership", () => {
  const migration = readFileSync(
    "supabase/migrations/20260824_01_primary_owner_and_co_owner.sql",
    "utf8"
  );
  assert.match(migration, /primary_owner_user_id uuid/);
  assert.match(migration, /memberships_one_primary_owner_per_company/);
  assert.match(migration, /set role = 'co_owner'/);
  assert.match(migration, /Primary owner role is locked/);
  assert.match(migration, /before delete on public\.memberships/);
  assert.match(migration, /Use the dedicated ownership transfer workflow/);
  assert.match(migration, /first future member becomes the one/);
  assert.doesNotMatch(migration, /alter column primary_owner_user_id set not null/);
});

test("every normal role mutation endpoint rejects or gates owner-level assignment", () => {
  const sources = [
    "app/api/employees/route.ts",
    "app/api/employees/[id]/route.ts",
    "app/api/invite/create/route.ts",
    "app/api/team/invitations/route.ts",
    "app/api/team/invitations/[id]/route.ts",
    "app/api/team/members/[id]/permissions/route.ts",
  ].map((path) => readFileSync(path, "utf8"));
  for (const source of sources) {
    assert.match(source, /ownership|primary Owner/);
  }
});
