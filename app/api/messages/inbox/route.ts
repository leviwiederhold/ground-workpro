import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
import { listFallbackChannels, listFallbackMessages } from "@/lib/messages/fallbackStore";

export const dynamic = "force-dynamic";

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

const querySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

function toValidationDetails(error: { issues: ValidationIssue[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

function isMissingMessagesTables(message: string) {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes("message_channels") || normalized.includes("messages") || normalized.includes("message_channel_members")) &&
    (normalized.includes("does not exist") || normalized.includes("not find"))
  );
}

function isMissingMessagesColumns(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("column") && (normalized.includes("kind") || normalized.includes("dm_user_a") || normalized.includes("dm_user_b") || normalized.includes("last_read_at"));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsedQuery = querySchema.safeParse({
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });
    if (!parsedQuery.success) return validationError(toValidationDetails(parsedQuery.error));

    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId, userId } = await getCompanyId();

    let memberships = await supabase
      .from("message_channel_members")
      .select("channel_id, last_read_at")
      .eq("company_id", companyId)
      .eq("user_id", userId);

    if (memberships.error) {
      if (isMissingMessagesTables(memberships.error.message || "")) {
        const fallbackItems = listFallbackChannels(companyId).map((channel) => {
          const channelMessages = listFallbackMessages(companyId, String(channel.id));
          const latest = channelMessages[channelMessages.length - 1];
          return {
            id: channel.id,
            kind: "channel",
            name: channel.name,
            created_at: channel.created_at,
            updated_at: channel.updated_at,
            message_count: channelMessages.length,
            unread_count: 0,
            last_message_at: latest?.created_at ?? null,
            last_message_preview: latest?.body ?? null,
            member_count: 0,
          };
        });
        const sorted = fallbackItems.sort((a, b) => String(b.last_message_at || b.created_at).localeCompare(String(a.last_message_at || a.created_at)));
        return Response.json({ items: sorted.slice(from, to + 1), unread_count: 0, ...getPaginationMeta(sorted.length, page, pageSize) });
      }
      if (isMissingMessagesColumns(memberships.error.message || "")) {
        const legacyMemberships = await supabase
          .from("message_channel_members")
          .select("channel_id")
          .eq("company_id", companyId)
          .eq("user_id", userId);
        if (legacyMemberships.error) return serverError();
        memberships = {
          ...legacyMemberships,
          data: (legacyMemberships.data ?? []).map((row) => ({ ...row, last_read_at: null })),
        };
      } else {
        return serverError();
      }
    }

    const channelIds = Array.from(new Set((memberships.data ?? []).map((row) => String(row.channel_id))));
    if (channelIds.length === 0) {
      return Response.json({ items: [], unread_count: 0, ...getPaginationMeta(0, page, pageSize) });
    }

    let channelsResult = await supabase
      .from("message_channels")
      .select("id, name, kind, created_at, updated_at, dm_user_a, dm_user_b")
      .eq("company_id", companyId)
      .in("id", channelIds);
    if (channelsResult.error && isMissingMessagesColumns(channelsResult.error.message || "")) {
      const legacyChannelsResult = await supabase
        .from("message_channels")
        .select("id, name, created_at, updated_at")
        .eq("company_id", companyId)
        .in("id", channelIds);
      if (legacyChannelsResult.error) return serverError();
      channelsResult = {
        ...legacyChannelsResult,
        data: (legacyChannelsResult.data ?? []).map((row) => ({
          ...row,
          kind: "channel",
          dm_user_a: null,
          dm_user_b: null,
        })),
      };
    }
    if (channelsResult.error) {
      return Response.json({ items: [], unread_count: 0, ...getPaginationMeta(0, page, pageSize) });
    }

    const memberCountsResult = await supabase
      .from("message_channel_members")
      .select("channel_id")
      .eq("company_id", companyId)
      .in("channel_id", channelIds);
    if (memberCountsResult.error) {
      return Response.json({ items: [], unread_count: 0, ...getPaginationMeta(0, page, pageSize) });
    }

    const messagesResult = await supabase
      .from("messages")
      .select("channel_id, body, created_at")
      .eq("company_id", companyId)
      .in("channel_id", channelIds)
      .order("created_at", { ascending: false });
    if (messagesResult.error) {
      return Response.json({ items: [], unread_count: 0, ...getPaginationMeta(0, page, pageSize) });
    }

    const memberReadMap = new Map((memberships.data ?? []).map((row) => [String(row.channel_id), row.last_read_at ? new Date(row.last_read_at).getTime() : 0]));
    const latestByChannel = new Map<string, { body: string; createdAt: string }>();
    const messageCountByChannel = new Map<string, number>();
    const unreadByChannel = new Map<string, number>();
    for (const msg of messagesResult.data ?? []) {
      const key = String(msg.channel_id);
      if (!latestByChannel.has(key)) {
        latestByChannel.set(key, { body: String(msg.body ?? ""), createdAt: String(msg.created_at ?? "") });
      }
      messageCountByChannel.set(key, (messageCountByChannel.get(key) ?? 0) + 1);
      const readAt = memberReadMap.get(key) ?? 0;
      const createdAt = msg.created_at ? new Date(msg.created_at).getTime() : 0;
      if (createdAt > readAt) {
        unreadByChannel.set(key, (unreadByChannel.get(key) ?? 0) + 1);
      }
    }

    const memberCountByChannel = new Map<string, number>();
    for (const member of memberCountsResult.data ?? []) {
      const key = String(member.channel_id);
      memberCountByChannel.set(key, (memberCountByChannel.get(key) ?? 0) + 1);
    }

    const items = (channelsResult.data ?? []).map((channel) => {
      const key = String(channel.id);
      const latest = latestByChannel.get(key);
      return {
        id: channel.id,
        kind: channel.kind || "channel",
        name: channel.name,
        created_at: channel.created_at,
        updated_at: channel.updated_at,
        message_count: messageCountByChannel.get(key) ?? 0,
        unread_count: unreadByChannel.get(key) ?? 0,
        last_message_at: latest?.createdAt ?? null,
        last_message_preview: latest?.body ?? null,
        member_count: memberCountByChannel.get(key) ?? 0,
        other_user_id: null,
      };
    });

    items.sort((a, b) => String(b.last_message_at || b.created_at).localeCompare(String(a.last_message_at || a.created_at)));
    const totalUnread = items.reduce((sum, item) => sum + Number(item.unread_count ?? 0), 0);
    return Response.json({
      items: items.slice(from, to + 1),
      unread_count: totalUnread,
      ...getPaginationMeta(items.length, page, pageSize),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
