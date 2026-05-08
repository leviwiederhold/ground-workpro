import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { autoCloseStaleTimeEntries } from "@/src/lib/time-clock/autoClose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";

const PAYROLL_ALLOWED = ["admin", "pm"] as const;
const EDIT_ALLOWED = ["admin", "pm"] as const;
const rangeSchema = z.enum(["today", "week", "month", "custom"]).default("week");
type QueryRowsResponse = {
  data: unknown[] | null;
  error: { message?: string } | null;
};

export async function GET(request: Request) {
  try {
    await requireRole([...PAYROLL_ALLOWED]);
    const { supabase, companyId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;
    await autoCloseStaleTimeEntries({ supabase: db, companyId });
    const url = new URL(request.url);
    const range = rangeSchema.parse(String(url.searchParams.get("range") || "week"));
    const startParam = url.searchParams.get("start");
    const endParam = url.searchParams.get("end");
    const now = new Date();
    const start = new Date(now);
    if (range === "today") start.setUTCHours(0,0,0,0);
    else if (range === "month") { start.setUTCDate(1); start.setUTCHours(0,0,0,0); }
    else if (range === "custom" && startParam && endParam) {
      start.setTime(new Date(startParam).getTime());
      start.setUTCHours(0, 0, 0, 0);
    }
    else { start.setUTCDate(start.getUTCDate()-7); start.setUTCHours(0,0,0,0); }
    const end = range === "custom" && endParam ? new Date(endParam) : now;
    if (range === "custom") end.setUTCHours(23, 59, 59, 999);

    let employeesRes = await db.from("employees").select("id,user_id,name,full_name,email,hourly_rate,hourlyRate,pay_rate,rate,role").eq("company_id", companyId) as QueryRowsResponse;
    if (employeesRes.error && /schema cache|column|hourlyRate|pay_rate|rate/i.test(employeesRes.error.message || "")) {
      employeesRes = await db.from("employees").select("id,user_id,name,full_name,email,hourly_rate,role").eq("company_id", companyId) as QueryRowsResponse;
    }
    if (employeesRes.error && /schema cache|column|name|email/i.test(employeesRes.error.message || "")) {
      employeesRes = await db.from("employees").select("id,user_id,full_name,hourly_rate,role").eq("company_id", companyId) as QueryRowsResponse;
    }
    if (employeesRes.error && /schema cache|column|full_name|hourly_rate/i.test(employeesRes.error.message || "")) {
      employeesRes = await db.from("employees").select("id,user_id").eq("company_id", companyId) as QueryRowsResponse;
    }
    if (employeesRes.error) return NextResponse.json({ error: employeesRes.error.message }, { status: 400 });
    const employees = employeesRes.data ?? [];
    type Employee = {
      user_id: string | null;
      name?: string | null;
      full_name?: string | null;
      email?: string | null;
      hourly_rate?: number | null;
      hourlyRate?: number | null;
      pay_rate?: number | null;
      rate?: number | null;
    };
    const byUser = new Map((employees as Employee[]).map((e)=>[String(e.user_id||""),e]));

    let entriesRes = await db
      .from("time_entries")
      .select("id,user_id,clock_in_at,clock_out_at,duration_minutes,status,notes,edited_by,edited_at")
      .eq("company_id", companyId)
      .lte("clock_in_at", end.toISOString())
      .or(`clock_out_at.gte.${start.toISOString()},clock_out_at.is.null,clock_in_at.gte.${start.toISOString()}`)
      .order("clock_in_at", {ascending:false}) as QueryRowsResponse;
    if (entriesRes.error && /duration_minutes|status|notes|edited_by|edited_at|schema cache|column/i.test(entriesRes.error.message || "")) {
      entriesRes = await db
        .from("time_entries")
        .select("id,user_id,clock_in_at,clock_out_at")
        .eq("company_id", companyId)
        .lte("clock_in_at", end.toISOString())
        .or(`clock_out_at.gte.${start.toISOString()},clock_out_at.is.null,clock_in_at.gte.${start.toISOString()}`)
        .order("clock_in_at", {ascending:false}) as QueryRowsResponse;
    }
    if (entriesRes.error) return NextResponse.json({ error: entriesRes.error.message }, { status: 400 });
    type TimeEntryForPayroll = {
      user_id: string | null;
      duration_minutes?: number | null;
      clock_in_at: string;
      clock_out_at: string | null;
      status?: string | null;
    };
    const rows = (entriesRes.data ?? []) as TimeEntryForPayroll[];
    const summary = new Map<string,{userId:string;name:string;hours:number;hourlyRate:number;estimatedPay:number}>();
    let total = 0;
    for (const r of rows) {
      const emp = byUser.get(String(r.user_id||""));
      const userId = String(r.user_id || "");
      const name = String(emp?.name || emp?.full_name || emp?.email || "Unknown");
      const rate = Number(emp?.hourly_rate ?? emp?.hourlyRate ?? emp?.pay_rate ?? emp?.rate ?? 0);
      const entryStartMs = Math.max(new Date(r.clock_in_at).getTime(), start.getTime());
      const entryEndMs = Math.min(
        r.clock_out_at ? new Date(r.clock_out_at).getTime() : now.getTime(),
        end.getTime()
      );
      const calculatedMinutes = Math.max(0, Math.round((entryEndMs - entryStartMs) / 60000));
      const mins = Number(r.duration_minutes && r.clock_out_at ? r.duration_minutes : calculatedMinutes);
      const hours = mins/60;
      const prev = summary.get(userId) || {userId,name,hours:0,hourlyRate:rate,estimatedPay:0};
      prev.hours += hours; prev.estimatedPay += hours*rate; prev.hourlyRate = rate; summary.set(userId, prev);
      total += hours*rate;
    }
    const activeEmployees = rows.filter((row: { clock_out_at: string | null }) => row.clock_out_at === null).length;
    const autoClosedEntries = rows.filter((row: { status?: string | null }) => String(row.status || "") === "auto_closed").length;
    const employeeSummaries = Array.from(summary.values()).map((item) => ({
      ...item,
      hours: Number(item.hours.toFixed(2)),
      estimatedPay: Number(item.estimatedPay.toFixed(2)),
    }));
    return NextResponse.json({ item: { range, startAt: start.toISOString(), endAt: end.toISOString(), totalEstimatedPayroll: Number(total.toFixed(2)), activeEmployees, autoClosedEntries, employees: employeeSummaries, entries: rows } });
  } catch (error) {
    if (error instanceof TenantResolverError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && "status" in error && (error as Error & {status?:number}).status === 403) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  clockInAt: z.string().datetime().optional(),
  clockOutAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(1000).optional(),
});

export async function PATCH(request: Request) {
  try {
    const { userId } = await requireRole([...EDIT_ALLOWED]);
    const { supabase, companyId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;
    const payload = patchSchema.parse(await request.json());
    const existing = await db.from("time_entries").select("id,clock_in_at,clock_out_at").eq("company_id", companyId).eq("id", payload.id).maybeSingle();
    if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 400 });
    if (!existing.data) return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
    const clockInAt = payload.clockInAt ?? existing.data.clock_in_at;
    const clockOutAt = payload.clockOutAt === undefined ? existing.data.clock_out_at : payload.clockOutAt;
    const durationMinutes = clockOutAt ? Math.max(0, Math.round((new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 60000)) : null;
    let update = await db
      .from("time_entries")
      .update({ clock_in_at: clockInAt, clock_out_at: clockOutAt, duration_minutes: durationMinutes, notes: payload.notes, status: "edited", edited_by: userId, edited_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", payload.id)
      .select("id,clock_in_at,clock_out_at,duration_minutes,status,notes,edited_by,edited_at")
      .single();
    if (update.error && /duration_minutes|status|notes|edited_by|edited_at|schema cache|column/i.test(update.error.message || "")) {
      update = await db
        .from("time_entries")
        .update({ clock_in_at: clockInAt, clock_out_at: clockOutAt })
        .eq("company_id", companyId)
        .eq("id", payload.id)
        .select("id,clock_in_at,clock_out_at")
        .single();
    }
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 400 });
    return NextResponse.json({ item: update.data });
  } catch (error) {
    if (error instanceof TenantResolverError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Validation error", details: error.issues }, { status: 422 });
    if (error instanceof Error && "status" in error && (error as Error & {status?:number}).status === 403) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
