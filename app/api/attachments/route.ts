/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const entityTypeSchema = z.enum(["job", "daily_report", "work_order"]);

const normalizeId = (id: unknown) => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  return id;
};

const normalizeNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const mapAttachment = (row: any) => ({
  id: row.id,
  entityType: row.entity_type ?? row.entityType ?? "",
  entityId: normalizeId(row.entity_id ?? row.entityId),
  fileName: row.file_name ?? row.fileName ?? "",
  contentType: row.content_type ?? row.contentType ?? "application/octet-stream",
  bucket: row.storage_bucket ?? row.bucket ?? "attachments",
  path: row.storage_path ?? row.path ?? row.file_path ?? "",
  fileSize: normalizeNumber(row.file_size ?? row.fileSize),
  createdAt: row.created_at ?? row.createdAt ?? "",
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const entityTypeValue = searchParams.get("entity_type");
    const entityIdValue = searchParams.get("entity_id");

    if (!entityTypeValue || !entityIdValue) {
      return NextResponse.json(
        { error: "entity_type and entity_id are required" },
        { status: 400 }
      );
    }

    const entityTypeParsed = entityTypeSchema.safeParse(entityTypeValue);
    if (!entityTypeParsed.success) {
      return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
    }

    const { supabase, companyId } = await getCompanyId();
    const supabaseAdmin = getSupabaseAdmin();

    let result = await supabase
      .from("attachments")
      .select("*")
      .eq("company_id", companyId)
      .eq("entity_type", entityTypeParsed.data)
      .eq("entity_id", normalizeId(entityIdValue))
      .order("created_at", { ascending: false });

    if (result.error?.message?.toLowerCase().includes("created_at")) {
      result = await supabase
        .from("attachments")
        .select("*")
        .eq("company_id", companyId)
        .eq("entity_type", entityTypeParsed.data)
        .eq("entity_id", normalizeId(entityIdValue))
        .order("id", { ascending: false });
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const mapped = (data ?? []).map(mapAttachment);
    const withSignedUrls = await Promise.all(
      mapped.map(async (attachment) => {
        if (!attachment.bucket || !attachment.path) {
          return { ...attachment, signedDownloadUrl: null };
        }
        const storageClient = supabaseAdmin ?? supabase;
        const { data: signedData, error: signedError } = await storageClient.storage
          .from(attachment.bucket)
          .createSignedUrl(attachment.path, 60 * 60);
        if (signedError || !signedData?.signedUrl) {
          return { ...attachment, signedDownloadUrl: null };
        }
        return { ...attachment, signedDownloadUrl: signedData.signedUrl };
      })
    );

    return NextResponse.json({ attachments: withSignedUrls });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
