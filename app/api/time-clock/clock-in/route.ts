import { NextResponse } from "next/server";
import { autoCloseStaleTimeEntries } from "@/src/lib/time-clock/autoClose";
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
    if (activeShiftResult.data?.id) {
      return NextResponse.json(
        {
          error: "You are already clocked in.",
          item: { activeShiftStartAt: activeShiftResult.data.clock_in_at },
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const insertResult = await supabase
      .from("time_entries")
      .insert({
        company_id: companyId,
        user_id: userId,
        clock_in_at: nowIso,
      })
      .select("id, clock_in_at")
      .single();

    if (insertResult.error) {
      if (/uq_time_entries_active_shift_per_user|duplicate key|unique/i.test(insertResult.error.message || "")) {
        return NextResponse.json({ error: "You are already clocked in." }, { status: 409 });
      }
      return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    }

    return NextResponse.json({
      item: {
        id: insertResult.data.id,
        status: "clocked_in",
        activeShiftStartAt: insertResult.data.clock_in_at,
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
