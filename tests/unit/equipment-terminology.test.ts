import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("user-facing navigation says Equipment while preserving the fleet route and key", () => {
  const navigation = read("src/lib/nav/config.ts");

  assert.match(
    navigation,
    /key: "fleet", label: "Equipment", href: "\/fleet"/,
  );
});

test("user-facing surfaces do not regress to Fleet terminology", () => {
  const userFacingSources = [
    "app/page.tsx",
    "app/features/page.tsx",
    "app/pricing/page.tsx",
    "app/support/page.tsx",
    "app/testimonials/page.tsx",
    "app/components/OnboardingGate.tsx",
    "app/api/dashboard/route.ts",
    "app/api/dashboard/summary/route.ts",
    "src/lib/onboarding/checklist.ts",
    "src/lib/integrations/providerAdapters.ts",
    "reference/index.html",
    "reference/groundwork-pro-v4.html",
  ].map(read).join("\n");

  const forbiddenPhrases = [
    "Fleet Management",
    "Fleet Utilization",
    "Total Fleet",
    "Fleet Value",
    "Live Fleet",
    "Fleet & GPS",
    "Equipment Fleet Overview",
    "fleet visibility",
    "fleet asset",
    "your fleet",
  ];

  for (const phrase of forbiddenPhrases) {
    assert.equal(
      userFacingSources.includes(phrase),
      false,
      `found obsolete user-facing phrase: ${phrase}`,
    );
  }

  assert.match(userFacingSources, /Equipment Management/);
  assert.match(userFacingSources, /Equipment Utilization/);
});
