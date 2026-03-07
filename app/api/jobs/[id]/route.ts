/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";
import { getRoleScopedJobIds, resolveMembershipRole } from "@/lib/jobs/roleScope";

const jobStatusSchema = z.enum([
  "draft",
  "sent",
  "approved",
  "in_progress",
  "completed",
  "canceled",
]);

const updateJobSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: jobStatusSchema.optional(),
    client: z.string().nullable().optional(),
    site_address: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    target_end_date: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

type JobNotesMeta = {
  client?: string;
  start_date?: string;
  target_end_date?: string;
};

const JOB_META_PREFIX = "\n<!--GW_META:";
const JOB_META_SUFFIX = "-->";

function parseJobNotes(raw: unknown): { plainNotes: string; meta: JobNotesMeta } {
  const text = typeof raw === "string" ? raw : "";
  const start = text.indexOf(JOB_META_PREFIX);
  const end = start >= 0 ? text.indexOf(JOB_META_SUFFIX, start + JOB_META_PREFIX.length) : -1;
  if (start < 0 || end < 0) {
    return { plainNotes: text, meta: {} };
  }
  const plainNotes = text.slice(0, start).trimEnd();
  const jsonText = text.slice(start + JOB_META_PREFIX.length, end).trim();
  try {
    const parsed = JSON.parse(jsonText) as JobNotesMeta;
    return { plainNotes, meta: parsed && typeof parsed === "object" ? parsed : {} };
  } catch {
    return { plainNotes, meta: {} };
  }
}

function buildJobNotes(plainNotes: string, meta: JobNotesMeta): string {
  const compactMeta: JobNotesMeta = {};
  if (meta.client) compactMeta.client = meta.client;
  if (meta.start_date) compactMeta.start_date = meta.start_date;
  if (meta.target_end_date) compactMeta.target_end_date = meta.target_end_date;
  const base = plainNotes?.trimEnd() ?? "";
  if (Object.keys(compactMeta).length === 0) return base;
  return `${base}${JOB_META_PREFIX}${JSON.stringify(compactMeta)}${JOB_META_SUFFIX}`;
}

const mapJob = (row: any) => {
  const parsedNotes = parseJobNotes(row.notes);
  return {
  id: row.id,
  name: row.name ?? "",
  client: row.client ?? row.client_name ?? parsedNotes.meta.client ?? "",
  client_name: row.client_name ?? row.client ?? parsedNotes.meta.client ?? "",
  status: row.status ?? "draft",
  address: row.site_address ?? row.address ?? "",
  site_address: row.site_address ?? row.address ?? "",
  notes: parsedNotes.plainNotes,
  budget: Number(row.budget ?? 0),
  spent: Number(row.spent ?? 0),
  startDate: row.startDate ?? row.start_date ?? parsedNotes.meta.start_date ?? "",
  start_date: row.start_date ?? row.startDate ?? parsedNotes.meta.start_date ?? "",
  targetEndDate: row.targetEndDate ?? row.target_end_date ?? row.endDate ?? row.end_date ?? parsedNotes.meta.target_end_date ?? "",
  target_end_date: row.target_end_date ?? row.targetEndDate ?? row.endDate ?? row.end_date ?? parsedNotes.meta.target_end_date ?? "",
  endDate: row.endDate ?? row.end_date ?? "",
  progress: Number(row.progress ?? 0),
  lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
  lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
  };
};

const normalizeId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const isMissingSchemaError = (message: string | undefined) =>
  /(column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table)/i.test(
    message ?? ""
  );

const parseMissingColumn = (message: string | undefined): string | null => {
  if (!message) return null;
  const quoted = message.match(/Could not find the '([^']+)' column/i);
  if (quoted?.[1]) return quoted[1];
  const relation = message.match(/column "?([a-zA-Z0-9_]+)"? of relation/i);
  if (relation?.[1]) return relation[1];
  const generic = message.match(/column "?([a-zA-Z0-9_]+)"? does not exist/i);
  if (generic?.[1]) return generic[1];
  return null;
};

const isMissingTableError = (message: string | undefined) =>
  /relation .* does not exist|Could not find the table/i.test(message ?? "");

