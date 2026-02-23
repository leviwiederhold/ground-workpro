import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { getMyMembership } from "@/lib/messages/members";

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({ userIds: z.array(z.string().uuid()).min(1) });

function issueDetails(error: { issues: { path: Array<string | number>; message: string }[] }) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function tenantError(error: TenantResolverError) {
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

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(issueDetails(parsedParams.error));

    const channelId = parsedParams.data.id;
    const { supabase, companyId, userId } = await getCompanyId();

    const me = await getMyMembership(supabase, companyId, channelId, userId);
    if (me.error) return serverError();
    if (!me.data) {
      const channel = await supabase.from("message_channels").select("id").eq("company_id", companyId).eq("id", channelId).maybeSingle();
      if (channel.error) return serverError();
      if (!channel.data) return notFound("Channel not found");
      return forbidden();
    }

    const memberRows = await supabase
      .from("message_channel_members")
      .select("id, user_id, member_role, created_at")
      .eq("company_id", companyId)
      .eq("channel_id", channelId)
      .order("created_at", { ascending: true });
    if (memberRows.error) {
      if (isMissingMessagesTables(memberRows.error.message)) return Response.json({ items: [] });
      return serverError();
    }

    const userIds = (memberRows.data ?? []).map((row) => String(row.user_id));
    const profiles = userIds.length
      ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
      : { data: [], error: null };
    if (profiles.error) return serverError();

    const nameById = new Map((profiles.data ?? []).map((profile) => [String(profile.id), String(profile.full_name ?? "")])) as Map<string, string>;

    return Response.json({
      items: (memberRows.data ?? []).map((row) => ({
        id: row.id,
        userId: row.user_id,
        memberRole: row.member_role,
        displayName: nameById.get(String(row.user_id)) || "Team Member",
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(issueDetails(parsedParams.error));
    const parsedBody = bodySchema.safeParse(await request.json());
    if (!parsedBody.success) return validationError(issueDetails(parsedBody.error));

    const { supabase, companyId, userId } = await getCompanyId();
    const channelId = parsedParams.data.id;

    const me = await getMyMembership(supabase, companyId, channelId, userId);
    if (me.error) return serverError();
    if (!me.data) {
      const channel = await supabase.from("message_channels").select("id").eq("company_id", companyId).eq("id", channelId).maybeSingle();
      if (channel.error) return serverError();
      if (!channel.data) return notFound("Channel not found");
      return forbidden();
    }

    const requestedUserIds: string[] = Array.from(new Set(parsedBody.data.userIds.map((id: string) => String(id))));
    const validMemberships = await supabase
      .from("memberships")
      .select("user_id")
      .eq("company_id", companyId)
      .in("user_id", requestedUserIds);
    if (validMemberships.error) return serverError();

    const validUserIds = new Set((validMemberships.data ?? []).map((row) => String(row.user_id)));
    if (validUserIds.size !== requestedUserIds.length) {
      return validationError([{ path: "userIds", message: "One or more users are not company members" }]);
    }

    const existing = await supabase
      .from("message_channel_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("channel_id", channelId)
      .in("user_id", requestedUserIds);
    if (existing.error) {
      if (isMissingMessagesTables(existing.error.message)) return okItem({ addedCount: 0 });
      return serverError();
    }
    const existingIds = new Set((existing.data ?? []).map((row) => String(row.user_id)));

    const toInsert = requestedUserIds
      .filter((id) => !existingIds.has(id))
      .map((id) => ({ company_id: companyId, channel_id: channelId, user_id: id, member_role: "member" }));

    if (toInsert.length > 0) {
      const insertResult = await supabase.from("message_channel_members").insert(toInsert);
      if (insertResult.error) {
        if (isMissingMessagesTables(insertResult.error.message)) return okItem({ addedCount: 0 });
        return serverError();
      }
    }

    return okItem({ addedCount: toInsert.length });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
