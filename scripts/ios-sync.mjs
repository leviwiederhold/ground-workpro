#!/usr/bin/env node
// Sync the iOS project against a chosen deployment, then VERIFY the result.
//
//   node scripts/ios-sync.mjs            -> production (pnpm ios:sync)
//   node scripts/ios-sync.mjs --preview  -> requires CAPACITOR_SERVER_URL (pnpm ios:preview)
//
// `cap sync` exiting 0 does not prove the URL landed in the generated config —
// a stale or partially-written capacitor.config.json would still exit 0. This
// script reads the generated file back and asserts the URL, so a successful run
// means the app really will load what you asked for.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_CONFIG = "ios/App/App/capacitor.config.json";
const PRODUCTION_SERVER_URL = "https://ground-workpro.vercel.app";

const previewMode = process.argv.includes("--preview");

const RED = "[31m";
const YELLOW = "[33m";
const GREEN = "[32m";
const DIM = "[2m";
const RESET = "[0m";

function fail(message, hint) {
  console.error(`${RED}✖ ${message}${RESET}`);
  if (hint) console.error(`${DIM}  ${hint}${RESET}`);
  process.exit(1);
}

// Mirrors src/lib/native/serverUrl.ts. Kept dependency-free so this script runs
// with plain node; the shared rules are covered by unit tests on that module.
function validate(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, message: "value is empty" };

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, message: `"${value}" is not a valid URL — include the scheme, e.g. https://…` };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, message: `"${value}" must use http or https` };
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return { ok: false, message: `"${value}" must be an origin with no path` };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, message: `"${value}" must not include a query string or fragment` };
  }
  return { ok: true, url: parsed.origin };
}

// ── Decide the target URL ────────────────────────────────────────────────────
const rawEnv = process.env.CAPACITOR_SERVER_URL;
let targetUrl;

if (previewMode) {
  if (!rawEnv || !rawEnv.trim()) {
    fail(
      "CAPACITOR_SERVER_URL is required for a preview sync.",
      'Run: CAPACITOR_SERVER_URL=https://<pr-preview>.vercel.app pnpm ios:preview\n  Or add it to .env.capacitor.local (gitignored).',
    );
  }
  const validated = validate(rawEnv);
  if (!validated.ok) fail(`CAPACITOR_SERVER_URL ${validated.message}`);
  targetUrl = validated.url;

  if (targetUrl === PRODUCTION_SERVER_URL) {
    console.warn(
      `${YELLOW}⚠ CAPACITOR_SERVER_URL is the production URL — this is a production sync, not a preview.${RESET}`,
    );
  }
} else {
  // Production sync: ignore any ambient/dotenv value so `pnpm ios:sync` always
  // means "put it back to production".
  if (rawEnv && rawEnv.trim() && validate(rawEnv).url !== PRODUCTION_SERVER_URL) {
    console.warn(
      `${YELLOW}⚠ Ignoring CAPACITOR_SERVER_URL=${rawEnv.trim()} — pnpm ios:sync always targets production.${RESET}`,
    );
    console.warn(`${DIM}  Use "pnpm ios:preview" to sync a preview deployment.${RESET}`);
  }
  targetUrl = PRODUCTION_SERVER_URL;
}

const isProduction = targetUrl === PRODUCTION_SERVER_URL;

console.log("");
console.log(`  Syncing iOS against: ${GREEN}${targetUrl}${RESET}`);
console.log(`  Target:              ${isProduction ? "PRODUCTION" : "PREVIEW (non-production)"}`);
console.log("");

// ── Sync ─────────────────────────────────────────────────────────────────────
const sync = spawnSync("npx", ["cap", "sync", "ios"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, CAPACITOR_SERVER_URL: targetUrl },
});

if (sync.status !== 0) {
  fail(`"cap sync ios" failed with exit code ${sync.status}.`);
}

// ── Verify: read the generated config back ───────────────────────────────────
let generated;
try {
  generated = JSON.parse(readFileSync(resolve(repoRoot, GENERATED_CONFIG), "utf8"));
} catch (error) {
  fail(`Could not read ${GENERATED_CONFIG} after sync: ${error.message}`);
}

const actualUrl = generated?.server?.url;
if (actualUrl !== targetUrl) {
  fail(
    `${GENERATED_CONFIG} has server.url = ${JSON.stringify(actualUrl)}, expected ${JSON.stringify(targetUrl)}.`,
    "The sync reported success but did not write the expected URL. Do not build until this is resolved.",
  );
}

if (generated?.appId !== "com.leviwiederhold.groundworkpro") {
  fail(`${GENERATED_CONFIG} has an unexpected appId: ${JSON.stringify(generated?.appId)}.`);
}

console.log("");
console.log(`${GREEN}✔ Verified${RESET} ${GENERATED_CONFIG} -> server.url = ${actualUrl}`);

if (!isProduction) {
  console.log("");
  console.log(`${YELLOW}  This is a NON-PRODUCTION build target.${RESET}`);
  console.log(`${DIM}  • Release/archive builds will refuse this URL (ios/Scripts/validate-server-url.sh).${RESET}`);
  console.log(`${DIM}  • Run "pnpm ios:sync" before archiving to restore production.${RESET}`);
}

console.log("");
console.log(`${DIM}  Next: pnpm ios:open — then delete the old app from the device, Clean Build Folder,${RESET}`);
console.log(`${DIM}  and run to a physical device. Expect a log line: "Loading app at ${targetUrl}/?gw_native=1"${RESET}`);
console.log("");
