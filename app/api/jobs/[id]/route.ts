/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";
import { hasModuleAccess, resolveUserModulePermissions } from "@/lib/permissions/runtime";
import {
  getEffectiveScopedJobIds,
  resolveMembershipRole,
} from "@/lib/jobs/roleScope";
import { resolveJobLocation } from "@/lib/geocode/provider";

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
    title: z.string().min(1).optional(),
    status: jobStatusSchema.optional(),
    client: z.string().nullable().optional(),
    client_name: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    site_address: z.string().nullable().optional(),
    startDate: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    targetEndDate: z.string().nullable().optional(),
    target_end_date: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    budget: z.union([z.number(), z.string()]).nullable().optional(),
    lat: z.union([z.number(), z.string()]).nullable().optional(),
    lng: z.union([z.number(), z.string()]).nullable().optional(),
    place_id: z.string().nullable().optional(),
    address_verified: z.boolean().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

type JobNotesMeta = {
  client?: string;
  start_date?: string;
  target_end_date?: string;
  source_bid_id?: string;
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
  if (meta.source_bid_id) compactMeta.source_bid_id = meta.source_bid_id;
  const base = plainNotes?.trimEnd() ?? "";
  if (Object.keys(compactMeta).length === 0) return base;
  return `${base}${JOB_META_PREFIX}${JSON.stringify(compactMeta)}${JOB_META_SUFFIX}`;
}

const mapJob = (row: any) => {
  const parsedNotes = parseJobNotes(row.notes);
  const siteAddress = row.site_address ?? row.address ?? "";
  const hasCoordinates = row.lat !== null && row.lat !== undefined && row.lng !== null && row.lng !== undefined;
  return {
  id: row.id,
  name: row.name ?? "",
  client: row.client ?? row.client_name ?? parsedNotes.meta.client ?? "",
  client_name: row.client_name ?? row.client ?? parsedNotes.meta.client ?? "",
  status: row.status ?? "draft",
  address: siteAddress,
  site_address: siteAddress,
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
  place_id: row.place_id ?? null,
  address_verified: Boolean(row.address_verified) && hasCoordinates,
  needs_address_verification: Boolean(siteAddress) && !(Boolean(row.address_verified) && hasCoordinates),
  geocoding_status: hasCoordinates ? "resolved" : siteAddress ? "not_configured" : "not_requested",
  source_bid_id: row.source_bid_id ?? parsedNotes.meta.source_bid_id ?? null,
  sourceBidId: row.source_bid_id ?? parsedNotes.meta.source_bid_id ?? null,
  };
};

const FINANCIAL_JOB_FIELDS = [
  "budget",
  "budget_cost",
  "budgetCost",
  "spent",
  "cost",
  "cost_to_date",
  "costToDate",
  "profit",
  "margin",
  "margin_percent",
  "marginPercent",
  "marginPct",
  "contract_value",
  "contractValue",
] as const;

async function canAccessJobFinancials(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  userId: string,
  role: string | null | undefined
) {
  if (role === "admin" || role === "pm") return true;
  if (!role) return false;
  const permissions = await resolveUserModulePermissions({
    supabase,
    companyId,
    userId,
    role: role as any,
  });
  return hasModuleAccess(permissions, "finance", "view") || hasModuleAccess(permissions, "reports", "view");
}

function redactJobFinancials<T extends Record<string, unknown>>(job: T, canViewFinancials: boolean): T {
  if (canViewFinancials) return job;
  const redacted = { ...job };
  for (const field of FINANCIAL_JOB_FIELDS) {
    delete redacted[field];
  }
  return redacted as T;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null) return null;
  return normalizeText(value);
}

function firstDefined<T>(...values: T[]): T | undefined {
  return values.find((value) => value !== undefined);
}

function normalizeBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

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

  for (let attempt = 0; attempt < 12; attempt += 1) {
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

    if (missingColumn === "budget" && "budget" in updatePayload) {
      delete updatePayload.budget;
      continue;
    }
    if ((missingColumn === "lat" || missingColumn === "lng") && missingColumn in updatePayload) {
      delete updatePayload[missingColumn];
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
    const membershipRole = await resolveMembershipRole(supabase, companyId, userId);
    const effectiveRole = await getEffectiveRole();
    const role = effectiveRole ?? membershipRole;

    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (role === "mechanic") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const normalizedId = normalizeId(id);
    const scopedJobIds = await getEffectiveScopedJobIds(supabase, companyId, userId, role);
    if (scopedJobIds && !scopedJobIds.includes(String(normalizedId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const canViewFinancials = await canAccessJobFinancials(supabase, companyId, userId, role);

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

    return NextResponse.json({ job: redactJobFinancials(mapJob(data), canViewFinancials) });
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
    let access: Awaited<ReturnType<typeof requireModuleAccess>>;
    try {
      access = await requireModuleAccess("jobs", "edit");
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

    const { supabase } = await getCompanyId();
    const { companyId, userId } = access;
    const updatesBody = parsed.data;
    const normalizedId = normalizeId(id);
    const role = (await getEffectiveRole()) ?? (await resolveMembershipRole(supabase, companyId, userId));
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const canViewFinancials = await canAccessJobFinancials(supabase, companyId, userId, role);
    const scopedJobIds = await getEffectiveScopedJobIds(supabase, companyId, userId, role);
    if (scopedJobIds && !scopedJobIds.includes(String(normalizedId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: beforeRow } = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", normalizedId)
      .maybeSingle();

    const beforeParsedNotes = parseJobNotes(beforeRow?.notes);
    const clientUpdate = firstDefined(updatesBody.client, updatesBody.client_name);
    const addressUpdate = firstDefined(updatesBody.site_address, updatesBody.address);
    const startDateUpdate = firstDefined(updatesBody.start_date, updatesBody.startDate);
    const targetEndDateUpdate = firstDefined(
      updatesBody.target_end_date,
      updatesBody.targetEndDate,
      updatesBody.end_date,
      updatesBody.endDate
    );
    const notesUpdate = firstDefined(updatesBody.notes, updatesBody.description);
    const nameUpdate = firstDefined(updatesBody.name, updatesBody.title);

    const resolvedClient =
      clientUpdate !== undefined
        ? (clientUpdate ?? "")
        : (beforeRow?.client ?? beforeRow?.client_name ?? beforeParsedNotes.meta.client ?? "");
    const resolvedStartDate =
      startDateUpdate !== undefined
        ? (startDateUpdate ?? "")
        : (beforeRow?.start_date ?? beforeRow?.startDate ?? beforeParsedNotes.meta.start_date ?? "");
    const resolvedTargetEndDate =
      targetEndDateUpdate !== undefined
        ? (targetEndDateUpdate ?? "")
        : (beforeRow?.target_end_date ?? beforeRow?.targetEndDate ?? beforeRow?.end_date ?? beforeRow?.endDate ?? beforeParsedNotes.meta.target_end_date ?? "");
    const resolvedNotesText =
      notesUpdate !== undefined
        ? (notesUpdate ?? "")
        : beforeParsedNotes.plainNotes;

    const updatePayload: Record<string, unknown> = {};
    if (nameUpdate !== undefined) updatePayload.name = normalizeText(nameUpdate);
    if (updatesBody.status !== undefined) updatePayload.status = updatesBody.status;
    if (clientUpdate !== undefined) {
      updatePayload.client = normalizeNullableText(clientUpdate);
      updatePayload.client_name = normalizeNullableText(clientUpdate);
    }
    if (addressUpdate !== undefined) {
      const nextAddress = normalizeNullableText(addressUpdate);
      updatePayload.site_address = nextAddress;
      // Resolve coordinates instead of blindly nulling them: trust a verified
      // provider result, else server-geocode, else store unverified/null.
      const location = await resolveJobLocation({
        address: String(nextAddress ?? ''),
        lat: updatesBody.lat,
        lng: updatesBody.lng,
        place_id: updatesBody.place_id,
        address_verified: updatesBody.address_verified,
      });
      updatePayload.lat = location.lat;
      updatePayload.lng = location.lng;
      updatePayload.place_id = location.place_id;
      updatePayload.address_verified = location.address_verified;
    }
    if (startDateUpdate !== undefined) updatePayload.start_date = normalizeText(startDateUpdate) || null;
    if (targetEndDateUpdate !== undefined) updatePayload.target_end_date = normalizeText(targetEndDateUpdate) || null;
    if (canViewFinancials && updatesBody.budget !== undefined) {
      updatePayload.budget = normalizeBudget(updatesBody.budget);
    }
    updatePayload.notes = buildJobNotes(resolvedNotesText, {
      client: normalizeText(resolvedClient),
      start_date: normalizeText(resolvedStartDate),
      target_end_date: normalizeText(resolvedTargetEndDate),
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

    const job = redactJobFinancials(mapJob(updatedRow), canViewFinancials);
    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "job.updated",
      entityType: "job",
      entityId: normalizedId as string | number,
      before: beforeRow ? redactJobFinancials(mapJob(beforeRow), canViewFinancials) : null,
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
    let access: Awaited<ReturnType<typeof requireModuleAccess>>;
    try {
      access = await requireModuleAccess("jobs", "edit");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { supabase } = await getCompanyId();
    const { companyId, userId } = access;
    const normalizedId = normalizeId(id);
    const role = (await getEffectiveRole()) ?? (await resolveMembershipRole(supabase, companyId, userId));
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const scopedJobIds = await getEffectiveScopedJobIds(supabase, companyId, userId, role);
    if (scopedJobIds && !scopedJobIds.includes(String(normalizedId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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

    const cleanupPurchaseOrderItemsByJob = async () => {
      const poResult = await supabase
        .from("purchase_orders")
        .select("id")
        .eq("company_id", companyId)
        .eq("job_id", normalizedId);
      if (poResult.error) {
        if (isMissingTableError(poResult.error.message) || isMissingSchemaError(poResult.error.message)) return null;
        return poResult.error.message;
      }
      const purchaseOrderIds = (poResult.data ?? [])
        .map((row: Record<string, unknown>) => String(row.id ?? ""))
        .filter(Boolean);
      if (purchaseOrderIds.length === 0) return null;

      const deleteResult = await supabase
        .from("purchase_order_items")
        .delete()
        .eq("company_id", companyId)
        .in("purchase_order_id", purchaseOrderIds);
      if (deleteResult.error) {
        if (isMissingTableError(deleteResult.error.message) || isMissingSchemaError(deleteResult.error.message)) return null;
        return deleteResult.error.message;
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
      cleanupPurchaseOrderItemsByJob(),
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
