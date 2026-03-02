import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { createFallbackChannel } from "@/lib/messages/fallbackStore";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  userId: z.string().uuid(),
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

function isMissingDirectColumns(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("column") && (normalized.includes("kind") || normalized.includes("dm_user_a") || normalized.includes("dm_user_b"));
}

function isMissingLastReadColumn(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("column") && normalized.includes("last_read_at");
}

function isMissingMessagesTables(message: string) {
  const normalized = message.toLowerCase();
  return (
    (normalized.includes("message_channels") ||
      normalized.includes("messages") ||
      normalized.includes("message_channel_members")) &&
    (normalized.includes("does not exist") || normalized.includes("not find"))
  );
}

function missingColumn(message: string) {
  const match = String(message || "").match(/Could not find the '([^']+)' column/i);
  return match?.[1] ?? null;
}

export async function POST(request: Request) {
  try {
    const parsedBody = bodySchema.safeParse(await request.json());
    if (!parsedBody.success) return validationError(toValidationDetails(parsedBody.error));

    const { supabase, companyId, userId } = await getCompanyId();
    const otherUserId = parsedBody.data.userId;
    if (otherUserId === userId) {
      return validationError([{ path: "userId", message: "Cannot start direct message with yourself" }]);
    }

    const memberResult = await supabase
      .from("memberships")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("user_id", otherUserId)
      .limit(1);
    if (memberResult.error) {
      return Response.json({ error: memberResult.error.message || "Failed to verify company member" }, { status: 400 });
    }
    if (!(memberResult.data ?? []).length) return notFound("User not found");

    const [dmUserA, dmUserB] = [userId, otherUserId].sort();
    let existing: { data: Array<{ id: string; name?: string | null; kind?: string | null; created_at?: string | null; updated_at?: string | null }> | null; error: { message?: string } | null } = await supabase
      .from("message_channels")
      .select("id, name, kind, created_at, updated_at")
      .eq("company_id", companyId)
      .eq("kind", "direct")
      .eq("dm_user_a", dmUserA)
      .eq("dm_user_b", dmUserB)
      .limit(1);
    const legacyDirectName = `dm-${dmUserA.slice(0, 8)}-${dmUserB.slice(0, 8)}`;
    if (existing.error && isMissingDirectColumns(existing.error.message || "")) {
      // Legacy fallback when direct-chat columns are absent: use deterministic channel name per user pair.
      existing = await supabase
        .from("message_channels")
        .select("id, name, created_at, updated_at")
        .eq("company_id", companyId)
        .eq("name", legacyDirectName)
        .limit(1);
      if (existing.error) {
        return Response.json({ error: existing.error.message || "Failed to locate direct channel" }, { status: 400 });
      }
    } else if (existing.error && isMissingMessagesTables(existing.error.message || "")) {
      return okItem(createFallbackChannel(companyId, legacyDirectName, [userId, otherUserId]), 201);
    } else if (existing.error) {
      return Response.json({ error: existing.error.message || "Failed to locate direct channel" }, { status: 400 });
    }

    const existingRows = existing.data ?? [];
    if (existingRows.length > 0) {
      const legacyChannel = existingRows.find((row: { id: string }) => Boolean(row?.id));
      if (legacyChannel) return okItem(legacyChannel);
    }

    // Hard reuse guard: find any existing channel where BOTH users are already members.
    // This prevents duplicate DMs even when legacy rows are missing direct-chat columns.
    const currentUserMemberships = await supabase
      .from("message_channel_members")
      .select("channel_id")
      .eq("company_id", companyId)
      .eq("user_id", userId);
    if (currentUserMemberships.error) {
      if (!isMissingMessagesTables(currentUserMemberships.error.message || "")) {
        return Response.json({ error: currentUserMemberships.error.message || "Failed to locate direct channel" }, { status: 400 });
      }
    } else {
      const candidateChannelIds = Array.from(
        new Set((currentUserMemberships.data ?? []).map((row) => String(row.channel_id)).filter(Boolean))
      );
      if (candidateChannelIds.length > 0) {
        const otherUserMemberships = await supabase
          .from("message_channel_members")
          .select("channel_id")
          .eq("company_id", companyId)
          .eq("user_id", otherUserId)
          .in("channel_id", candidateChannelIds);
        if (otherUserMemberships.error) {
          if (!isMissingMessagesTables(otherUserMemberships.error.message || "")) {
            return Response.json({ error: otherUserMemberships.error.message || "Failed to locate direct channel" }, { status: 400 });
          }
        } else {
          const sharedChannelIds = Array.from(
            new Set((otherUserMemberships.data ?? []).map((row) => String(row.channel_id)).filter(Boolean))
          );
          if (sharedChannelIds.length > 0) {
            const sharedChannel = await supabase
              .from("message_channels")
              .select("id, name, kind, created_at, updated_at")
              .eq("company_id", companyId)
              .in("id", sharedChannelIds)
              .order("updated_at", { ascending: false })
              .limit(1);
            if (!sharedChannel.error && (sharedChannel.data ?? []).length > 0) {
              return okItem(sharedChannel.data?.[0]);
            }
          }
        }
      }
    }

    const now = new Date().toISOString();
    const channelPayload: Record<string, unknown> = {
      company_id: companyId,
      name: "Direct message",
      created_at: now,
      updated_at: now,
      is_dm: true,
      created_by: userId,
      kind: "direct",
      dm_user_a: dmUserA,
      dm_user_b: dmUserB,
    };

    let channelInsert = await supabase
      .from("message_channels")
      .insert(channelPayload)
      .select("id, name, kind, created_at, updated_at")
      .single();
    for (let i = 0; i < 8; i += 1) {
      if (!channelInsert.error) break;
      const missing = missingColumn(channelInsert.error.message || "");
      if (!missing || !(missing in channelPayload)) break;
      delete channelPayload[missing];
      channelInsert = await supabase
        .from("message_channels")
        .insert(channelPayload)
        .select("id, name, kind, created_at, updated_at")
        .single();
    }

    if (channelInsert.error && isMissingDirectColumns(channelInsert.error.message || "")) {
      channelInsert = await supabase
        .from("message_channels")
        .insert({
          company_id: companyId,
          name: legacyDirectName,
          created_at: now,
          updated_at: now,
          is_dm: true,
          created_by: userId,
        })
        .select("id, name, created_at, updated_at")
        .single() as typeof channelInsert;
    }

    if (channelInsert.error && isMissingMessagesTables(channelInsert.error.message || "")) {
      return okItem(createFallbackChannel(companyId, legacyDirectName, [userId, otherUserId]), 201);
    }

    if (channelInsert.error || !channelInsert.data) {
      return Response.json({ error: channelInsert.error?.message || "Failed to create direct chat" }, { status: 400 });
    }

    let membersInsert = await supabase
      .from("message_channel_members")
      .insert([
        { company_id: companyId, channel_id: channelInsert.data.id, user_id: userId, member_role: "owner", last_read_at: now },
        { company_id: companyId, channel_id: channelInsert.data.id, user_id: otherUserId, member_role: "member", last_read_at: now },
      ]);
    if (membersInsert.error && isMissingLastReadColumn(membersInsert.error.message || "")) {
      membersInsert = await supabase
        .from("message_channel_members")
        .insert([
          { company_id: companyId, channel_id: channelInsert.data.id, user_id: userId, member_role: "owner" },
          { company_id: companyId, channel_id: channelInsert.data.id, user_id: otherUserId, member_role: "member" },
        ]);
    }
    if (membersInsert.error) {
      return Response.json({ error: membersInsert.error.message || "Failed to add direct chat members" }, { status: 400 });
    }

    return okItem(channelInsert.data, 201);
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
