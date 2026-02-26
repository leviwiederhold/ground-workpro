import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";

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
      .maybeSingle();
    if (memberResult.error) return serverError();
    if (!memberResult.data) return notFound("User not found");

    const [dmUserA, dmUserB] = [userId, otherUserId].sort();
    const existing = await supabase
      .from("message_channels")
      .select("id, name, kind, created_at, updated_at")
      .eq("company_id", companyId)
      .eq("kind", "direct")
      .eq("dm_user_a", dmUserA)
      .eq("dm_user_b", dmUserB)
      .maybeSingle();
    if (existing.error && !isMissingDirectColumns(existing.error.message || "")) return serverError();

    if (existing.data) return okItem(existing.data);

    const now = new Date().toISOString();
    let channelInsert = await supabase
      .from("message_channels")
      .insert({
        company_id: companyId,
        name: "Direct message",
        created_at: now,
        updated_at: now,
        is_dm: true,
        created_by: userId,
        kind: "direct",
        dm_user_a: dmUserA,
        dm_user_b: dmUserB,
      })
      .select("id, name, kind, created_at, updated_at")
      .single();

    if (channelInsert.error && isMissingDirectColumns(channelInsert.error.message || "")) {
      channelInsert = await supabase
        .from("message_channels")
        .insert({
          company_id: companyId,
          name: `dm-${dmUserA.slice(0, 8)}-${dmUserB.slice(0, 8)}`,
          created_at: now,
          updated_at: now,
          is_dm: true,
          created_by: userId,
        })
        .select("id, name, created_at, updated_at")
        .single() as typeof channelInsert;
    }

    if (channelInsert.error || !channelInsert.data) return serverError();

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
    if (membersInsert.error) return serverError();

    return okItem(channelInsert.data, 201);
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
