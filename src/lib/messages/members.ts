import { SupabaseClient } from "@supabase/supabase-js";

export async function getMyMembership(
  supabase: SupabaseClient,
  companyId: string,
  channelId: string,
  userId: string
) {
  const result = await supabase
    .from("message_channel_members")
    .select("id, member_role")
    .eq("company_id", companyId)
    .eq("channel_id", channelId)
    .eq("user_id", userId)
    .maybeSingle();

  return result;
}

export async function getChannelMemberRoles(
  supabase: SupabaseClient,
  companyId: string,
  channelId: string,
  userIds: string[]
) {
  if (userIds.length === 0) return { data: [], error: null };
  return supabase
    .from("message_channel_members")
    .select("user_id, member_role")
    .eq("company_id", companyId)
    .eq("channel_id", channelId)
    .in("user_id", userIds);
}

export function dedupeUserIds(userIds: string[], currentUserId: string) {
  return Array.from(new Set([currentUserId, ...userIds.filter(Boolean)]));
}
