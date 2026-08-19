import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasStoredAuthSessionLocalStorage } from "../../src/lib/theme/appearance.ts";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function storageWithKeys(keys: string[]) {
  return {
    length: keys.length,
    key: (index: number) => keys[index] ?? null,
  };
}

test("native/local-storage Supabase sessions are recognized as authenticated theme state", () => {
  assert.equal(
    hasStoredAuthSessionLocalStorage(storageWithKeys(["sb-ucyalowqzvkybnfgucem-auth-token"])),
    true,
  );
  assert.equal(hasStoredAuthSessionLocalStorage(storageWithKeys(["groundwork.appearance"])), false);
  assert.equal(hasStoredAuthSessionLocalStorage(null), false);
});

test("root Dashboard theme follows auth state and live appearance changes", () => {
  const initializer = read("app/components/theme/ThemeInitializer.tsx");
  assert.match(initializer, /hasStoredAuthSessionLocalStorage/);
  assert.match(initializer, /supabase\.auth\.getSession\(\)/);
  assert.match(initializer, /supabase\.auth\.onAuthStateChange/);
  assert.match(initializer, /window\.addEventListener\("appearance:change"/);
  assert.match(initializer, /activateAuthenticatedTheme[\s\S]*?clearForcePublicTheme\(\)/);
  assert.doesNotMatch(
    initializer,
    /pathname === "\/" && \(forcePublicTheme \|\| !hasStoredAuthSessionCookie[\s\S]*?return;/,
  );
});

test("Dashboard and feedback states use the shared dark theme surface", () => {
  const dashboard = read("app/components/views/DashboardView.tsx");
  const feedback = read("app/components/ui/FeedbackBlocks.tsx");
  const globals = read("app/globals.css");
  assert.match(dashboard, /data-testid="dashboard-view"/);
  assert.match(dashboard, /dark:bg-\[#050505\]/);
  assert.match(feedback, /dark:bg-\[#090909\]/);
  assert.match(feedback, /dark:bg-zinc-800/);
  assert.match(globals, /html\[data-theme="dark"\] \.mobile-app-shell/);
});

test("the pre-hydration theme bootstrap recognizes cookie and local-storage auth", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /hasAuthCookie/);
  assert.match(layout, /hasAuthStorage/);
  assert.match(layout, /localStorage\.key\(i\)/);
});
