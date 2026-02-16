/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

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

export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ jobs: (data ?? []).map(mapJob) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
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

    const { supabase, companyId } = await getCompanyId();
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

    return NextResponse.json({ job: mapJob(data) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
