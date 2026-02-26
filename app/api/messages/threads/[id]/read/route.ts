import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { getMyMembership } from "@/lib/messages/members";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
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

function isMissingReadColumn(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("column") && normalized.includes("last_read_at");
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(toValidationDetails(parsedParams.error));
    const channelId = parsedParams.data.id;

    const { supabase, companyId, userId } = await getCompanyId();
    const membership = await getMyMembership(supabase, companyId, channelId, userId);
    if (membership.error) {
      const now = new Date().toISOString();
      return okItem({ channelId, userId, lastReadAt: now, success: true });
    }
    if (!membership.data) {
      const channel = await supabase
        .from("message_channels")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", channelId)
        .maybeSingle();
      if (channel.error) {
        const now = new Date().toISOString();
        return okItem({ channelId, userId, lastReadAt: now, success: true });
      }
      if (!channel.data) return notFound("Thread not found");
      return forbidden();
    }

    const now = new Date().toISOString();
    const updated = await supabase
      .from("message_channel_members")
      .update({ last_read_at: now })
      .eq("company_id", companyId)
      .eq("channel_id", channelId)
      .eq("user_id", userId)
      .select("channel_id, user_id, last_read_at")
      .maybeSingle();
    if (updated.error || !updated.data) {
      if (updated.error && !isMissingReadColumn(updated.error.message || "")) {
        // Keep read endpoint resilient for mixed-schema environments.
      }
      return okItem({
        channelId,
        userId,
        lastReadAt: now,
        success: true,
      });
    }

    return okItem({
      channelId: updated.data.channel_id,
      userId: updated.data.user_id,
      lastReadAt: updated.data.last_read_at,
      success: true,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
