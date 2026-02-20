/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";

const entityTypeSchema = z.enum(["job", "daily_report", "work_order"]);

const normalizeId = (id: unknown): string | number | null => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  if (typeof id === "string") return id;
  return String(id);
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

const jsonUploadSchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: z.union([z.number(), z.string()]),
  file_name: z.string().min(1),
  content_type: z.string().optional(),
  file_base64: z.string().min(1),
});

const sanitizeFileName = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);

const getBucketForEntityType = (entityType: "job" | "daily_report" | "work_order") => {
  if (entityType === "job") return "job-photos";
  if (entityType === "daily_report") return "report-attachments";
  return "work-order-attachments";
};

const normalizeEntityIdForPath = (id: unknown) => {
  if (typeof id === "number") return String(id);
  if (typeof id === "string") return id.trim();
  return String(id);
};

async function insertWithColumnFallback(supabase: any, payload: Record<string, unknown>) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("attachments")
      .insert(currentPayload)
      .select("*")
      .single();
    lastResult = result;
    const message = result.error?.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) return result;
    const missingColumn = match[1];
    if (!(missingColumn in currentPayload)) return result;
    delete currentPayload[missingColumn];
  }

  return lastResult;
}

async function assertEntityOwnership(
  supabase: any,
  companyId: string,
  entityType: "job" | "daily_report" | "work_order",
  entityId: string | number | null
) {
  if (entityId === null) return { ok: false, error: "Invalid entity_id" };

  if (entityType === "job") {
    const { data, error } = await supabase
      .from("jobs")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", entityId)
      .limit(1);
    if (error || !data?.length) return { ok: false, error: "Job not found" };
    return { ok: true };
  }

  if (entityType === "daily_report") {
    const { data, error } = await supabase
      .from("daily_reports")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", entityId)
      .limit(1);
    if (error || !data?.length) return { ok: false, error: "Daily report not found" };
    return { ok: true };
  }

  const { data, error } = await supabase
    .from("work_orders")
    .select("id")
    .eq("company_id", companyId)
    .eq("id", entityId)
    .limit(1);
  if (error || !data?.length) return { ok: false, error: "Work order not found" };
  return { ok: true };
}

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
          return { ...attachment, signedDownloadUrl: null, download_url: null };
        }
        return {
          ...attachment,
          signedDownloadUrl: signedData.signedUrl,
          download_url: signedData.signedUrl,
        };
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

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman", "mechanic"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const supabaseAdmin = getSupabaseAdmin();
    const storageClient = supabaseAdmin ?? supabase;

    let entityType: "job" | "daily_report" | "work_order";
    let entityId: string | number | null;
    let fileName: string;
    let contentType: string;
    let fileBytes: Uint8Array;

    const contentTypeHeader = request.headers.get("content-type") || "";
    if (contentTypeHeader.includes("multipart/form-data")) {
      const formData = await request.formData();
      const entityTypeParsed = entityTypeSchema.safeParse(String(formData.get("entity_type") || ""));
      if (!entityTypeParsed.success) {
        return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
      }
      entityType = entityTypeParsed.data;
      entityId = normalizeId(formData.get("entity_id"));
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file is required" }, { status: 400 });
      }
      fileName = file.name || "upload.bin";
      contentType = file.type || "application/octet-stream";
      fileBytes = new Uint8Array(await file.arrayBuffer());
    } else {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      const parsed = jsonUploadSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid attachment upload payload", details: parsed.error.flatten() },
          { status: 400 }
        );
      }
      entityType = parsed.data.entity_type;
      entityId = normalizeId(parsed.data.entity_id);
      fileName = parsed.data.file_name;
      contentType = parsed.data.content_type || "application/octet-stream";
      const base64Payload = parsed.data.file_base64.includes(",")
        ? parsed.data.file_base64.split(",").pop() || ""
        : parsed.data.file_base64;
      fileBytes = new Uint8Array(Buffer.from(base64Payload, "base64"));
    }

    const ownership = await assertEntityOwnership(supabase, companyId, entityType, entityId);
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: 404 });
    }

    const safeFileName = sanitizeFileName(fileName);
    const bucket = getBucketForEntityType(entityType);
    const path = `${companyId}/${entityType}/${normalizeEntityIdForPath(entityId)}/${Date.now()}-${safeFileName}`;

    const { error: uploadError } = await storageClient.storage
      .from(bucket)
      .upload(path, fileBytes, { upsert: false, contentType });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 400 });
    }

    const insertPayload = {
      company_id: companyId,
      entity_type: entityType,
      entity_id: entityId,
      file_name: safeFileName,
      content_type: contentType,
      bucket,
      path,
      file_path: path,
      storage_bucket: bucket,
      storage_path: path,
      file_size: fileBytes.byteLength,
      uploaded_by: userId,
    };

    let result = await insertWithColumnFallback(supabase, insertPayload);
    if (result.error?.message?.includes("uploaded_by")) {
      const withoutUploadedBy: Record<string, unknown> = { ...insertPayload };
      delete withoutUploadedBy.uploaded_by;
      result = await insertWithColumnFallback(supabase, withoutUploadedBy);
    }

    const { data, error } = result;
    if (error) {
      await storageClient.storage.from(bucket).remove([path]);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const mapped = mapAttachment(data);
    const { data: signedData } = await storageClient.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60);
    return NextResponse.json({
      attachment: {
        ...mapped,
        signedDownloadUrl: signedData?.signedUrl ?? null,
        download_url: signedData?.signedUrl ?? null,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
