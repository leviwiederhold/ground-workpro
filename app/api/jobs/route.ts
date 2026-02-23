/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { logAuditEvent } from "@/lib/audit/logAuditEvent";
import { getRoleScopedJobIds, resolveMembershipRole } from "@/lib/jobs/roleScope";

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
  name: z.string().min(1),
  status: persistedJobStatusSchema.default("draft").optional(),
  site_address: z.string().default("").optional(),
  notes: z.string().default("").optional(),
});

const mapJob = (row: any) => ({
  id: row.id,
  name: row.name ?? "",
  client: row.client ?? "",
  status: row.status ?? "draft",
  siteAddress: row.siteAddress ?? row.site_address ?? row.address ?? "",
  address: row.site_address ?? row.address ?? "",
  site_address: row.site_address ?? row.address ?? "",
  notes: row.notes ?? "",
  budget: Number(row.budget ?? 0),
  spent: Number(row.spent ?? 0),
  startDate: row.startDate ?? row.start_date ?? "",
  targetEndDate: row.targetEndDate ?? row.target_end_date ?? row.endDate ?? row.end_date ?? "",
  endDate: row.endDate ?? row.end_date ?? row.target_end_date ?? "",
  progress: Number(row.progress ?? 0),
  lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
  lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
});

const isMissingSchemaError = (message: string | undefined) =>
  /(column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table)/i.test(
    message ?? ""
  );

function resolveStatusFilters(status: ListStatus): string[] | null {
  if (status === "all") return null;
  if (status === "bidding") return ["draft", "sent", "approved", "bidding"];
  if (status === "active") return ["in_progress", "active", "open"];
  if (status === "paused") return ["paused"];
  return ["completed", "complete"];
}

export async function GET(request: Request) {
  try {
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
    const role = await resolveMembershipRole(supabase, companyId, userId);

    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (role === "operator" || role === "mechanic") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scopedJobIds = await getRoleScopedJobIds(supabase, companyId, userId, role);
    if (scopedJobIds && scopedJobIds.length === 0) {
      return NextResponse.json({ items: [], jobs: [], nextCursor: null });
    }

    let query = supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (scopedJobIds) {
      query = query.in("id", scopedJobIds);
    }

    const statusFilters = resolveStatusFilters(queryInput.status);
    if (statusFilters) {
      query = query.in("status", statusFilters);
    }

    if (queryInput.q) {
      const escaped = queryInput.q.replace(/[%_]/g, "");
      query = query.or(`name.ilike.%${escaped}%,site_address.ilike.%${escaped}%,client.ilike.%${escaped}%`);
    }

    let { data, error } = await query.range(offset, offset + limit);
    if (error && isMissingSchemaError(error.message)) {
      let fallbackQuery = supabase
        .from("jobs")
        .select("*")
        .eq("company_id", companyId)
        .order("id", { ascending: false });

      if (scopedJobIds) {
        fallbackQuery = fallbackQuery.in("id", scopedJobIds);
      }
      if (statusFilters) {
        fallbackQuery = fallbackQuery.in("status", statusFilters);
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
    const jobs = trimmedRows.map(mapJob);
    const nextCursor = hasMore ? String(offset + limit) : null;

    return NextResponse.json({ items: jobs, jobs, nextCursor });
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
      await requireRole(["admin", "pm"]);
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

    const baseInsertPayload = {
      company_id: companyId,
      created_by: userData?.user?.id ?? null,
      name: payload.name,
      site_address: payload.site_address ?? "",
      notes: payload.notes ?? "",
    };

    let result = await supabase
      .from("jobs")
      .insert({
        ...baseInsertPayload,
        ...(payload.status ? { status: payload.status } : {}),
      })
      .select("*")
      .single();

    if (
      result.error?.message?.includes('jobs_status_check') &&
      payload.status
    ) {
      result = await supabase
        .from("jobs")
        .insert(baseInsertPayload)
        .select("*")
        .single();
    }

    const { data, error } = result;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const job = mapJob(data);
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
