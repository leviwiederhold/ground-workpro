import { z } from "zod";
import { after } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { getThreadIfParticipant } from "@/lib/messages/mvp";
import {
  MAX_MESSAGE_ATTACHMENTS,
  persistMessageAttachments,
} from "@/lib/messages/attachments";
import { enqueueNotifications } from "@/lib/notifications/enqueue";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enqueueMessagePushSafely } from "@/lib/push/domain";
import { enqueueMessagePushJob, processPushNotificationJobs } from "@/lib/push/worker";
import {
  MAX_VIDEO_DURATION_SECONDS,
  validateMessageAttachmentTotalSize,
} from "@/lib/messages/attachmentPolicy";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

// Body is optional when at least one attachment is present (enforced below).
// Attachments reference objects the browser already uploaded directly to Storage
// (see the /attachments/sign route); only metadata + path flow through here.
const sendMessageSchema = z.object({
  body: z.string().trim().max(4000).optional().default(""),
  attachments: z
    .array(
      z.object({
        path: z.string().min(1),
        file_name: z.string().min(1),
        content_type: z.string().min(1),
        file_size: z.number().finite().positive(),
        duration_seconds: z.number().finite().positive().max(MAX_VIDEO_DURATION_SECONDS).optional(),
      })
    )
    .max(MAX_MESSAGE_ATTACHMENTS)
    .optional()
    .default([]),
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

    // JSON body: text + optional metadata for files already uploaded to Storage.
    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }

    const parsedBody = sendMessageSchema.safeParse(rawBody);
    if (!parsedBody.success) return validationError(toValidationDetails(parsedBody.error));

    const messageBody = parsedBody.data.body.trim();
    const attachmentInputs = parsedBody.data.attachments;
    if (attachmentInputs.length > 0) {
      const totalSizeValidation = validateMessageAttachmentTotalSize(attachmentInputs);
      if (!totalSizeValidation.ok) {
        return validationError([{ path: "attachments", message: totalSizeValidation.error }]);
      }
    }
    // Do not send an empty message unless at least one attachment is present.
    if (!messageBody && attachmentInputs.length === 0) {
      return validationError([{ path: "body", message: "Message cannot be empty" }]);
    }

    const threadId = parsedParams.data.id;
    const { supabase, companyId, userId } = await getCompanyId();
    const admin = getSupabaseAdmin();
    const db = admin ?? supabase;

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
    const insertResult = await db
      .from("messages")
      .insert({
        company_id: companyId,
        thread_id: thread.id,
        sender_user_id: userId,
        body: messageBody,
        created_at: now,
      })
      .select("id, thread_id, sender_user_id, body, created_at")
      .single();

    if (insertResult.error || !insertResult.data) {
      return serverError(insertResult.error?.message || "Failed to send message");
    }

    // Link attachments (bytes already uploaded to Storage). If this fails, roll
    // back the message so the client can keep the composed message + files
    // rather than losing them.
    let attachments: unknown[] = [];
    if (attachmentInputs.length > 0) {
      try {
        attachments = await persistMessageAttachments({
          db,
          companyId,
          threadId: thread.id,
          messageId: insertResult.data.id,
          uploaderId: userId,
          attachments: attachmentInputs,
        });
      } catch (attachmentError) {
        await db.from("messages").delete().eq("company_id", companyId).eq("id", insertResult.data.id);
        return serverError(
          attachmentError instanceof Error ? attachmentError.message : "Failed to attach files"
        );
      }
    }

    await Promise.all([
      db
        .from("message_participants")
        .update({ last_read_at: insertResult.data.created_at })
        .eq("company_id", companyId)
        .eq("thread_id", thread.id)
        .eq("user_id", userId),
      db
        .from("message_threads")
        .update({
          updated_at: insertResult.data.created_at,
          last_message_at: insertResult.data.created_at,
        })
        .eq("company_id", companyId)
        .eq("id", thread.id),
    ]);

    // Persist only a reference to the already-authorized, already-saved
    // message. Provider delivery runs after the response and a scheduled worker
    // retries the durable job, so APNs can never fail the message send itself.
    const pushQueued = await enqueueMessagePushSafely(
      () =>
        enqueueMessagePushJob({
          db,
          companyId,
          messageId: insertResult.data.id,
          threadId: thread.id,
          senderUserId: userId,
        }),
      (error) => {
        console.warn(
          "[push] Failed to enqueue message notification",
          error instanceof Error ? error.message : "unknown error"
        );
      }
    );
    if (pushQueued && admin) {
      after(async () => {
        try {
          await processPushNotificationJobs({ db: admin, limit: 10 });
        } catch (error) {
          // The durable queued job remains available to the scheduled retry.
          console.warn(
            "[push] Immediate message notification dispatch failed",
            error instanceof Error ? error.message : "unknown error"
          );
        }
      });
    }

    void (async () => {
      try {
        const participantsResult = await db
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
                messagePreview:
                  messageBody.slice(0, 120) ||
                  (attachmentInputs.length === 1
                    ? "Sent an attachment"
                    : `Sent ${attachmentInputs.length} attachments`),
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
    })();

    return okItem(
      {
        id: insertResult.data.id,
        thread_id: insertResult.data.thread_id,
        channel_id: insertResult.data.thread_id,
        sender_user_id: insertResult.data.sender_user_id,
        body: insertResult.data.body,
        created_at: insertResult.data.created_at,
        attachments,
      },
      201
    );
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}
