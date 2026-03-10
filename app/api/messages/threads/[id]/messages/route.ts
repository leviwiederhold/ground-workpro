import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
import { getThreadIfParticipant, listMessagesForThread } from "@/lib/messages/mvp";

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireModuleAccess("messages", "view");
    } catch {
      return forbidden();
    }

    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, {
      defaultPageSize: 100,
      maxPageSize: 500,
    });

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(toValidationDetails(parsedParams.error));

    const threadId = parsedParams.data.id;
    const { supabase, companyId, userId } = await getCompanyId();

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

    const { items, count } = await listMessagesForThread(supabase, companyId, threadId, from, to);

    return Response.json({
      items: items.map((row) => ({
        id: row.id,
        thread_id: row.thread_id,
        channel_id: row.thread_id,
        sender_user_id: row.sender_user_id,
        body: row.body,
        created_at: row.created_at,
      })),
      ...getPaginationMeta(count, page, pageSize),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}
