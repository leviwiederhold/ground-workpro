import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  PRODUCTION_SERVER_URL,
  isProductionServerUrl,
  resolveServerUrl,
  validateServerUrl,
} from "../../src/lib/native/serverUrl.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function trackedByGit(relativePath: string): boolean {
  const output = execFileSync("git", ["ls-files", "--", relativePath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return output.trim().length > 0;
}

// ── Default must stay production ─────────────────────────────────────────────
test("production URL is the default when the variable is unset or blank", () => {
  assert.equal(PRODUCTION_SERVER_URL, "https://ground-workpro.vercel.app");

  for (const input of [undefined, null, "", "   "]) {
    const result = resolveServerUrl(input);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.url, PRODUCTION_SERVER_URL);
    assert.equal(result.ok && result.isProduction, true);
    assert.equal(result.ok && result.source, "default");
  }
});

test("a valid preview URL is accepted and flagged non-production", () => {
  const result = resolveServerUrl("https://groundwork-pro-git-codex-native-id-token-auth.vercel.app");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.isProduction, false);
  assert.equal(result.ok && result.source, "environment");
});

test("trailing slashes and surrounding whitespace are normalized away", () => {
  const result = resolveServerUrl("  https://preview.vercel.app/  ");
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.url, "https://preview.vercel.app");
});

// ── Invalid input must fail, never silently fall back ────────────────────────
test("invalid URLs are rejected rather than falling back to production", () => {
  const cases: Array<[string, RegExp]> = [
    ["not a url", /not a valid URL/],
    ["ground-workpro.vercel.app", /not a valid URL/], // missing scheme
    ["ftp://ground-workpro.vercel.app", /http or https/],
    ["https://ground-workpro.vercel.app/login", /no path/],
    ["https://ground-workpro.vercel.app?x=1", /query string or fragment/],
    ["https://ground-workpro.vercel.app#frag", /query string or fragment/],
  ];

  for (const [input, expected] of cases) {
    const result = resolveServerUrl(input);
    assert.equal(result.ok, false, `expected "${input}" to be rejected`);
    assert.match(result.ok === false ? result.message : "", expected);
    // The critical property: a bad value must NOT quietly become production.
    assert.ok(!("url" in result), `"${input}" must not resolve to a URL`);
  }
});

test("validateServerUrl distinguishes empty from malformed", () => {
  const empty = validateServerUrl("   ");
  assert.equal(empty.ok, false);
  assert.match(empty.ok === false ? empty.message : "", /empty/);
});

// ── Production detection drives the archive guard ────────────────────────────
test("isProductionServerUrl matches only the exact production host", () => {
  assert.equal(isProductionServerUrl("https://ground-workpro.vercel.app"), true);
  assert.equal(isProductionServerUrl("https://ground-workpro.vercel.app/"), true);

  // Lookalikes that must NOT pass the archive guard.
  for (const impostor of [
    "https://groundwork-pro-git-branch-scope.vercel.app",
    "https://ground-workpro-preview.vercel.app",
    "https://ground-workpro.vercel.app.evil.com",
    "http://localhost:3000",
    "not a url",
  ]) {
    assert.equal(isProductionServerUrl(impostor), false, `${impostor} must not count as production`);
  }
});

// ── Wiring: the pieces that make the flow work on device ─────────────────────
test("the archive guard is wired into the Xcode build phase", () => {
  const script = "ios/Scripts/validate-server-url.sh";
  assert.ok(existsSync(join(repoRoot, script)), `${script} must exist`);

  const pbxproj = read("ios/App/App.xcodeproj/project.pbxproj");
  assert.match(pbxproj, /validate-server-url\.sh/, "the guard must run as a build phase");

  const body = read(script);
  assert.match(body, /ALLOW_NON_PRODUCTION_SERVER_URL/, "an explicit override must exist");
  assert.match(body, /CONFIGURATION.*Release|Release.*CONFIGURATION/, "Release must be handled specially");
  assert.match(body, /exit 1/, "Release must fail the build");
  assert.match(body, /ground-workpro\.vercel\.app/, "the production URL must be the expected value");
});

test("AppDelegate reads the server URL from the synced config, not a hardcoded one", () => {
  const appDelegate = read("ios/App/App/AppDelegate.swift");

  // The original bug: a hardcoded production URL that force-loaded over whatever
  // cap sync wrote, making preview testing impossible.
  assert.match(
    appDelegate,
    /readConfiguredServerURL/,
    "AppDelegate must read server.url from capacitor.config.json",
  );
  assert.match(appDelegate, /capacitor\.config.*json|forResource: "capacitor\.config"/);
  assert.doesNotMatch(
    appDelegate,
    /private let productionAppURL = URL\(string: "https:\/\/ground-workpro\.vercel\.app/,
    "the hardcoded force-loaded production URL must not come back",
  );

  // Diagnostics must be debug-only so Release logs stay quiet.
  assert.match(appDelegate, /#if DEBUG/, "startup diagnostics must be compiled out of Release");
  assert.match(appDelegate, /Loading app at/, "the resolved URL must be logged");
});

test("helper scripts exist and the preview script requires the variable", () => {
  const pkg = JSON.parse(read("package.json"));
  for (const script of ["ios:sync", "ios:preview", "ios:open"]) {
    assert.ok(pkg.scripts?.[script], `package.json must define the "${script}" script`);
  }

  const syncScript = read("scripts/ios-sync.mjs");
  assert.match(syncScript, /CAPACITOR_SERVER_URL is required/, "preview mode must require the variable");
  assert.match(syncScript, /capacitor\.config\.json/, "the script must verify the generated config");
  assert.match(syncScript, /expected/, "the script must compare against the expected URL");
});

test("no preview URL is committed as a default", () => {
  // The production default must be the only URL baked into tracked config.
  const capacitorConfig = read("capacitor.config.ts");
  assert.doesNotMatch(capacitorConfig, /vercel\.app/, "capacitor.config.ts must not hardcode any deployment URL");

  // Only the production URL may appear in an assignment. URLs inside comments
  // and error-message examples are documentation, not configuration.
  const serverUrlModule = read("src/lib/native/serverUrl.ts");
  const assignments = [...serverUrlModule.matchAll(/=\s*"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  assert.ok(assignments.length > 0, "expected at least one URL assignment");
  for (const url of assignments) {
    assert.equal(url, PRODUCTION_SERVER_URL, `only the production URL may be hardcoded, found ${url}`);
  }

  // The local override file is expected to exist on a configured machine; what
  // matters is that git never tracks it.
  assert.equal(
    trackedByGit(".env.capacitor.local"),
    false,
    ".env.capacitor.local holds a developer's preview URL and must never be tracked",
  );
  assert.match(read(".gitignore"), /^\.env\*\.local$/m, ".env.capacitor.local must be gitignored");
});
