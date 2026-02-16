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

const updateJobSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: jobStatusSchema.optional(),
    site_address: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
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

const normalizeId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    const { supabase, companyId } = await getCompanyId();
    const updatesBody = parsed.data;

    const updatePayload: Record<string, unknown> = {};
    if (updatesBody.name !== undefined) updatePayload.name = updatesBody.name;
    if (updatesBody.status !== undefined) updatePayload.status = updatesBody.status;
    if (updatesBody.site_address !== undefined) updatePayload.site_address = updatesBody.site_address;
    if (updatesBody.notes !== undefined) updatePayload.notes = updatesBody.notes;

    const { data, error } = await supabase
      .from("jobs")
      .update(updatePayload)
      .eq("company_id", companyId)
      .eq("id", normalizeId(id))
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ job: mapJob(data) });
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
    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();

    const { error } = await supabase
      .from("jobs")
      .delete()
      .eq("company_id", companyId)
      .eq("id", normalizeId(id));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
