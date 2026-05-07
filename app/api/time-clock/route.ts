import { NextResponse } from "next/server";
import { autoCloseStaleTimeEntries } from "@/src/lib/time-clock/autoClose";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import {
  calculateWindowHours,
  startOfUtcDay,
  startOfUtcWeek,
  type TimeEntryRow,
} from "@/lib/time-clock/hours";

function findActiveEntry<T extends { clock_out_at: string | null }>(rows: T[]) {
  return rows.find((row) => row.clock_out_at === null) ?? null;
}

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const now = new Date();
    const dayStart = startOfUtcDay(now);
    const weekStart = startOfUtcWeek(now);
    const queryStart = new Date(weekStart.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const weekStartIso = weekStart.toISOString();

    await autoCloseStaleTimeEntries({ supabase, companyId, userId });

    const entriesResult = await supabase
      .from("time_entries")
      .select("id, company_id, user_id, clock_in_at, clock_out_at, created_at")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .or(`clock_out_at.gte.${weekStartIso},clock_out_at.is.null,clock_in_at.gte.${queryStart}`)
      .order("clock_in_at", { ascending: false });

    if (entriesResult.error) {
      return NextResponse.json({ error: entriesResult.error.message }, { status: 400 });
    }

    const rows = (entriesResult.data ?? []) as Array<{
      id: string;
      company_id: string;
      user_id: string;
      clock_in_at: string;
      clock_out_at: string | null;
      created_at: string;
    }>;

    const activeEntry = findActiveEntry(rows);
    const hourRows: TimeEntryRow[] = rows.map((row) => ({
      clock_in_at: row.clock_in_at,
      clock_out_at: row.clock_out_at,
    }));

    const todayHours = calculateWindowHours({
      entries: hourRows,
      rangeStart: dayStart,
      rangeEnd: now,
      now,
    });
    const weekHours = calculateWindowHours({
      entries: hourRows,
      rangeStart: weekStart,
      rangeEnd: now,
      now,
    });

    return NextResponse.json({
      item: {
        status: activeEntry ? "clocked_in" : "clocked_out",
        activeShiftStartAt: activeEntry?.clock_in_at ?? null,
        todayHours,
        weekHours,
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
