import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { createFallbackChannel, listFallbackChannels } from "@/lib/messages/fallbackStore";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
import { dedupeUserIds } from "@/lib/messages/members";

export const dynamic = "force-dynamic";

const createChannelSchema = z.object({
  name: z.string().trim().min(1).max(120),
  memberUserIds: z.array(z.string().uuid()).default([]),
});

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

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

export async function GET(request: Request) {
  try {
    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId, userId } = await getCompanyId();

    const memberRows = await supabase
      .from("message_channel_members")
      .select("channel_id")
      .eq("company_id", companyId)
      .eq("user_id", userId);

    if (memberRows.error) {
      const message = memberRows.error?.message || "";
      if (isMissingMessagesTables(message)) {
        const fallback = listFallbackChannels(companyId).map((channel) => ({
          ...channel,
          message_count: 0,
          last_message_at: null,
          last_message_preview: null,
          unread_count: 0,
        }));
        const paged = fallback.slice(from, to + 1);
        return Response.json({ items: paged, unread_count: 0, ...getPaginationMeta(fallback.length, page, pageSize) });
      }
      return serverError();
    }

    const memberChannelIds = Array.from(new Set((memberRows.data ?? []).map((row) => String(row.channel_id))));

    if (memberChannelIds.length === 0) {
      return Response.json({ items: [], unread_count: 0, ...getPaginationMeta(0, page, pageSize) });
    }

    const channelsResult = await supabase
      .from("message_channels")
      .select("id, name, created_at, updated_at", { count: "exact" })
      .eq("company_id", companyId)
      .in("id", memberChannelIds)
      .order("created_at", { ascending: true })
      .range(from, to);

    if (channelsResult.error) return serverError();

    const channelIds = (channelsResult.data ?? []).map((c) => c.id);
    const messagesQuery =
      channelIds.length > 0
        ? await supabase
            .from("messages")
            .select("id, channel_id, body, created_at")
            .eq("company_id", companyId)
            .in("channel_id", channelIds)
            .order("created_at", { ascending: false })
        : { data: [], error: null };

    if (messagesQuery.error) return serverError();

    const memberCountsQuery = await supabase
      .from("message_channel_members")
      .select("channel_id")
      .eq("company_id", companyId)
      .in("channel_id", channelIds);

    if (memberCountsQuery.error) return serverError();

    const latestByChannel = new Map<string, { body: string; created_at: string }>();
    const countsByChannel = new Map<string, number>();
    for (const msg of messagesQuery.data ?? []) {
      const key = String(msg.channel_id);
      countsByChannel.set(key, (countsByChannel.get(key) ?? 0) + 1);
      if (!latestByChannel.has(key)) latestByChannel.set(key, { body: String(msg.body ?? ""), created_at: String(msg.created_at ?? "") });
    }

    const memberCountByChannel = new Map<string, number>();
    for (const row of memberCountsQuery.data ?? []) {
      const key = String(row.channel_id);
      memberCountByChannel.set(key, (memberCountByChannel.get(key) ?? 0) + 1);
    }

    const items = (channelsResult.data ?? []).map((channel) => {
      const key = String(channel.id);
      const latest = latestByChannel.get(key);
      return {
        id: channel.id,
        name: channel.name,
        created_at: channel.created_at,
        updated_at: channel.updated_at,
        message_count: countsByChannel.get(key) ?? 0,
        last_message_at: latest?.created_at ?? null,
        last_message_preview: latest?.body ?? null,
        unread_count: 0,
        member_count: memberCountByChannel.get(key) ?? 0,
      };
    });

    return Response.json({
      items,
      unread_count: 0,
      ...getPaginationMeta(channelsResult.count ?? items.length, page, pageSize),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}

export async function POST(request: Request) {
  try {
    const parsedBody = createChannelSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const now = new Date().toISOString();
    const memberUserIds = dedupeUserIds(parsedBody.data.memberUserIds, userId);

    const membersResult = await supabase
      .from("memberships")
      .select("user_id")
      .eq("company_id", companyId)
      .in("user_id", memberUserIds);

    if (membersResult.error) return serverError();
    const validUserIds = new Set((membersResult.data ?? []).map((row) => String(row.user_id)));
    if (validUserIds.size !== memberUserIds.length) {
      return validationError([{ path: "memberUserIds", message: "One or more users are not members of this company" }]);
    }

    const payload = {
      company_id: companyId,
      name: parsedBody.data.name,
      created_at: now,
      updated_at: now,
      is_dm: false,
      created_by: userId,
    };

    const { data, error } = await supabase
      .from("message_channels")
      .insert(payload)
      .select("id, name, created_at, updated_at")
      .single();

    if (error || !data) {
      if (error?.message && isMissingMessagesTables(error.message)) {
        return okItem(createFallbackChannel(companyId, parsedBody.data.name), 201);
      }
      return serverError();
    }

    const membershipRows = memberUserIds.map((memberId) => ({
      company_id: companyId,
      channel_id: data.id,
      user_id: memberId,
      member_role: memberId === userId ? "owner" : "member",
    }));

    const membersInsert = await supabase.from("message_channel_members").insert(membershipRows);
    if (membersInsert.error) return serverError();

    return okItem(data, 201);
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
