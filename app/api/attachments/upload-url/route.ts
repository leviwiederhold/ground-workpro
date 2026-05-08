import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import {
  fileSizeSchema,
  getServerAttachmentBucket,
  sanitizeAttachmentFileName,
  validateAttachmentMetadata,
} from "@/src/lib/attachments/security";

const entityTypeSchema = z.enum(["job", "daily_report", "work_order", "document", "vendor"]);

const uploadUrlSchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: z.union([z.number(), z.string()]),
  file_name: z.string().min(1),
  content_type: z.string().min(1),
  file_size: fileSizeSchema,
});

const normalizeEntityId = (id: unknown) => {
  if (typeof id === "number") return String(id);
  if (typeof id === "string") return id.trim();
  return String(id);
};

export async function POST(request: Request) {
  try {
    try {
      const rolePayload = await request.clone().json().catch(() => null);
      if (rolePayload?.entity_type === "vendor" || rolePayload?.entity_type === "document") {
        await requireRole(["admin", "pm"]);
      } else {
        await requireRole(["admin", "pm", "foreman", "mechanic"]);
      }
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = uploadUrlSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid upload request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const supabaseAdmin = getSupabaseAdmin();
    const payload = parsed.data;
    const validation = validateAttachmentMetadata({
      fileName: payload.file_name,
      contentType: payload.content_type,
      sizeBytes: payload.file_size,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const bucket = getServerAttachmentBucket();
    const safeFileName = sanitizeAttachmentFileName(validation.safeFileName);
    const entityId = normalizeEntityId(payload.entity_id);
    const path = `${companyId}/${payload.entity_type}/${entityId}/${Date.now()}-${safeFileName}`;

    const storageClient = supabaseAdmin ?? supabase;
    const { data, error } = await storageClient.storage
      .from(bucket)
      .createSignedUploadUrl(path);

    if (error || !data?.signedUrl) {
      const lowerMessage = error?.message?.toLowerCase() ?? "";
      const hints =
        !supabaseAdmin &&
        (lowerMessage.includes("row-level security") || lowerMessage.includes("policy"))
          ? " Configure SUPABASE_SERVICE_ROLE_KEY on the server or add Storage RLS policies for uploads."
          : "";
      const projectMismatchHint =
        lowerMessage.includes("related resource does not exist") ||
        lowerMessage.includes("bucket")
          ? " Verify bucket exists in the same Supabase project as NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
          : "";
      return NextResponse.json(
        {
          error: `${error?.message || "Failed to create signed upload URL"}${hints}${projectMismatchHint}`,
          details: {
            bucket,
            path,
            usingAdminClient: Boolean(supabaseAdmin),
          },
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      bucket,
      path,
      signedUploadUrl: data.signedUrl,
      token: data.token ?? null,
      contentType: validation.contentType,
      maxSizeBytes: validation.sizeBytes,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
