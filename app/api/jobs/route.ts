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

const persistedJobStatusSchema = z.enum([
  "draft",
  "sent",
  "approved",
  "in_progress",
  "completed",
  "canceled",
]);

const listStatusSchema = z.enum(["bidding", "active", "paused", "complete", "all"]);
type ListStatus = "bidding" | "active" | "paused" | "complete" | "all";

const listQuerySchema = z.object({
  status: listStatusSchema.optional().default("all"),
  q: z.string().trim().optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
  cursor: z.string().nullable().optional().default(null),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

const createJobSchema = z.object({
  name: z.string().optional(),
  title: z.string().optional(),
  status: persistedJobStatusSchema.default("draft").optional(),
  client: z.string().default("").optional(),
  client_name: z.string().default("").optional(),
  address: z.string().default("").optional(),
  site_address: z.string().default("").optional(),
  startDate: z.string().default("").optional(),
  start_date: z.string().default("").optional(),
  endDate: z.string().default("").optional(),
  end_date: z.string().default("").optional(),
  targetEndDate: z.string().default("").optional(),
  target_end_date: z.string().default("").optional(),
  notes: z.string().default("").optional(),
  description: z.string().default("").optional(),
  budget: z.union([z.number(), z.string()]).nullable().optional(),
  lat: z.union([z.number(), z.string()]).nullable().optional(),
  lng: z.union([z.number(), z.string()]).nullable().optional(),
  place_id: z.string().nullable().optional(),
  address_verified: z.boolean().optional(),
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
  // When the `address_verified` column is absent from the row — i.e. the
  // migration hasn't been applied in this environment, so PATCH silently drops
  // it and it can never persist as true — fall back to treating persisted
  // coordinates as the verification signal. This app only ever writes lat/lng
  // from a verified geocode/selection (see resolveJobLocation: coordinates are
  // null unless the client result was trusted or a server geocode succeeded),
  // so coordinates present ⟺ the address was verified at write time. When the
  // column IS present, respect its stored value.
  const verifiedColumnPresent = row.address_verified !== undefined && row.address_verified !== null;
  const addressVerified = hasCoordinates && (verifiedColumnPresent ? Boolean(row.address_verified) : true);
  return {
  id: row.id,
  name: row.name ?? "",
  client: row.client ?? row.client_name ?? parsedNotes.meta.client ?? "",
  client_name: row.client_name ?? row.client ?? parsedNotes.meta.client ?? "",
  status: row.status ?? "draft",
  siteAddress: row.siteAddress ?? siteAddress,
  address: siteAddress,
  site_address: siteAddress,
  notes: parsedNotes.plainNotes,
  budget: Number(row.budget ?? 0),
  spent: Number(row.spent ?? 0),
  startDate: row.startDate ?? row.start_date ?? parsedNotes.meta.start_date ?? "",
  targetEndDate: row.targetEndDate ?? row.target_end_date ?? row.endDate ?? row.end_date ?? parsedNotes.meta.target_end_date ?? "",
  endDate: row.endDate ?? row.end_date ?? row.target_end_date ?? "",
  progress: Number(row.progress ?? 0),
  lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
  lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
  place_id: row.place_id ?? null,
  address_verified: addressVerified,
  // Attendance/geofence should only trust verified coordinates.
  needs_address_verification: Boolean(siteAddress) && !addressVerified,
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

function normalizeOptionalDate(...values: unknown[]): string {
  for (const value of values) {
    const text = normalizeText(value);
    if (text) return text;
  }
  return "";
}

function normalizeBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function getJobAssignmentCounts(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  jobIds: string[]
) {
  const empty = new Map<string, { crew: number; equipment: number }>();
  if (jobIds.length === 0) return empty;

  const [crewResult, equipmentResult] = await Promise.all([
    supabase
      .from("job_employees")
      .select("job_id, employee_id")
      .eq("company_id", companyId)
      .in("job_id", jobIds),
    supabase
      .from("job_equipment")
      .select("job_id, equipment_id")
      .eq("company_id", companyId)
      .in("job_id", jobIds),
  ]);
  const [crewFallbackResult, equipmentFallbackResult] = await Promise.all([
    supabase
      .from("employees")
      .select("id, job_id")
      .eq("company_id", companyId)
      .in("job_id", jobIds),
    supabase
      .from("equipment")
      .select("id, job_id")
      .eq("company_id", companyId)
      .in("job_id", jobIds),
  ]);

  const counts = new Map<string, { crew: number; equipment: number }>();
  const crewSeen = new Set<string>();
  const equipmentSeen = new Set<string>();

  if (!crewResult.error) {
    for (const row of crewResult.data ?? []) {
      const key = String((row as any).job_id ?? "");
      const employeeId = String((row as any).employee_id ?? "");
      if (!key) continue;
      const dedupeKey = `${key}:${employeeId}`;
      if (crewSeen.has(dedupeKey)) continue;
      crewSeen.add(dedupeKey);
      const current = counts.get(key) ?? { crew: 0, equipment: 0 };
      current.crew += 1;
      counts.set(key, current);
    }
  }

  if (!equipmentResult.error) {
    for (const row of equipmentResult.data ?? []) {
      const key = String((row as any).job_id ?? "");
      const equipmentId = String((row as any).equipment_id ?? "");
      if (!key) continue;
      const dedupeKey = `${key}:${equipmentId}`;
      if (equipmentSeen.has(dedupeKey)) continue;
      equipmentSeen.add(dedupeKey);
      const current = counts.get(key) ?? { crew: 0, equipment: 0 };
      current.equipment += 1;
      counts.set(key, current);
    }
  }

  if (!crewFallbackResult.error) {
    for (const row of crewFallbackResult.data ?? []) {
      const key = String((row as any).job_id ?? "");
      const employeeId = String((row as any).id ?? "");
      if (!key) continue;
      const dedupeKey = `${key}:${employeeId}`;
      if (crewSeen.has(dedupeKey)) continue;
      crewSeen.add(dedupeKey);
      const current = counts.get(key) ?? { crew: 0, equipment: 0 };
      current.crew += 1;
      counts.set(key, current);
    }
  } else if (!isMissingSchemaError(crewFallbackResult.error.message)) {
    throw new Error(crewFallbackResult.error.message);
  }

  if (!equipmentFallbackResult.error) {
    for (const row of equipmentFallbackResult.data ?? []) {
      const key = String((row as any).job_id ?? "");
      const equipmentId = String((row as any).id ?? "");
      if (!key) continue;
      const dedupeKey = `${key}:${equipmentId}`;
      if (equipmentSeen.has(dedupeKey)) continue;
      equipmentSeen.add(dedupeKey);
      const current = counts.get(key) ?? { crew: 0, equipment: 0 };
      current.equipment += 1;
      counts.set(key, current);
    }
  } else if (!isMissingSchemaError(equipmentFallbackResult.error.message)) {
    throw new Error(equipmentFallbackResult.error.message);
  }

  return counts;
}

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

async function insertJobWithSchemaFallback(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  payload: Record<string, unknown>
) {
  const insertPayload: Record<string, unknown> = { ...payload };

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await supabase.from("jobs").insert(insertPayload).select("*").single();
    if (!result.error) return result;

    const message = result.error.message ?? "";
    if (!isMissingSchemaError(message)) return result;

    const missingColumn = parseMissingColumn(message);
    if (!missingColumn) return result;

    if (missingColumn === "client" && "client" in insertPayload) {
      if (!("client_name" in insertPayload)) {
        insertPayload.client_name = insertPayload.client;
      }
      delete insertPayload.client;
      continue;
    }
    if (missingColumn === "client_name" && "client_name" in insertPayload) {
      delete insertPayload.client_name;
      continue;
    }
    if (missingColumn === "start_date" && "start_date" in insertPayload) {
      if (!("startDate" in insertPayload)) {
        insertPayload.startDate = insertPayload.start_date;
      }
      delete insertPayload.start_date;
      continue;
    }
    if (missingColumn === "startDate" && "startDate" in insertPayload) {
      delete insertPayload.startDate;
      continue;
    }
    if (missingColumn === "target_end_date" && "target_end_date" in insertPayload) {
      if (!("targetEndDate" in insertPayload)) {
        insertPayload.targetEndDate = insertPayload.target_end_date;
      }
      delete insertPayload.target_end_date;
      continue;
    }
    if (missingColumn === "targetEndDate" && "targetEndDate" in insertPayload) {
      delete insertPayload.targetEndDate;
      continue;
    }

    if (missingColumn === "budget" && "budget" in insertPayload) {
      delete insertPayload.budget;
      continue;
    }
    if ((missingColumn === "lat" || missingColumn === "lng") && missingColumn in insertPayload) {
      delete insertPayload[missingColumn];
      continue;
    }

    if (missingColumn in insertPayload) {
      delete insertPayload[missingColumn];
      continue;
    }

    return result;
  }

  return supabase.from("jobs").insert(insertPayload).select("*").single();
}

function resolveStatusFilters(status: ListStatus): string[] | null {
  if (status === "all") return null;
  if (status === "bidding") return ["draft", "sent", "approved", "bidding"];
  if (status === "active") return ["in_progress", "active", "open"];
  if (status === "paused") return ["paused"];
  return ["completed", "complete"];
}

export async function GET(request: Request) {
  try {
    try {
      await requireModuleAccess("jobs", "view");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const parsedQuery = listQuerySchema.safeParse({
      status: url.searchParams.get("status") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      cursor: url.searchParams.get("cursor"),
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });

    if (!parsedQuery.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 422 });
    }

    const queryInput = parsedQuery.data;
    const limit = queryInput.pageSize ?? queryInput.limit;
    const offset =
      queryInput.page !== undefined
        ? (queryInput.page - 1) * limit
        : queryInput.cursor
          ? Math.max(0, Number.parseInt(queryInput.cursor, 10) || 0)
          : 0;

    const { supabase, companyId, userId } = await getCompanyId();
    const membershipRole = await resolveMembershipRole(supabase, companyId, userId);
    const effectiveRole = await getEffectiveRole();
    const role = effectiveRole ?? membershipRole;

    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const canViewFinancials = await canAccessJobFinancials(supabase, companyId, userId, role);

    const scopedJobIds = await getEffectiveScopedJobIds(supabase, companyId, userId, role);
    if (scopedJobIds && scopedJobIds.length === 0) {
      return NextResponse.json({ items: [], jobs: [], nextCursor: null, page: 1, pageSize: limit, total: 0 });
    }

    let query = supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    let countQuery = supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);

    const statusFilters = resolveStatusFilters(queryInput.status);
    if (statusFilters) {
      query = query.in("status", statusFilters);
      countQuery = countQuery.in("status", statusFilters);
    }

    if (scopedJobIds) {
      query = query.in("id", scopedJobIds);
      countQuery = countQuery.in("id", scopedJobIds);
    }

    if (queryInput.q) {
      const escaped = queryInput.q.replace(/[%_]/g, "");
      query = query.or(`name.ilike.%${escaped}%,site_address.ilike.%${escaped}%,client.ilike.%${escaped}%`);
      countQuery = countQuery.or(`name.ilike.%${escaped}%,site_address.ilike.%${escaped}%,client.ilike.%${escaped}%`);
    }

    const [{ error: countError, count: totalCount }, listResult] = await Promise.all([
      countQuery,
      query.range(offset, offset + limit),
    ]);

    if (countError && !isMissingSchemaError(countError.message)) {
      return NextResponse.json({ error: countError.message }, { status: 400 });
    }

    let { data, error } = listResult;
    if (error && isMissingSchemaError(error.message)) {
      let fallbackQuery = supabase
        .from("jobs")
        .select("*")
        .eq("company_id", companyId)
        .order("id", { ascending: false });

      if (statusFilters) {
        fallbackQuery = fallbackQuery.in("status", statusFilters);
      }
      if (scopedJobIds) {
        fallbackQuery = fallbackQuery.in("id", scopedJobIds);
      }
      if (queryInput.q) {
        const escaped = queryInput.q.replace(/[%_]/g, "");
        fallbackQuery = fallbackQuery.or(`name.ilike.%${escaped}%,site_address.ilike.%${escaped}%,client.ilike.%${escaped}%`);
      }

      const fallbackResult = await fallbackQuery.range(offset, offset + limit);
      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const rows = data ?? [];
    const hasMore = rows.length > limit;
    const trimmedRows = hasMore ? rows.slice(0, limit) : rows;
    const jobs = trimmedRows.map((row) => redactJobFinancials(mapJob(row), canViewFinancials));
    const jobIds = jobs.map((job) => String(job.id));
    const countsByJobId = await getJobAssignmentCounts(supabase, companyId, jobIds);
    const jobsWithCounts = jobs.map((job) => {
      const counts = countsByJobId.get(String(job.id)) ?? { crew: 0, equipment: 0 };
      return {
        ...job,
        crew_assigned_count: counts.crew,
        equipment_assigned_count: counts.equipment,
      };
    });
    const nextCursor = hasMore ? String(offset + limit) : null;

    const total = typeof totalCount === "number" ? totalCount : jobsWithCounts.length + offset;
    const page = Math.floor(offset / limit) + 1;
    // Keep both keys for existing Jobs/Schedule/Map consumers while they migrate to `items`.
    return NextResponse.json({ items: jobsWithCounts, jobs: jobsWithCounts, nextCursor, page, pageSize: limit, total });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    try {
      await requireModuleAccess("jobs", "edit");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = createJobSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid job payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;
    const { data: userData } = await supabase.auth.getUser();
    const membershipRole = await resolveMembershipRole(supabase, companyId, userId);
    const effectiveRole = await getEffectiveRole();
    const role = effectiveRole ?? membershipRole;
    const canViewFinancials = await canAccessJobFinancials(supabase, companyId, userId, role);

    const name = normalizeText(payload.name) || normalizeText(payload.title);
    if (!name) {
      return NextResponse.json({ error: "Invalid job payload", details: { fieldErrors: { name: ["Required"] } } }, { status: 400 });
    }

    const client = normalizeText(payload.client) || normalizeText(payload.client_name);
    const siteAddress = normalizeText(payload.site_address) || normalizeText(payload.address);
    const startDate = normalizeOptionalDate(payload.start_date, payload.startDate);
    const targetEndDate = normalizeOptionalDate(
      payload.target_end_date,
      payload.targetEndDate,
      payload.end_date,
      payload.endDate
    );
    const notes = normalizeText(payload.notes) || normalizeText(payload.description);
    const budget = normalizeBudget(payload.budget);

    const encodedNotes = buildJobNotes(notes, {
      client,
      start_date: startDate,
      target_end_date: targetEndDate,
    });

    const location = await resolveJobLocation({
      address: siteAddress,
      lat: payload.lat,
      lng: payload.lng,
      place_id: payload.place_id,
      address_verified: payload.address_verified,
    });

    const baseInsertPayload = {
      company_id: companyId,
      created_by: userData?.user?.id ?? null,
      name,
      client,
      client_name: client,
      site_address: siteAddress,
      start_date: startDate || null,
      target_end_date: targetEndDate || null,
      notes: encodedNotes,
      lat: location.lat,
      lng: location.lng,
      place_id: location.place_id,
      address_verified: location.address_verified,
      ...(canViewFinancials && budget !== null ? { budget } : {}),
    };

    const insertPayload = {
      ...baseInsertPayload,
      ...(payload.status ? { status: payload.status } : {}),
    };

    let result = await insertJobWithSchemaFallback(supabase, insertPayload);

    if (
      result.error?.message?.includes('jobs_status_check') &&
      payload.status
    ) {
      result = await insertJobWithSchemaFallback(supabase, baseInsertPayload);
    }

    const { data, error } = result;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const job = redactJobFinancials(mapJob(data), canViewFinancials);
    await logAuditEvent({
      supabase,
      companyId,
      actorUserId: userId,
      eventType: "job.created",
      entityType: "job",
      entityId: job.id,
      after: job,
    });

    return NextResponse.json({ job });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
