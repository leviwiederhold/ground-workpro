import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";

const normalizeId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const isDocumentAttachment = (attachment: Record<string, unknown>, companyId: string) => {
  const entityType = String(attachment.entity_type ?? "");
  if (entityType === "document") return true;
  const path = String(attachment.storage_path ?? attachment.path ?? attachment.file_path ?? "");
  return path.includes(`/${companyId}/document/`);
};

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();
    const supabaseAdmin = getSupabaseAdmin();

    const { data: existing, error: existingError } = await supabase
      .from("attachments")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizeId(id))
      .single();

    if (existingError || !existing) {
      return NextResponse.json(
        { error: existingError?.message || "Attachment not found" },
        { status: 404 }
      );
    }

    try {
      if (isDocumentAttachment(existing, companyId)) {
        await requireRole(["admin", "pm"]);
      } else {
        await requireRole(["admin", "pm", "foreman", "mechanic"]);
      }
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const bucket = existing.storage_bucket ?? existing.bucket;
    const path = existing.storage_path ?? existing.path ?? existing.file_path;

    if (bucket && path) {
      const storageClient = supabaseAdmin ?? supabase;
      const { error: storageError } = await storageClient.storage
        .from(bucket)
        .remove([path]);
      if (storageError) {
        return NextResponse.json({ error: storageError.message }, { status: 400 });
      }
    }

    const { error: deleteError } = await supabase
      .from("attachments")
      .delete()
      .eq("company_id", companyId)
      .eq("id", normalizeId(id));

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
