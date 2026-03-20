import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { getThreadIfParticipant } from "@/lib/messages/mvp";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireModuleAccess("messages", "view");
    } catch {
      return forbidden();
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(toValidationDetails(parsedParams.error));

    const threadId = parsedParams.data.id;
    const { supabase, companyId, userId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;

    const { thread, participant } = await getThreadIfParticipant(supabase, companyId, threadId, userId);
    if (!participant) {
      const threadResult = await supabase
        .from("message_threads")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", threadId)
        .limit(1)
        .maybeSingle();
      if (!threadResult.data) return notFound("Thread not found");
      return forbidden();
    }
    if (!thread) return notFound("Thread not found");

    const now = new Date().toISOString();
    const updateResult = await db
      .from("message_participants")
      .update({ last_read_at: now })
      .eq("company_id", companyId)
      .eq("thread_id", thread.id)
      .eq("user_id", userId)
      .select("thread_id, user_id, last_read_at")
      .maybeSingle();

    if (updateResult.error || !updateResult.data) {
      return serverError(updateResult.error?.message || "Failed to mark thread read");
    }

    return okItem({
      threadId: updateResult.data.thread_id,
      channelId: updateResult.data.thread_id,
      userId: updateResult.data.user_id,
      lastReadAt: updateResult.data.last_read_at,
      success: true,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}
