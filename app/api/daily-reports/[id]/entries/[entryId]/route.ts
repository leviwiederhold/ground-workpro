import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const normalizeId = (id: unknown): string | number | null => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  if (typeof id === "string") return id;
  return String(id);
};

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id, entryId } = await params;
    const { supabase, companyId } = await getCompanyId();
    const reportId = normalizeId(id);
    const normalizedEntryId = normalizeId(entryId);
    if (reportId === null || normalizedEntryId === null) {
      return NextResponse.json({ error: "Invalid report or entry id" }, { status: 400 });
    }

    let result = await supabase
      .from("daily_report_entries")
      .delete()
      .eq("company_id", companyId)
      .eq("daily_report_id", reportId)
      .eq("id", normalizedEntryId)
      .select("id");

    if (result.error?.message?.toLowerCase().includes("daily_report_id")) {
      result = await supabase
        .from("daily_report_entries")
        .delete()
        .eq("company_id", companyId)
        .eq("report_id", reportId)
        .eq("id", normalizedEntryId)
        .select("id");
    }

    const { data, error } = result;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
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
