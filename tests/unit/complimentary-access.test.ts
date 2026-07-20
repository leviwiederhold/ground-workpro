import test from "node:test";
import assert from "node:assert/strict";
import { getCompanyBillingStatus } from "../../src/lib/billing/isCompanySubscriptionActive.ts";
import { mapCompanyOverride } from "../../src/lib/billing/adminOverrideMap.ts";

// A first-class, company-level complimentary entitlement replaces per-email
// comping. These tests pin the behaviour every billing gate depends on:
//   - a complimentary company is `is_active` (never sent to checkout),
//   - a regular company still needs Stripe active/trialing,
//   - access is decided from company state only — no email ever enters the
//     evaluation.

type Row = Record<string, unknown> | null;

// Minimal fake of the Supabase query chain used by getCompanyBillingStatus.
// `missingColumns` simulates an older schema by erroring when a select mentions
// a column that has not been migrated yet, so the tiered fallback is exercised.
function fakeSupabase(row: Row, missingColumns: string[] = []) {
  return {
    from() {
      return {
        select(columns: string) {
          const missing = missingColumns.find((col) => columns.includes(col));
          return {
            eq() {
              return {
                async maybeSingle() {
                  if (missing) {
                    return { data: null, error: { message: `column companies.${missing} does not exist` } };
                  }
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
}

test("complimentary company is active without Stripe and reads as Complimentary", async () => {
  const status = await getCompanyBillingStatus(
    fakeSupabase({
      subscription_status: "inactive",
      complimentary_access: true,
      complimentary_access_reason: "Partner complimentary access.",
    }),
    "company-1"
  );

  assert.equal(status.is_active, true, "complimentary access must grant access");
  assert.equal(status.stripe_active, false);
  assert.equal(status.complimentary_access, true);
  assert.equal(status.complimentary_reason, "Partner complimentary access.");
  assert.equal(status.display_status, "Complimentary");
});

test("a regular inactive company is NOT active (still needs trial or payment)", async () => {
  const status = await getCompanyBillingStatus(
    fakeSupabase({ subscription_status: "inactive", complimentary_access: false }),
    "company-2"
  );

  assert.equal(status.is_active, false);
  assert.equal(status.complimentary_access, false);
});

test("a trialing company stays active and is not flagged complimentary", async () => {
  const status = await getCompanyBillingStatus(
    fakeSupabase({ subscription_status: "trialing", complimentary_access: false }),
    "company-3"
  );

  assert.equal(status.is_active, true);
  assert.equal(status.stripe_active, true);
  assert.equal(status.complimentary_access, false);
});

test("existing free_lifetime override still grants access (backward compatible)", async () => {
  const status = await getCompanyBillingStatus(
    fakeSupabase({ subscription_status: "inactive", billing_override_type: "free_lifetime" }),
    "company-4"
  );

  assert.equal(status.is_active, true);
  assert.equal(status.override.grantsFreeAccess, true);
  assert.equal(status.display_status, "Complimentary");
});

test("falls back gracefully when the complimentary columns are not yet migrated", async () => {
  // Old schema: complimentary_access column absent, but override columns exist.
  const status = await getCompanyBillingStatus(
    fakeSupabase(
      { subscription_status: "active", billing_override_type: "none" },
      ["complimentary_access"]
    ),
    "company-5"
  );

  assert.equal(status.is_active, true, "must still resolve via the override-only select");
  assert.equal(status.complimentary_access, false);
});

test("admin console surfaces the complimentary entitlement and its internal reason", () => {
  const mapped = mapCompanyOverride({
    id: "company-1",
    name: "Cladline SW",
    email: "jaden@cladlinesw.com",
    subscription_status: "inactive",
    complimentary_access: true,
    complimentary_access_reason: "Partner complimentary access.",
  });

  assert.equal(mapped.grants_free_access, true);
  assert.equal(mapped.complimentary_access, true);
  assert.equal(mapped.complimentary_access_reason, "Partner complimentary access.");
  assert.equal(mapped.display_status, "Complimentary");
});
