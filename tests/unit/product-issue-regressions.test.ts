import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getAccountDeletionBlocker } from "../../src/lib/auth/accountDeletion.ts";
import { getWebAppAccessDecision } from "../../src/lib/auth/webAccess.ts";

function fakeAdmin(rows: Record<string, Array<Record<string, unknown>>> = {}) {
  return {
    from(table: string) {
      const query = {
        column: "",
        value: "",
        select() { return this; },
        eq(column: string, value: string) { this.column = column; this.value = value; return this; },
        limit() { return this; },
        maybeSingle: async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null }),
        then(resolve: (value: { data: Array<Record<string, unknown>>; error: null }) => unknown) {
          const data = (rows[table] ?? []).filter((row) => !this.column || row[this.column] === this.value).slice(0, 1);
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return query;
    },
  };
}

test("employee account cleanup preserves accounts with another membership or retained history", async () => {
  assert.match(
    String(await getAccountDeletionBlocker(fakeAdmin({ memberships: [{ user_id: "user-1", company_id: "other" }] }), "user-1")),
    /another company/
  );
  assert.match(
    String(await getAccountDeletionBlocker(fakeAdmin({ time_entries: [{ id: "entry", user_id: "user-1" }] }), "user-1")),
    /time entries history/
  );
  assert.match(
    String(await getAccountDeletionBlocker(fakeAdmin({ messages: [{ id: "message", sender_user_id: "user-1" }] }), "user-1")),
    /messages history/
  );
  assert.match(
    String(await getAccountDeletionBlocker(fakeAdmin({ message_participants: [{ user_id: "user-1" }] }), "user-1")),
    /message participants history/
  );
  assert.equal(await getAccountDeletionBlocker(fakeAdmin(), "user-1"), null);
});

test("co-owners retain owner web access while mobile-only employee roles stay restricted on web", () => {
  for (const role of ["owner", "co_owner", "admin", "ceo"]) {
    assert.equal(getWebAppAccessDecision({ role, isNativeApp: false }), "allow", role);
  }
  for (const role of ["team_member", "operator", "manager"]) {
    assert.equal(getWebAppAccessDecision({ role, isNativeApp: false }), "mobile-app-only", role);
    assert.equal(getWebAppAccessDecision({ role, isNativeApp: true }), "allow", `${role} native`);
  }
});

test("app footer has no feedback UI and membership role updates refresh authorization state", () => {
  const app = readFileSync("app/page.tsx", "utf8");
  assert.doesNotMatch(app, /Send feedback|How can we improve\?/i);
  assert.match(app, /postgres_changes/);
  assert.match(app, /setAccessRefreshNonce\(\(value\) => value \+ 1\)/);
  const employeeRoute = readFileSync("app/api/employees/[id]/route.ts", "utf8");
  assert.match(employeeRoute, /membershipClient = getSupabaseAdmin\(\) \?\? supabase/);
  assert.match(employeeRoute, /Membership role could not be updated/);
  const teamPermissionsRoute = readFileSync("app/api/team/members/[id]/permissions/route.ts", "utf8");
  assert.match(teamPermissionsRoute, /select\("user_id, role"\)\s*\.maybeSingle\(\)/);
  assert.match(teamPermissionsRoute, /Employee role could not be updated/);
  const dashboard = readFileSync("app/components/views/DashboardView.tsx", "utf8");
  assert.match(dashboard, /\['admin', 'ceo', 'executive', 'owner', 'co_owner'\]/);
  assert.match(dashboard, /'owner', 'co_owner', 'pm'/);
  assert.match(dashboard, /const effectiveRole = currentRole \?\? dashboardSummary\?\.role/);
  const removalMigration = readFileSync("supabase/migrations/20261006_01_safe_employee_removal.sql", "utf8");
  assert.match(removalMigration, /create or replace function public\.remove_company_employee/);
  assert.match(removalMigration, /security definer/);
  assert.match(removalMigration, /grant execute .* to service_role/);
  assert.match(removalMigration, /alter publication supabase_realtime add table public\.memberships/);
  assert.match(removalMigration, /prevent_unsafe_auth_user_deletion/);
  assert.match(removalMigration, /storage\.objects o where o\.owner_id = old\.id::text/);
});
