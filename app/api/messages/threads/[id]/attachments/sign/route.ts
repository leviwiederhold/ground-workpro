import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { getThreadIfParticipant } from "@/lib/messages/mvp";
import {
  MAX_MESSAGE_ATTACHMENTS,
  MESSAGE_ATTACHMENTS_BUCKET,
  buildMessageAttachmentPath,
  isCompanyScopedMessagePath,
  validateMessageFileMeta,
} from "@/lib/messages/attachments";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  MAX_VIDEO_DURATION_SECONDS,
  validateMessageAttachmentTotalSize,
} from "@/lib/messages/attachmentPolicy";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });

const signSchema = z.object({
  files: z
    .array(
      z.object({
        file_name: z.string().min(1),
        content_type: z.string().min(1),
        file_size: z.number().finite().positive(),
        duration_seconds: z.number().finite().positive().max(MAX_VIDEO_DURATION_SECONDS).optional(),
      })
    )
    .min(1)
    .max(MAX_MESSAGE_ATTACHMENTS),
});

const discardSchema = z.object({
  paths: z.array(z.string().min(1)).min(1).max(MAX_MESSAGE_ATTACHMENTS),
});

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

// Issue short-lived signed upload URLs so the browser uploads attachment bytes
// DIRECTLY to Supabase Storage — bypassing the platform's serverless request
// body limit (which is far below our attachment limits). Every file's type/size is
// validated here (server-side), and a URL is only issued to a thread participant
// for a company-scoped path.
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
    if (!parsedParams.success) {
      return validationError([{ path: "id", message: "Invalid thread id" }]);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return validationError([{ path: "body", message: "Invalid JSON body" }]);
    }
    const parsed = signSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
      );
    }

    const threadId = parsedParams.data.id;
    const { supabase, companyId, userId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;

    const { thread, participant } = await getThreadIfParticipant(supabase, companyId, threadId, userId);
    if (!participant || !thread) return forbidden();

    const uploads = [];
    const totalSizeValidation = validateMessageAttachmentTotalSize(parsed.data.files);
    if (!totalSizeValidation.ok) {
      return validationError([{ path: "files", message: totalSizeValidation.error }]);
    }
    for (const file of parsed.data.files) {
      const validation = validateMessageFileMeta(file);
      if (!validation.ok) {
        return validationError([{ path: "files", message: `${file.file_name}: ${validation.error}` }]);
      }
      const path = buildMessageAttachmentPath(companyId, validation.safeFileName);
      const signed = await db.storage.from(MESSAGE_ATTACHMENTS_BUCKET).createSignedUploadUrl(path);
      if (signed.error || !signed.data) {
        const rawMessage = signed.error?.message || "";
        // Log the underlying Supabase Storage error for diagnosis.
        console.error("[messages/attachments/sign] createSignedUploadUrl failed", {
          bucket: MESSAGE_ATTACHMENTS_BUCKET,
          path,
          error: rawMessage,
        });
        // A missing bucket surfaces as "Bucket not found" / "The related resource
        // does not exist". Return a clear, actionable message instead of the raw text.
        if (/bucket not found|does not exist|related resource/i.test(rawMessage)) {
          return NextResponse.json(
            { error: "Message attachment storage bucket is not configured" },
            { status: 500 }
          );
        }
        return serverError(rawMessage || "Failed to prepare upload");
      }
      uploads.push({
        path,
        token: signed.data.token,
        signed_url: signed.data.signedUrl,
        bucket: MESSAGE_ATTACHMENTS_BUCKET,
        file_name: validation.safeFileName,
        content_type: validation.contentType,
        file_size: file.file_size,
        duration_seconds: validation.durationSeconds,
      });
    }

    return Response.json({ uploads });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}

// Best-effort cleanup for objects uploaded before a later attachment in the same
// batch failed. The company namespace and current thread participation are
// checked again; arbitrary bucket paths can never be removed by a client.
export async function DELETE(
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
    if (!parsedParams.success) {
      return validationError([{ path: "id", message: "Invalid thread id" }]);
    }
    const parsed = discardSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return validationError(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        }))
      );
    }

    const threadId = parsedParams.data.id;
    const { supabase, companyId, userId } = await getCompanyId();
    const { thread, participant } = await getThreadIfParticipant(
      supabase,
      companyId,
      threadId,
      userId
    );
    if (!participant || !thread) return forbidden();
    if (parsed.data.paths.some((path) => !isCompanyScopedMessagePath(companyId, path))) {
      return forbidden("Invalid attachment path");
    }

    const db = getSupabaseAdmin() ?? supabase;
    const linked = await db
      .from("message_attachments")
      .select("storage_path")
      .eq("company_id", companyId)
      .in("storage_path", parsed.data.paths);
    if (linked.error) return serverError(linked.error.message || "Failed to verify uploads");
    const linkedPaths = new Set(
      (linked.data ?? []).map((row: { storage_path?: string }) => String(row.storage_path ?? ""))
    );
    const unlinkedPaths = parsed.data.paths.filter((path) => !linkedPaths.has(path));
    if (unlinkedPaths.length === 0) return Response.json({ discarded: 0 });

    const removal = await db.storage.from(MESSAGE_ATTACHMENTS_BUCKET).remove(unlinkedPaths);
    if (removal.error) return serverError(removal.error.message || "Failed to discard uploads");
    return Response.json({ discarded: unlinkedPaths.length });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}
