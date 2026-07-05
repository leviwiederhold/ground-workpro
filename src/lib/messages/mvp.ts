import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type ParticipantRow = {
  thread_id: string;
  user_id: string;
  last_read_at: string | null;
};

type ThreadRow = {
  id: string;
  company_id: string;
  kind: string;
  name: string | null;
  is_companywide?: boolean | null;
  dm_user_a: string | null;
  dm_user_b: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
  edited_at?: string | null;
};

function getMessagingDb(supabase: SupabaseClient) {
  return getSupabaseAdmin() ?? supabase;
}

const pickDisplayName = ({
  fullName,
  displayName,
  email,
}: {
  fullName?: unknown;
  displayName?: unknown;
  email?: unknown;
}) => {
  const normalizedFullName = String(fullName ?? "").trim();
  if (normalizedFullName) return normalizedFullName;
  const normalizedDisplayName = String(displayName ?? "").trim();
  if (normalizedDisplayName) return normalizedDisplayName;
  const normalizedEmail = String(email ?? "").trim();
  if (normalizedEmail) return normalizedEmail;
  return "";
};

export function sortDirectPair(userA: string, userB: string): [string, string] {
  return [userA, userB].sort((a, b) => a.localeCompare(b)) as [string, string];
}

export async function ensureCompanyMember(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<boolean> {
  const result = await supabase
    .from("memberships")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  return !result.error && Boolean(result.data?.user_id);
}

export async function findDirectThread(
  supabase: SupabaseClient,
  companyId: string,
  userA: string,
  userB: string
): Promise<ThreadRow | null> {
  const [dmUserA, dmUserB] = sortDirectPair(userA, userB);
  const result = await getMessagingDb(supabase)
    .from("message_threads")
    .select("id, company_id, kind, name, dm_user_a, dm_user_b, created_at, updated_at, last_message_at")
    .eq("company_id", companyId)
    .eq("kind", "direct")
    .eq("dm_user_a", dmUserA)
    .eq("dm_user_b", dmUserB)
    .limit(1)
    .maybeSingle();

  if (result.error || !result.data) return null;
  return result.data as ThreadRow;
}

export async function ensureParticipants(
  supabase: SupabaseClient,
  companyId: string,
  threadId: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return;

  const uniqueUserIds = Array.from(new Set(userIds.map((id) => String(id).trim()).filter(Boolean)));
  if (uniqueUserIds.length === 0) return;

  const now = new Date().toISOString();
  const rows = uniqueUserIds.map((userId) => ({
    company_id: companyId,
    thread_id: threadId,
    user_id: userId,
    last_read_at: now,
  }));

  const participantClient = getSupabaseAdmin() ?? supabase;
  const upsertResult = await participantClient
    .from("message_participants")
    .upsert(rows, { onConflict: "company_id,thread_id,user_id", ignoreDuplicates: false });

  if (upsertResult.error) {
    throw new Error(upsertResult.error.message);
  }
}

export function uniqueParticipantUserIds(userIds: string[]): string[] {
  return Array.from(new Set(userIds.map((id) => String(id).trim()).filter(Boolean)));
}

export async function getOrCreateDirectThread(
  supabase: SupabaseClient,
  companyId: string,
  currentUserId: string,
  otherUserId: string
): Promise<ThreadRow> {
  const [dmUserA, dmUserB] = sortDirectPair(currentUserId, otherUserId);

  const existing = await findDirectThread(supabase, companyId, dmUserA, dmUserB);
  if (existing) {
    await ensureParticipants(supabase, companyId, existing.id, [currentUserId, otherUserId]);
    return existing;
  }

  const now = new Date().toISOString();
  const insertResult = await supabase
    .from("message_threads")
    .insert({
      company_id: companyId,
      kind: "direct",
      type: "direct",
      name: null,
      dm_user_a: dmUserA,
      dm_user_b: dmUserB,
      created_by: currentUserId,
      created_at: now,
      updated_at: now,
      last_message_at: null,
    })
    .select("id, company_id, kind, name, dm_user_a, dm_user_b, created_at, updated_at, last_message_at")
    .single();

  if (insertResult.error) {
    const maybeExisting = await findDirectThread(supabase, companyId, dmUserA, dmUserB);
    if (!maybeExisting) {
      throw new Error(insertResult.error.message || "Failed to create direct thread");
    }
    await ensureParticipants(supabase, companyId, maybeExisting.id, [currentUserId, otherUserId]);
    return maybeExisting;
  }

  const thread = insertResult.data as ThreadRow;
  await ensureParticipants(supabase, companyId, thread.id, [currentUserId, otherUserId]);
  return thread;
}

export async function createGroupThread(
  supabase: SupabaseClient,
  companyId: string,
  currentUserId: string,
  participantUserIds: string[],
  groupName: string | null
): Promise<ThreadRow> {
  const uniqueUserIds = uniqueParticipantUserIds([currentUserId, ...participantUserIds]);
  const otherUserIds = uniqueUserIds.filter((id) => id !== String(currentUserId));
  if (otherUserIds.length < 2) {
    throw new Error("Group threads require at least two teammates");
  }

  const now = new Date().toISOString();
  const insertResult = await supabase
    .from("message_threads")
    .insert({
      company_id: companyId,
      kind: "group",
      type: "group",
      name: groupName,
      dm_user_a: currentUserId,
      dm_user_b: otherUserIds[0],
      created_by: currentUserId,
      created_at: now,
      updated_at: now,
      last_message_at: null,
    })
    .select("id, company_id, kind, name, dm_user_a, dm_user_b, created_at, updated_at, last_message_at")
    .single();

  if (insertResult.error || !insertResult.data) {
    throw new Error(insertResult.error?.message || "Failed to create group thread");
  }

  const thread = insertResult.data as ThreadRow;
  await ensureParticipants(supabase, companyId, thread.id, uniqueUserIds);
  return thread;
}

export async function getThreadIfParticipant(
  supabase: SupabaseClient,
  companyId: string,
  threadId: string,
  userId: string
): Promise<{ thread: ThreadRow | null; participant: ParticipantRow | null }> {
  const db = getMessagingDb(supabase);

  const participantResult = await db
    .from("message_participants")
    .select("thread_id, user_id, last_read_at")
    .eq("company_id", companyId)
    .eq("thread_id", threadId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (participantResult.error || !participantResult.data) {
    return { thread: null, participant: null };
  }

  const threadResult = await db
    .from("message_threads")
    .select("id, company_id, kind, name, dm_user_a, dm_user_b, created_at, updated_at, last_message_at")
    .eq("company_id", companyId)
    .eq("id", threadId)
    .limit(1)
    .maybeSingle();

  if (threadResult.error || !threadResult.data) {
    return { thread: null, participant: participantResult.data as ParticipantRow };
  }

  return {
    thread: threadResult.data as ThreadRow,
    participant: participantResult.data as ParticipantRow,
  };
}

export async function listParticipantRowsForUser(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<ParticipantRow[]> {
  const result = await getMessagingDb(supabase)
    .from("message_participants")
    .select("thread_id, user_id, last_read_at")
    .eq("company_id", companyId)
    .eq("user_id", userId);

  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as ParticipantRow[];
}

export async function listParticipantRowsForThreads(
  supabase: SupabaseClient,
  companyId: string,
  threadIds: string[]
): Promise<ParticipantRow[]> {
  if (threadIds.length === 0) return [];
  const result = await getMessagingDb(supabase)
    .from("message_participants")
    .select("thread_id, user_id, last_read_at")
    .eq("company_id", companyId)
    .in("thread_id", threadIds);

  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as ParticipantRow[];
}

export async function listThreadsByIds(
  supabase: SupabaseClient,
  companyId: string,
  threadIds: string[]
): Promise<ThreadRow[]> {
  if (threadIds.length === 0) return [];

  const db = getMessagingDb(supabase);
  let result = await db
    .from("message_threads")
    .select("id, company_id, kind, name, is_companywide, dm_user_a, dm_user_b, created_at, updated_at, last_message_at")
    .eq("company_id", companyId)
    .in("id", threadIds);

  // Tolerate environments where the companywide migration hasn't run yet.
  if (result.error && /is_companywide/i.test(result.error.message || "")) {
    result = (await db
      .from("message_threads")
      .select("id, company_id, kind, name, dm_user_a, dm_user_b, created_at, updated_at, last_message_at")
      .eq("company_id", companyId)
      .in("id", threadIds)) as typeof result;
  }

  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as ThreadRow[];
}

export async function listMessagesByThreadIds(
  supabase: SupabaseClient,
  companyId: string,
  threadIds: string[]
): Promise<MessageRow[]> {
  if (threadIds.length === 0) return [];

  const result = await getMessagingDb(supabase)
    .from("messages")
    .select("id, thread_id, sender_user_id, body, created_at")
    .eq("company_id", companyId)
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });

  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as MessageRow[];
}

export async function listMessagesForThread(
  supabase: SupabaseClient,
  companyId: string,
  threadId: string,
  from: number,
  to: number
): Promise<{ items: MessageRow[]; count: number }> {
  const db = getMessagingDb(supabase);
  const runQuery = (columns: string) =>
    db
      .from("messages")
      .select(columns, { count: "exact" })
      .eq("company_id", companyId)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .range(from, to);

  // Prefer selecting edited_at; tolerate environments where the migration that
  // adds it has not been applied yet (fall back to the base columns).
  let result = await runQuery("id, thread_id, sender_user_id, body, created_at, edited_at");
  if (result.error && /edited_at/i.test(result.error.message || "")) {
    result = await runQuery("id, thread_id, sender_user_id, body, created_at");
  }

  if (result.error) throw new Error(result.error.message);
  return {
    items: (result.data ?? []) as unknown as MessageRow[],
    count: Number(result.count ?? 0),
  };
}

export function buildGroupThreadDisplayName(input: {
  participantUserIds: string[];
  currentUserId: string;
  displayNames: Map<string, string>;
}): string {
  const otherNames = Array.from(
    new Set(
      input.participantUserIds
        .filter((id) => String(id) !== String(input.currentUserId))
        .map((id) => String(input.displayNames.get(String(id)) || "Team Member").trim())
        .filter(Boolean)
    )
  );

  if (otherNames.length === 0) return "Group Chat";
  if (otherNames.length <= 3) return otherNames.join(", ");
  return `${otherNames.slice(0, 3).join(", ")} +${otherNames.length - 3}`;
}

export async function resolveDisplayNames(
  supabase: SupabaseClient,
  companyId: string,
  userIds: string[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(userIds.map((id) => String(id).trim()).filter(Boolean)));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  // Resolve names with the admin client so every member's profile/employee name
  // is readable regardless of the VIEWER's RLS. Otherwise an employee can't read
  // the owner's profile full_name and the sender falls back to their email.
  const db = getSupabaseAdmin() ?? supabase;

  const profilesResult = await db
    .from("profiles")
    .select("id, full_name, display_name")
    .in("id", unique);
  let profileRows: Array<{ id?: string; full_name?: string; display_name?: string }> = [];
  if (!profilesResult.error) {
    profileRows = (profilesResult.data ?? []) as Array<{
      id?: string;
      full_name?: string;
      display_name?: string;
    }>;
  } else if (
    /display_name|Could not find the 'display_name' column/i.test(profilesResult.error.message || "")
  ) {
    const fallbackProfilesResult = await db
      .from("profiles")
      .select("id, full_name")
      .in("id", unique);
    if (!fallbackProfilesResult.error) {
      profileRows = (fallbackProfilesResult.data ?? []).map((row) => ({
        id: (row as { id?: string }).id,
        full_name: (row as { full_name?: string }).full_name,
      }));
    }
  }

  for (const row of profileRows) {
      const resolved = pickDisplayName({
        fullName: row.full_name,
        displayName: (row as { display_name?: string }).display_name,
      });
      if (resolved) map.set(String(row.id), resolved);
  }

  const employeesPrimaryResult = await db
    .from("employees")
    .select("user_id, name, full_name, email")
    .eq("company_id", companyId)
    .in("user_id", unique);

  let employeeRows: Array<{ user_id?: string; name?: string; full_name?: string; email?: string }> = [];
  if (!employeesPrimaryResult.error) {
    employeeRows = (employeesPrimaryResult.data ?? []) as Array<{
      user_id?: string;
      name?: string;
      full_name?: string;
      email?: string;
    }>;
  } else if (
    /column employees\.name does not exist|Could not find the 'name' column/i.test(
      employeesPrimaryResult.error.message || ""
    )
  ) {
    const employeesFallbackResult = await db
      .from("employees")
      .select("user_id, full_name")
      .eq("company_id", companyId)
      .in("user_id", unique);
    if (!employeesFallbackResult.error) {
      employeeRows = (employeesFallbackResult.data ?? []) as Array<{
        user_id?: string;
        full_name?: string;
      }>;
    }
  }

  for (const employee of employeeRows) {
    const key = String(employee.user_id ?? "").trim();
    if (!key || map.has(key)) continue;
    const resolved = pickDisplayName({
      fullName: employee.full_name,
      displayName: employee.name,
      email: employee.email,
    });
    if (resolved) map.set(key, resolved);
  }

  const admin = getSupabaseAdmin();
  if (admin) {
    const missingUserIds = unique.filter((id) => !map.has(id));
    if (missingUserIds.length > 0) {
      const listUsersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!listUsersResult.error) {
        const emailByUserId = new Map(
          (listUsersResult.data.users ?? []).map((row) => [
            String(row.id),
            String(row.email ?? "").trim(),
          ])
        );
        for (const missingUserId of missingUserIds) {
          const email = emailByUserId.get(missingUserId);
          if (email) map.set(missingUserId, email);
        }
      }
    }
  }

  for (const id of unique) {
    if (!map.has(id)) map.set(id, "Team Member");
  }

  return map;
}

export async function resolveAvatarUrls(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const unique = uniqueParticipantUserIds(userIds);
  const map = new Map<string, string>();
  if (unique.length === 0) return map;

  const profilesResult = await supabase
    .from("profiles")
    .select("id, avatar_url")
    .in("id", unique);

  if (!profilesResult.error) {
    for (const row of (profilesResult.data ?? []) as Array<{ id?: string; avatar_url?: string }>) {
      const id = String(row.id ?? "").trim();
      const avatarUrl = String(row.avatar_url ?? "").trim();
      if (id && avatarUrl) map.set(id, avatarUrl);
    }
    return map;
  }

  if (/avatar_url|Could not find the 'avatar_url' column/i.test(profilesResult.error.message || "")) {
    return map;
  }

  throw new Error(profilesResult.error.message);
}
