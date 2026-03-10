import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { resolveDisplayNames } from "@/lib/messages/mvp";

const paramsSchema = z.object({ id: z.string().uuid() });

function issueDetails(error: { issues: { path: Array<string | number>; message: string }[] }) {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

function tenantError(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(issueDetails(parsedParams.error));

    const threadId = parsedParams.data.id;
    const { supabase, companyId, userId } = await getCompanyId();

    const myParticipant = await supabase
      .from("message_participants")
      .select("id")
      .eq("company_id", companyId)
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (!myParticipant.data) {
      const thread = await supabase
        .from("message_threads")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", threadId)
        .limit(1)
        .maybeSingle();
      if (!thread.data) return notFound("Thread not found");
      return forbidden();
    }

    const participantsResult = await supabase
      .from("message_participants")
      .select("id, user_id, created_at")
      .eq("company_id", companyId)
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (participantsResult.error) return serverError(participantsResult.error.message);

    const participants = participantsResult.data ?? [];
    const names = await resolveDisplayNames(
      supabase,
      companyId,
      participants.map((row) => String(row.user_id))
    );

    return Response.json({
      items: participants.map((row, index) => ({
        id: row.id,
        userId: row.user_id,
        memberRole: index === 0 ? "owner" : "member",
        displayName: names.get(String(row.user_id)) || "Team Member",
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}

export async function POST() {
  return validationError([
    {
      path: "userIds",
      message: "Messaging MVP supports fixed 1:1 direct threads; adding members is disabled.",
    },
  ]);
}
