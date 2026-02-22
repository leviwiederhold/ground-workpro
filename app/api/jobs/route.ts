/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
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

const createJobSchema = z.object({
  name: z.string().min(1),
  status: jobStatusSchema.default("draft").optional(),
  site_address: z.string().default("").optional(),
  notes: z.string().default("").optional(),
});

const mapJob = (row: any) => ({
  id: row.id,
  name: row.name ?? "",
  client: row.client ?? "",
  status: row.status ?? "draft",
  address: row.site_address ?? row.address ?? "",
  site_address: row.site_address ?? row.address ?? "",
  notes: row.notes ?? "",
  budget: Number(row.budget ?? 0),
  spent: Number(row.spent ?? 0),
  startDate: row.startDate ?? row.start_date ?? "",
  endDate: row.endDate ?? row.end_date ?? "",
  progress: Number(row.progress ?? 0),
  lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
  lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
});

export async function GET(request: Request) {
  try {
    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await resolveMembershipRole(supabase, companyId, userId);

    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const scopedJobIds = await getRoleScopedJobIds(supabase, companyId, userId, role);
    if (scopedJobIds && scopedJobIds.length === 0) {
      const pagination = getPaginationMeta(0, page, pageSize);
      return NextResponse.json({ jobs: [], items: [], ...pagination });
    }

    let query = supabase
      .from("jobs")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (scopedJobIds) {
      query = query.in("id", scopedJobIds);
    }

    const { data, error, count } = await query.range(from, to);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const jobs = (data ?? []).map(mapJob);
    return NextResponse.json({ jobs, items: jobs, ...getPaginationMeta(count ?? jobs.length, page, pageSize) });
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
