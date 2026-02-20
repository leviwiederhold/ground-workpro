/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

function normalizeEnvValue(value) {
  if (!value) return "";
  return value.trim().replace(/^['\"]|['\"]$/g, "");
}

function validateUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const missing = [];
for (const key of REQUIRED_ENV_KEYS) {
  const value = normalizeEnvValue(process.env[key]);
  if (!value) {
    missing.push(key);
  }
}

if (missing.length > 0) {
  console.error("\n❌ Missing required environment variables for build:\n");
  for (const key of missing) {
    console.error(`- ${key}`);
  }
  console.error("\nSet these variables in your environment (for Vercel: Project Settings → Environment Variables).\n");
  process.exit(1);
}

const supabaseUrl = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
if (!validateUrl(supabaseUrl)) {
  console.error("\n❌ Invalid NEXT_PUBLIC_SUPABASE_URL: expected a valid http(s) URL.\n");
  process.exit(1);
}

console.log("✅ Environment check passed.");
