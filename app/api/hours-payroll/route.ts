import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { autoCloseStaleTimeEntries } from "@/src/lib/time-clock/autoClose";

const ALLOWED = ["admin", "pm", "foreman", "mechanic", "operator"] as const;

export async function GET(request: Request) {
  try {
    const { role, userId } = await requireRole([...ALLOWED]);
    const { supabase, companyId } = await getCompanyId();
    await autoCloseStaleTimeEntries({ supabase, companyId });
    const url = new URL(request.url);
    const range = String(url.searchParams.get("range") || "week");
    const now = new Date();
    const start = new Date(now);
    if (range === "today") start.setUTCHours(0,0,0,0);
    else if (range === "month") { start.setUTCDate(1); start.setUTCHours(0,0,0,0); }
    else { start.setUTCDate(start.getUTCDate()-7); start.setUTCHours(0,0,0,0); }

    const employeesRes = await supabase.from("employees").select("id,user_id,name,hourly_rate,role").eq("company_id", companyId);
    if (employeesRes.error) return NextResponse.json({ error: employeesRes.error.message }, { status: 400 });
    const employees = employeesRes.data ?? [];
    type Employee = { user_id: string | null; name: string | null; hourly_rate: number | null };
    const byUser = new Map((employees as Employee[]).map((e)=>[String(e.user_id||""),e]));

    let q = supabase.from("time_entries").select("id,user_id,clock_in_at,clock_out_at,duration_minutes,status").eq("company_id", companyId).gte("clock_in_at", start.toISOString()).order("clock_in_at", {ascending:false});
    if (!(role === "admin" || role === "pm")) q = q.eq("user_id", userId);
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
    return NextResponse.json({ item: { range, totalEstimatedPayroll: total, employees: Array.from(summary.values()), entries: rows } });
  } catch (error) {
    if (error instanceof TenantResolverError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && "status" in error && (error as Error & {status?:number}).status === 403) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
