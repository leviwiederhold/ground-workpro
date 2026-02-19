/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const normalizeId = (id: unknown): string | number | null => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  if (typeof id === "string") return id;
  return String(id);
};

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; equipmentId: string }> }
) {
  try {
    const { id, equipmentId } = await params;
    const { supabase, companyId } = await getCompanyId();
    const jobId = normalizeId(id);
    const normalizedEquipmentId = normalizeId(equipmentId);
    if (jobId === null || normalizedEquipmentId === null) {
      return NextResponse.json({ error: "Invalid job or equipment id" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("job_equipment")
      .delete()
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .eq("equipment_id", normalizedEquipmentId)
      .select("equipment_id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
