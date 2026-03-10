import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { getThreadIfParticipant } from "@/lib/messages/mvp";
import { enqueueNotifications } from "@/lib/notifications/enqueue";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
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
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireModuleAccess("messages", "edit");
    } catch {
      return forbidden();
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(toValidationDetails(parsedParams.error));

    const parsedBody = sendMessageSchema.safeParse(await request.json());
    if (!parsedBody.success) return validationError(toValidationDetails(parsedBody.error));

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

    const now = new Date().toISOString();
    const insertResult = await supabase
      .from("messages")
      .insert({
        company_id: companyId,
        thread_id: thread.id,
        sender_user_id: userId,
        body: parsedBody.data.body,
        created_at: now,
      })
      .select("id, thread_id, sender_user_id, body, created_at")
      .single();

    if (insertResult.error || !insertResult.data) {
      return serverError(insertResult.error?.message || "Failed to send message");
    }

    await Promise.all([
      supabase
        .from("message_participants")
        .update({ last_read_at: insertResult.data.created_at })
        .eq("company_id", companyId)
        .eq("thread_id", thread.id)
        .eq("user_id", userId),
      supabase
        .from("message_threads")
        .update({
          updated_at: insertResult.data.created_at,
          last_message_at: insertResult.data.created_at,
        })
        .eq("company_id", companyId)
        .eq("id", thread.id),
    ]);

    try {
      const participantsResult = await supabase
        .from("message_participants")
        .select("user_id")
        .eq("company_id", companyId)
        .eq("thread_id", thread.id);
      if (!participantsResult.error) {
        const recipientUserIds = (participantsResult.data ?? [])
          .map((row) => String((row as { user_id?: string }).user_id ?? ""))
          .filter((id) => id && id !== String(userId));
        if (recipientUserIds.length > 0) {
          await enqueueNotifications({
            supabase,
            companyId,
            userIds: recipientUserIds,
            type: "new_message",
            payload: {
              threadId: thread.id,
              messagePreview: parsedBody.data.body.slice(0, 120),
              href: "/messages",
            },
            entityType: "message_thread",
            entityId: thread.id,
            actorUserId: userId,
          });
        }
      }
    } catch {
      // Non-blocking: message send should succeed even if notification fanout fails.
    }

    return okItem(
      {
        id: insertResult.data.id,
        thread_id: insertResult.data.thread_id,
        channel_id: insertResult.data.thread_id,
        sender_user_id: insertResult.data.sender_user_id,
        body: insertResult.data.body,
        created_at: insertResult.data.created_at,
      },
      201
    );
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}
