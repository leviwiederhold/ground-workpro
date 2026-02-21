/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const entityTypeSchema = z.enum(["job", "daily_report", "work_order", "document"]);

const confirmSchema = z.object({
  entity_type: entityTypeSchema,
  entity_id: z.union([z.number(), z.string()]),
  bucket: z.string().min(1),
  path: z.string().min(1),
  file_name: z.string().min(1),
  content_type: z.string().default("application/octet-stream").optional(),
  file_size: z.union([z.number(), z.string()]).nullable().optional(),
});

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

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman", "mechanic"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid attachment payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const insertPayload = {
      company_id: companyId,
      entity_type: payload.entity_type,
      entity_id: normalizeId(payload.entity_id),
      file_name: payload.file_name,
      content_type: payload.content_type ?? "application/octet-stream",
      bucket: payload.bucket,
      path: payload.path,
      file_path: payload.path,
      storage_bucket: payload.bucket,
      storage_path: payload.path,
      file_size: normalizeNumber(payload.file_size),
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
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ attachment: mapAttachment(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
