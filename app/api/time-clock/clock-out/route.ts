import { NextResponse } from "next/server";
import { autoCloseStaleTimeEntries, calculateDurationMinutes } from "@/src/lib/time-clock/autoClose";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();

    await autoCloseStaleTimeEntries({ supabase, companyId, userId });

    let activeShiftResult = await supabase
      .from("time_entries")
      .select("id, clock_in_at")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .is("clock_out_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (
      activeShiftResult.error &&
      /created_at|Could not find the 'created_at' column/i.test(activeShiftResult.error.message || "")
    ) {
      activeShiftResult = await supabase
        .from("time_entries")
        .select("id, clock_in_at")
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .is("clock_out_at", null)
        .order("clock_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    }

    if (activeShiftResult.error) {
      return NextResponse.json({ error: activeShiftResult.error.message }, { status: 400 });
    }
    if (!activeShiftResult.data?.id) {
      return NextResponse.json({ error: "You are not currently clocked in." }, { status: 409 });
    }

    const clockOutAt = new Date().toISOString();
    const updateResult = await supabase
      .from("time_entries")
      .update({ clock_out_at: clockOutAt, duration_minutes: calculateDurationMinutes(activeShiftResult.data.clock_in_at, clockOutAt), status: "completed" })
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("id", activeShiftResult.data.id)
      .is("clock_out_at", null)
      .select("id, clock_in_at, clock_out_at")
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    }
    if (!updateResult.data?.id) {
      return NextResponse.json({ error: "You are not currently clocked in." }, { status: 409 });
    }

    return NextResponse.json({
      item: {
        id: updateResult.data.id,
        status: "clocked_out",
        clockInAt: updateResult.data.clock_in_at,
        clockOutAt: updateResult.data.clock_out_at,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
