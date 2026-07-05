import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { getThreadIfParticipant } from "@/lib/messages/mvp";
import { MESSAGE_ATTACHMENTS_BUCKET } from "@/lib/messages/attachments";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});

const editSchema = z.object({ body: z.string().trim().min(1).max(4000) });

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

// Resolve the message and enforce: participant of the thread + tenant scoped +
// sender-only. Returns the message row or a NextResponse to short-circuit.
async function loadOwnMessage(
  request: Request,
  params: Promise<{ id: string; messageId: string }>
) {
  try {
    await requireModuleAccess("messages", "edit");
  } catch {
    return { error: forbidden() };
  }

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return { error: validationError([{ path: "id", message: "Invalid ids" }]) };
  }

  const { supabase, companyId, userId } = await getCompanyId();
  const db = getSupabaseAdmin() ?? supabase;

  const { thread, participant } = await getThreadIfParticipant(
    supabase,
    companyId,
    parsed.data.id,
    userId
  );
  if (!participant || !thread) return { error: forbidden() };

  const messageResult = await db
    .from("messages")
    .select("id, thread_id, sender_user_id, body, created_at")
    .eq("company_id", companyId)
    .eq("thread_id", parsed.data.id)
    .eq("id", parsed.data.messageId)
    .maybeSingle();

  if (messageResult.error) return { error: serverError(messageResult.error.message) };
  if (!messageResult.data) return { error: notFound("Message not found") };

  // Sender-only: you can only edit/delete messages you personally sent.
  if (String(messageResult.data.sender_user_id) !== String(userId)) {
    return { error: forbidden() };
  }

  return { db, companyId, userId, threadId: parsed.data.id, message: messageResult.data };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const ctx = await loadOwnMessage(request, params);
    if ("error" in ctx) return ctx.error;

    const parsedBody = editSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsedBody.success) {
      return validationError([{ path: "body", message: "Message cannot be empty" }]);
    }

    const now = new Date().toISOString();
    const runUpdate = (payload: Record<string, unknown>, columns: string) =>
      ctx.db
        .from("messages")
        .update(payload)
        .eq("company_id", ctx.companyId)
        .eq("id", ctx.message.id)
        .select(columns)
        .maybeSingle();

    // Stamp edited_at so the "edited" indicator persists; tolerate environments
    // where the edited_at migration has not been applied yet.
    let updated = await runUpdate(
      { body: parsedBody.data.body, edited_at: now },
      "id, thread_id, sender_user_id, body, created_at, edited_at"
    );
    if (updated.error && /edited_at/i.test(updated.error.message || "")) {
      updated = await runUpdate(
        { body: parsedBody.data.body },
        "id, thread_id, sender_user_id, body, created_at"
      );
    }

    if (updated.error) return serverError(updated.error.message);
    if (!updated.data) return notFound("Message not found");

    const row = updated.data as unknown as Record<string, unknown>;
    return okItem({ ...row, channel_id: row.thread_id });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> }
) {
  try {
    const ctx = await loadOwnMessage(request, params);
    if ("error" in ctx) return ctx.error;

    // Collect attachment storage paths first so we can clean up the objects
    // after the rows are removed (message_attachments rows cascade on delete).
    const attachmentRows = await ctx.db
      .from("message_attachments")
      .select("storage_path, storage_bucket")
      .eq("company_id", ctx.companyId)
      .eq("message_id", ctx.message.id);

    const del = await ctx.db
      .from("messages")
      .delete()
      .eq("company_id", ctx.companyId)
      .eq("id", ctx.message.id);
    if (del.error) return serverError(del.error.message);

    const paths = (attachmentRows.data ?? [])
      .map((row: { storage_path?: string }) => String(row.storage_path ?? ""))
      .filter(Boolean);
    if (paths.length > 0) {
      await ctx.db.storage.from(MESSAGE_ATTACHMENTS_BUCKET).remove(paths).catch(() => null);
    }

    return okItem({ id: ctx.message.id, deleted: true });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}
