#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = "android/app/src/main/assets/capacitor.config.json";
const productionUrl = "https://ground-workpro.vercel.app";
const androidAppId = "com.groundworkpro.app";
const nativeStartPath = "/native?gw_native=1";

const sync = spawnSync("pnpm", ["exec", "cap", "sync", "android"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, CAPACITOR_SERVER_URL: productionUrl },
});
if (sync.status !== 0) process.exit(sync.status ?? 1);

let generated;
try {
  generated = JSON.parse(readFileSync(resolve(repoRoot, generatedPath), "utf8"));
} catch (error) {
  console.error(`Android sync did not produce readable ${generatedPath}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const checks = [
  ["appId", generated?.appId, androidAppId],
  ["server.url", generated?.server?.url, productionUrl],
  ["server.appStartPath", generated?.server?.appStartPath, nativeStartPath],
  ["SocialLogin.providers.google", generated?.plugins?.SocialLogin?.providers?.google, true],
  ["SocialLogin.providers.apple", generated?.plugins?.SocialLogin?.providers?.apple, false],
];

for (const [label, actual, expected] of checks) {
  if (actual !== expected) {
    console.error(`Android sync verification failed: ${label} was ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`);
    process.exit(1);
  }
}

console.log(`Verified ${generatedPath}: ${androidAppId} -> ${productionUrl}${nativeStartPath}`);
