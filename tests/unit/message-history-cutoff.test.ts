import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canViewCompanyMessageAt,
  getMessageHistoryCutoff,
} from "../../src/lib/messages/historyAccess.ts";

const joinDate = "2026-09-29T12:00:00.000Z";

test("new non-admin employees see messages from their database membership cutoff onward", () => {
  const membership = { role: "team_member", message_history_cutoff_at: joinDate };
  assert.equal(getMessageHistoryCutoff(membership), joinDate);
  assert.equal(canViewCompanyMessageAt(membership, "2026-09-29T11:59:59.999Z"), false);
  assert.equal(canViewCompanyMessageAt(membership, joinDate), true);
  assert.equal(canViewCompanyMessageAt(membership, "2026-09-29T12:00:00.001Z"), true);
});

test("memberships that existed at rollout retain their prior full history", () => {
  const existingMembership = { role: "team_member", message_history_cutoff_at: null };
  assert.equal(getMessageHistoryCutoff(existingMembership), null);
  assert.equal(canViewCompanyMessageAt(existingMembership, "2019-01-01T00:00:00.000Z"), true);
});

test("owner and administrator roles retain full company message history", () => {
  for (const role of ["owner", "co_owner", "administrator", "admin", "executive", "ceo"]) {
    assert.equal(
      canViewCompanyMessageAt(
        { role, message_history_cutoff_at: joinDate },
        "2019-01-01T00:00:00.000Z"
      ),
      true,
      `${role} should retain current history access`
    );
  }
});

test("database migration preserves existing memberships and enforces RLS on messages, attachments, storage, and notifications", () => {
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260929_01_company_message_history_cutoff.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(migration, /add column if not exists message_history_cutoff_at timestamptz null/i);
  assert.match(migration, /new\.created_at := clock_timestamp\(\)/i);
  assert.match(migration, /new\.message_history_cutoff_at := new\.created_at/i);
  assert.match(migration, /target_user_id = auth\.uid\(\)/i);
  assert.match(
    migration,
    /user_can_view_company_message_at\(company_id, auth\.uid\(\), created_at\)/i
  );
  assert.match(migration, /message_attachments_storage_history_select/i);
  assert.match(migration, /message_attachments_storage_history_guard[\s\S]*?as restrictive/i);
  assert.match(migration, /message_threads_history_guard[\s\S]*?as restrictive/i);
  assert.match(migration, /legacy_messages_history_select_guard/i);
  assert.match(migration, /type <> 'new_message'/i);
  assert.doesNotMatch(migration, /delete from public\.messages|update public\.messages/i);
});
