import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { autoCloseStaleTimeEntries } from "@/src/lib/time-clock/autoClose";
import { z } from "zod";

const PAYROLL_ALLOWED = ["admin", "pm"] as const;
const EDIT_ALLOWED = ["admin", "pm"] as const;
const rangeSchema = z.enum(["today", "week", "month", "custom"]).default("week");

export async function GET(request: Request) {
  try {
    await requireRole([...PAYROLL_ALLOWED]);
    const { supabase, companyId } = await getCompanyId();
    await autoCloseStaleTimeEntries({ supabase, companyId });
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

    const employeesRes = await supabase.from("employees").select("id,user_id,name,hourly_rate,role").eq("company_id", companyId);
    if (employeesRes.error) return NextResponse.json({ error: employeesRes.error.message }, { status: 400 });
    const employees = employeesRes.data ?? [];
    type Employee = { user_id: string | null; name: string | null; hourly_rate: number | null };
    const byUser = new Map((employees as Employee[]).map((e)=>[String(e.user_id||""),e]));

    const q = supabase.from("time_entries").select("id,user_id,clock_in_at,clock_out_at,duration_minutes,status,notes,edited_by,edited_at").eq("company_id", companyId).gte("clock_in_at", start.toISOString()).lte("clock_in_at", end.toISOString()).order("clock_in_at", {ascending:false});
    const entriesRes = await q;
    if (entriesRes.error) return NextResponse.json({ error: entriesRes.error.message }, { status: 400 });
    const rows = entriesRes.data ?? [];
    const summary = new Map<string,{name:string;hours:number;hourlyRate:number;estimatedPay:number}>();
    let total = 0;
    for (const r of rows as Array<{ user_id: string | null; duration_minutes: number | null; clock_in_at: string; clock_out_at: string | null }>) {
      const emp = byUser.get(String(r.user_id||""));
      const name = String(emp?.name || "Unknown");
      const rate = Number(emp?.hourly_rate || 0);
      const mins = Number(r.duration_minutes || (r.clock_out_at ? Math.max(0,Math.round((new Date(r.clock_out_at).getTime()-new Date(r.clock_in_at).getTime())/60000)) : 0));
      const hours = mins/60;
      const prev = summary.get(String(r.user_id||"")) || {name,hours:0,hourlyRate:rate,estimatedPay:0};
      prev.hours += hours; prev.estimatedPay += hours*rate; prev.hourlyRate = rate; summary.set(String(r.user_id||""), prev);
      total += hours*rate;
    }
    const activeEmployees = rows.filter((row: { clock_out_at: string | null }) => row.clock_out_at === null).length;
    const autoClosedEntries = rows.filter((row: { status?: string | null }) => String(row.status || "") === "auto_closed").length;
    return NextResponse.json({ item: { range, startAt: start.toISOString(), endAt: end.toISOString(), totalEstimatedPayroll: total, activeEmployees, autoClosedEntries, employees: Array.from(summary.values()), entries: rows } });
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
    const payload = patchSchema.parse(await request.json());
    const existing = await supabase.from("time_entries").select("id,clock_in_at,clock_out_at").eq("company_id", companyId).eq("id", payload.id).maybeSingle();
    if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 400 });
    if (!existing.data) return NextResponse.json({ error: "Time entry not found" }, { status: 404 });
    const clockInAt = payload.clockInAt ?? existing.data.clock_in_at;
    const clockOutAt = payload.clockOutAt === undefined ? existing.data.clock_out_at : payload.clockOutAt;
    const durationMinutes = clockOutAt ? Math.max(0, Math.round((new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / 60000)) : null;
    const update = await supabase
      .from("time_entries")
      .update({ clock_in_at: clockInAt, clock_out_at: clockOutAt, duration_minutes: durationMinutes, notes: payload.notes, status: "edited", edited_by: userId, edited_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", payload.id)
      .select("id,clock_in_at,clock_out_at,duration_minutes,status,notes,edited_by,edited_at")
      .single();
    if (update.error) return NextResponse.json({ error: update.error.message }, { status: 400 });
    return NextResponse.json({ item: update.data });
  } catch (error) {
    if (error instanceof TenantResolverError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Validation error", details: error.issues }, { status: 422 });
    if (error instanceof Error && "status" in error && (error as Error & {status?:number}).status === 403) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
