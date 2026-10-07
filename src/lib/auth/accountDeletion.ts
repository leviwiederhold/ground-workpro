/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Auth deletion cascades identity rows. Keep Auth users that still anchor a
 * company, another membership, retained message/time history, or stored avatar.
 * Missing/unavailable tables are treated as blockers so schema drift cannot
 * turn a cleanup failure into data loss.
 */
export async function getAccountDeletionBlocker(admin: any, userId: string): Promise<string | null> {
  const owner = await admin
    .from("companies")
    .select("id")
    .eq("primary_owner_user_id", userId)
    .limit(1);
  if (owner.error) return "Company ownership could not be verified.";
  if ((owner.data ?? []).length) return "Transfer primary ownership before deleting this account.";

  const memberships = await admin.from("memberships").select("company_id").eq("user_id", userId).limit(1);
  if (memberships.error) return "Company memberships could not be verified.";
  if ((memberships.data ?? []).length) return "This account still belongs to another company.";

  const retainedReferences: Array<[string, string]> = [
    ["messages", "sender_user_id"],
    ["legacy_messages", "sender_user_id"],
    ["message_participants", "user_id"],
    ["message_threads", "created_by"],
    ["message_threads", "dm_user_a"],
    ["message_threads", "dm_user_b"],
    ["time_entries", "user_id"],
  ];
  for (const [table, column] of retainedReferences) {
    const result = await admin.from(table).select("id").eq(column, userId).limit(1);
    if (result.error) {
      // legacy_messages may not exist in older installations; all other
      // failures must fail closed because deletion would be unverified.
      if (table === "legacy_messages" && /does not exist|not find/i.test(result.error.message ?? "")) continue;
      return `Retained ${table.replaceAll("_", " ")} data could not be verified.`;
    }
    if ((result.data ?? []).length) return `This account has retained ${table.replaceAll("_", " ")} history.`;
  }

  const profile = await admin.from("profiles").select("avatar_url").eq("id", userId).maybeSingle();
  if (profile.error) return "Profile storage references could not be verified.";
  if (String(profile.data?.avatar_url ?? "").trim()) {
    return "Remove the profile avatar before deleting this account.";
  }

  return null;
}