async function updateJobWithSchemaFallback(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  jobId: string | number,
  payload: Record<string, unknown>
) {
  const updatePayload: Record<string, unknown> = { ...payload };

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await supabase
      .from("jobs")
      .update(updatePayload)
      .eq("company_id", companyId)
      .eq("id", jobId)
      .select("*");
    if (!result.error) return result;

    const message = result.error.message ?? "";
    if (!isMissingSchemaError(message)) return result;

    const missingColumn = parseMissingColumn(message);
    if (!missingColumn) return result;

    if (missingColumn === "client" && "client" in updatePayload) {
      if (!("client_name" in updatePayload)) {
        updatePayload.client_name = updatePayload.client;
      }
      delete updatePayload.client;
      continue;
    }
    if (missingColumn === "client_name" && "client_name" in updatePayload) {
      delete updatePayload.client_name;
      continue;
    }
    if (missingColumn === "start_date" && "start_date" in updatePayload) {
      if (!("startDate" in updatePayload)) {
        updatePayload.startDate = updatePayload.start_date;
      }
      delete updatePayload.start_date;
      continue;
    }
    if (missingColumn === "startDate" && "startDate" in updatePayload) {
      delete updatePayload.startDate;
      continue;
    }
    if (missingColumn === "target_end_date" && "target_end_date" in updatePayload) {
      if (!("targetEndDate" in updatePayload)) {
        updatePayload.targetEndDate = updatePayload.target_end_date;
      }
      delete updatePayload.target_end_date;
      continue;
    }
    if (missingColumn === "targetEndDate" && "targetEndDate" in updatePayload) {
      delete updatePayload.targetEndDate;
      continue;
    }

    if (missingColumn in updatePayload) {
      delete updatePayload[missingColumn];
      if (Object.keys(updatePayload).length === 0) {
        const current = await supabase
          .from("jobs")
          .select("*")
          .eq("company_id", companyId)
          .eq("id", jobId)
          .maybeSingle();
        return { data: current.data, error: current.error };
      }
      continue;
    }

    return result;
  }

  return supabase
    .from("jobs")
    .update(updatePayload)
    .eq("company_id", companyId)
    .eq("id", jobId)
    .select("*");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, companyId, userId } = await getCompanyId();
    const effectiveRole = await getEffectiveRole();
    const membershipRole = await resolveMembershipRole(supabase, companyId, userId);
    const role = effectiveRole ?? membershipRole;

    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const normalizedId = normalizeId(id);
    const scopedJobIds = await getRoleScopedJobIds(supabase, companyId, userId, role);
    if (scopedJobIds && !scopedJobIds.includes(String(normalizedId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizedId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ job: mapJob(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    if (
      body &&
      typeof body === "object" &&
      ("company_id" in body || "created_by" in body || "created_at" in body)
    ) {
      return NextResponse.json(
        { error: "company_id, created_by, and created_at cannot be updated" },
        { status: 400 }
      );
    }

    const parsed = updateJobSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid job payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const updatesBody = parsed.data;
    const normalizedId = normalizeId(id);

    const { data: beforeRow } = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizedId)
      .maybeSingle();

    const beforeParsedNotes = parseJobNotes(beforeRow?.notes);
    const resolvedClient =
      updatesBody.client !== undefined
        ? (updatesBody.client ?? "")
        : (beforeRow?.client ?? beforeRow?.client_name ?? beforeParsedNotes.meta.client ?? "");
    const resolvedStartDate =
      updatesBody.start_date !== undefined
        ? (updatesBody.start_date ?? "")
        : (beforeRow?.start_date ?? beforeRow?.startDate ?? beforeParsedNotes.meta.start_date ?? "");
    const resolvedTargetEndDate =
      updatesBody.target_end_date !== undefined
        ? (updatesBody.target_end_date ?? "")
        : (beforeRow?.target_end_date ?? beforeRow?.targetEndDate ?? beforeRow?.end_date ?? beforeRow?.endDate ?? beforeParsedNotes.meta.target_end_date ?? "");
    const resolvedNotesText =
      updatesBody.notes !== undefined
        ? (updatesBody.notes ?? "")
        : beforeParsedNotes.plainNotes;

    const updatePayload: Record<string, unknown> = {};
    if (updatesBody.name !== undefined) updatePayload.name = updatesBody.name;
    if (updatesBody.status !== undefined) updatePayload.status = updatesBody.status;
    if (updatesBody.client !== undefined) updatePayload.client = updatesBody.client;
    if (updatesBody.site_address !== undefined) updatePayload.site_address = updatesBody.site_address;
    if (updatesBody.start_date !== undefined) updatePayload.start_date = updatesBody.start_date || null;
    if (updatesBody.target_end_date !== undefined) updatePayload.target_end_date = updatesBody.target_end_date || null;
    updatePayload.notes = buildJobNotes(resolvedNotesText, {
      client: resolvedClient,
      start_date: resolvedStartDate,
      target_end_date: resolvedTargetEndDate,
    });

    const { data, error } = await updateJobWithSchemaFallback(
      supabase,
      companyId,
      normalizedId,
      updatePayload
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const updatedRow = Array.isArray(data) ? data[0] : data;
    if (!updatedRow) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const job = mapJob(updatedRow);
    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "job.updated",
      entityType: "job",
      entityId: normalizedId as string | number,
      before: beforeRow ? mapJob(beforeRow) : null,
      after: job,
    });

    return NextResponse.json({ job });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { supabase, companyId, userId } = await getCompanyId();
    const normalizedId = normalizeId(id);

    const { data: beforeRow } = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizedId)
      .maybeSingle();

    const dependentCleanup = async (table: string) => {
      const result = await supabase
        .from(table)
        .delete()
        .eq("company_id", companyId)
        .eq("job_id", normalizedId);
      if (result.error && !isMissingTableError(result.error.message)) {
        return result.error.message;
      }
      return null;
    };

    const cleanupErrors = await Promise.all([
      dependentCleanup("job_employees"),
      dependentCleanup("job_equipment"),
      dependentCleanup("schedule_assignments"),
      dependentCleanup("daily_reports"),
      dependentCleanup("safety_logs"),
      dependentCleanup("inventory_transactions"),
      dependentCleanup("purchase_order_items"),
    ]);
    const firstCleanupError = cleanupErrors.find(Boolean);
    if (firstCleanupError) {
      return NextResponse.json({ error: firstCleanupError }, { status: 400 });
    }

    const { data: deletedRow, error } = await supabase
      .from("jobs")
      .delete()
      .eq("company_id", companyId)
      .eq("id", normalizedId)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (deletedRow || beforeRow) {
      try {
        await logAuditEvent({
          supabase,
          companyId,
          actorUserId: userId,
          eventType: "job.deleted",
          entityType: "job",
          entityId: normalizedId as string | number,
          before: mapJob((deletedRow ?? beforeRow) as any),
        });
      } catch {
        // Do not fail deletion when optional audit infrastructure is unavailable.
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
