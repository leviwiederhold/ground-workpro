import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { getThreadIfParticipant } from "@/lib/messages/mvp";
import {
  MAX_MESSAGE_ATTACHMENTS,
  MESSAGE_ATTACHMENTS_BUCKET,
  buildMessageAttachmentPath,
  validateMessageFileMeta,
} from "@/lib/messages/attachments";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });

const signSchema = z.object({
  files: z
    .array(
      z.object({
        file_name: z.string().min(1),
        content_type: z.string().min(1),
        file_size: z.number().finite().positive(),
      })
    )
    .min(1)
    .max(MAX_MESSAGE_ATTACHMENTS),
});

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

// Issue short-lived signed upload URLs so the browser uploads attachment bytes
// DIRECTLY to Supabase Storage — bypassing the platform's serverless request
// body limit (which is far below our 10 MB max). Every file's type/size is
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
    for (const file of parsed.data.files) {
      const validation = validateMessageFileMeta(file);
      if (!validation.ok) {
        return validationError([{ path: "files", message: `${file.file_name}: ${validation.error}` }]);
      }
      const path = buildMessageAttachmentPath(companyId, validation.safeFileName);
      const signed = await db.storage.from(MESSAGE_ATTACHMENTS_BUCKET).createSignedUploadUrl(path);
      if (signed.error || !signed.data) {
        return serverError(signed.error?.message || "Failed to prepare upload");
      }
      uploads.push({
        path,
        token: signed.data.token,
        signed_url: signed.data.signedUrl,
        bucket: MESSAGE_ATTACHMENTS_BUCKET,
        file_name: validation.safeFileName,
        content_type: validation.contentType,
        file_size: file.file_size,
      });
    }

    return Response.json({ uploads });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError(error instanceof Error ? error.message : "Internal server error");
  }
}
