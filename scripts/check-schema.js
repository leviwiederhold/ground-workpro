/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

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

function normalizeEnvValue(value) {
  if (!value) return "";
  return value.trim().replace(/^['"]|['"]$/g, "");
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

const supabaseUrl = normalizeEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
const serviceRoleKey = normalizeEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY);

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const required = [
  { table: "companies", columnsAnyOf: [["id", "name"]] },
  { table: "memberships", columnsAnyOf: [["id", "company_id", "user_id", "role"]] },
  { table: "employees", columnsAnyOf: [["id", "company_id", "full_name", "role", "status", "email"]] },
  { table: "jobs", columnsAnyOf: [["id", "company_id", "name", "status"]] },
  { table: "equipment", columnsAnyOf: [["id", "company_id", "name", "status"]] },
  { table: "work_orders", columnsAnyOf: [["id", "company_id", "equipment_id", "status", "title"]] },
  { table: "vendors", columnsAnyOf: [["id", "company_id", "name", "status", "payment_terms"], ["id", "company_id", "name", "status"]] },
  { table: "inventory", columnsAnyOf: [["id", "company_id", "name", "on_hand", "reserved_quantity"], ["id", "company_id", "name", "quantity_on_hand"]] },
  { table: "daily_reports", columnsAnyOf: [["id", "company_id", "job_id", "report_date"]] },
  { table: "safety_logs", columnsAnyOf: [["id", "company_id", "occurred_on", "summary", "severity"]] },
  { table: "attachments", columnsAnyOf: [["id", "company_id", "entity_type", "entity_id", "file_name"]] },
  { table: "message_channels", columnsAnyOf: [["id", "company_id", "name"]] },
  { table: "messages", columnsAnyOf: [["id", "company_id", "channel_id", "body", "sender_user_id"]] },
  { table: "message_channel_members", columnsAnyOf: [["id", "company_id", "channel_id", "user_id"]] },
  { table: "notifications", columnsAnyOf: [["id", "company_id", "user_id", "type", "payload"]] },
  { table: "schedule_assignments", columnsAnyOf: [["id", "company_id", "job_id", "date"]] },
  { table: "calendar_events", columnsAnyOf: [["id", "company_id", "title", "starts_at", "ends_at", "visibility"]] },
  { table: "calendar_event_attendees", columnsAnyOf: [["id", "company_id", "event_id", "attendee_type"]] },
  { table: "training_courses", columnsAnyOf: [["id", "company_id", "title", "video_url"]] },
];

async function main() {
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const failures = [];

  for (const item of required) {
    let passed = false;
    const errors = [];
    for (const columns of item.columnsAnyOf) {
      const selectExpr = columns.join(",");
      const { error } = await supabase.from(item.table).select(selectExpr).limit(1);
      if (!error) {
        passed = true;
        break;
      }
      errors.push(error.message);
    }

    if (!passed) {
      failures.push({
        table: item.table,
        message: errors[0] || "Unknown schema error",
      });
    }
  }

  if (failures.length > 0) {
    console.error("Schema check failed:");
    for (const failure of failures) {
      console.error(`- ${failure.table}: ${failure.message}`);
    }
    process.exit(1);
  }

  console.log(`Schema check passed (${required.length} table checks).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
