import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_AUTO_CLOSE_HOURS = Number(process.env.TIME_CLOCK_AUTO_CLOSE_HOURS || 12);

export function calculateDurationMinutes(clockInAt: string, clockOutAt: string) {
  const start = new Date(clockInAt).getTime();
  const end = new Date(clockOutAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

export async function autoCloseStaleTimeEntries({ supabase, companyId, userId }: { supabase: SupabaseClient; companyId: string; userId?: string; }) {
  const now = Date.now();
  const maxMs = Math.max(1, DEFAULT_AUTO_CLOSE_HOURS) * 60 * 60 * 1000;
  const thresholdIso = new Date(now - maxMs).toISOString();
  let query = supabase.from("time_entries").select("id, clock_in_at").eq("company_id", companyId).is("clock_out_at", null).lte("clock_in_at", thresholdIso);
  if (userId) query = query.eq("user_id", userId);
  const stale = await query.limit(200);
  if (stale.error || !stale.data?.length) return;
  for (const row of stale.data as Array<{id:string;clock_in_at:string}>) {
    const clockOutAt = new Date(new Date(row.clock_in_at).getTime() + maxMs).toISOString();
    await supabase.from("time_entries").update({ clock_out_at: clockOutAt, duration_minutes: calculateDurationMinutes(row.clock_in_at, clockOutAt), status: "auto_closed" }).eq("id", row.id).is("clock_out_at", null);
  }
}
