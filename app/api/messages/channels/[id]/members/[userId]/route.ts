import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okSuccess } from "@/lib/http/json";
import { getMyMembership } from "@/lib/messages/members";

const paramsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

function tenantError(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return validationError(parsedParams.error.issues.map((issue: { path: Array<string | number>; message: string }) => ({ path: issue.path.join("."), message: issue.message })));
    }

    const { id: channelId, userId: targetUserId } = parsedParams.data;
    const { supabase, companyId, userId } = await getCompanyId();

    const me = await getMyMembership(supabase, companyId, channelId, userId);
    if (me.error) return serverError();
    if (!me.data) {
      const channel = await supabase.from("message_channels").select("id").eq("company_id", companyId).eq("id", channelId).maybeSingle();
      if (channel.error) return serverError();
      if (!channel.data) return notFound("Channel not found");
      return forbidden();
    }

    if (targetUserId === userId) {
      return forbidden("Use leave endpoint for removing self");
    }

    if (me.data.member_role !== "owner") {
      return forbidden();
    }

    const removeResult = await supabase
      .from("message_channel_members")
      .delete()
      .eq("company_id", companyId)
      .eq("channel_id", channelId)
      .eq("user_id", targetUserId);

    if (removeResult.error) return serverError();
    return okSuccess();
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
