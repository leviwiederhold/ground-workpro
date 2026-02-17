/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const entityTypeSchema = z.enum(["job", "daily_report", "work_order"]);

const uploadUrlSchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: z.union([z.number(), z.string()]),
  file_name: z.string().min(1),
  content_type: z.string().default("application/octet-stream").optional(),
});

const sanitizeFileName = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);

const normalizeEntityId = (id: unknown) => {
  if (typeof id === "number") return String(id);
  if (typeof id === "string") return id.trim();
  return String(id);
};

const getAttachmentsBucket = () =>
  process.env.SUPABASE_ATTACHMENTS_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_ATTACHMENTS_BUCKET ||
  "attachments";

export async function POST(request: Request) {
  try {
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
    const bucket = getAttachmentsBucket();
    const safeFileName = sanitizeFileName(payload.file_name);
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
      contentType: payload.content_type ?? "application/octet-stream",
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
