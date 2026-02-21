/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { requireActiveSubscription } from "@/lib/billing/requireActiveSubscription";

const allowedEntityTypes = ["job", "daily_report", "work_order", "document"] as const;
type EntityType = (typeof allowedEntityTypes)[number];
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

const sanitizeFileName = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 180);

const normalizeEntityIdForPath = (id: unknown) => {
  if (typeof id === "number") return String(id);
  if (typeof id === "string") return id.trim();
  return String(id);
};

const getBucketForEntityType = (entityType: EntityType) => {
  if (entityType === "job") return "job-photos";
  if (entityType === "daily_report") return "report-attachments";
  if (entityType === "document") return "report-attachments";
  return "work-order-attachments";
};

const mapAttachment = (row: any, companyId?: string) => {
  const rawEntityType = row.entity_type ?? row.entityType ?? "";
  const rawPath = String(row.storage_path ?? row.path ?? row.file_path ?? "");
  const normalizedEntityType =
    rawEntityType === "work_order" && companyId && rawPath.includes(`/${companyId}/document/`)
      ? "document"
      : rawEntityType;
  return {
    id: row.id,
    entityType: normalizedEntityType,
    entityId: normalizeId(row.entity_id ?? row.entityId),
    fileName: row.file_name ?? row.fileName ?? "",
    contentType: row.content_type ?? row.contentType ?? "application/octet-stream",
    bucket: row.storage_bucket ?? row.bucket ?? "attachments",
    path: row.storage_path ?? row.path ?? row.file_path ?? "",
    fileSize: normalizeNumber(row.file_size ?? row.fileSize),
    createdAt: row.created_at ?? row.createdAt ?? "",
  };
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
  entityType: EntityType,
  entityId: string | number | null
) {
  if (entityType === "document") {
    return { ok: true };
  }

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

export async function POST(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const subscriptionError = await requireActiveSubscription(supabase, companyId);
    if (subscriptionError) {
      return subscriptionError;
    }
    const supabaseAdmin = getSupabaseAdmin();
    const storageClient = supabaseAdmin ?? supabase;

    const formData = await request.formData();
    const entityTypeRaw = String(formData.get("entity_type") || "");
    const entityIdRaw = formData.get("entity_id");
    const file = formData.get("file");

    if (!allowedEntityTypes.includes(entityTypeRaw as EntityType)) {
      return NextResponse.json({ error: "Invalid entity_type" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const entityType = entityTypeRaw as EntityType;
    const entityId = entityType === "document" ? companyId : normalizeId(entityIdRaw);

    try {
      if (entityType === "document") {
        await requireRole(["admin", "pm"]);
      } else {
        await requireRole(["admin", "pm", "foreman", "mechanic"]);
      }
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const ownership = await assertEntityOwnership(supabase, companyId, entityType, entityId);
    if (!ownership.ok) {
      return NextResponse.json({ error: ownership.error }, { status: 404 });
    }

    const safeFileName = sanitizeFileName(file.name || "upload.bin");
    const contentType = file.type || "application/octet-stream";
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const bucket = getBucketForEntityType(entityType);
    const pathEntityScope = entityType === "document" ? "company" : normalizeEntityIdForPath(entityId);
    const path = `${companyId}/${entityType}/${pathEntityScope}/${crypto.randomUUID()}_${safeFileName}`;

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
    if (
      entityType === "document" &&
      result.error?.message?.includes("attachments_entity_type_check")
    ) {
      const legacyPayload: Record<string, unknown> = {
        ...insertPayload,
        entity_type: "work_order",
      };
      result = await insertWithColumnFallback(supabase, legacyPayload);
    }

    const { data, error } = result;
    if (error) {
      await storageClient.storage.from(bucket).remove([path]);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const mapped = mapAttachment(data, companyId);
    const { data: signedData } = await storageClient.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60);

    return NextResponse.json({
      attachment: {
        ...mapped,
        download_url: signedData?.signedUrl ?? null,
        signedDownloadUrl: signedData?.signedUrl ?? null,
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
