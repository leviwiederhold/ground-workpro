import { NextResponse } from "next/server";
import { getPlatformAdmin, PlatformAdminError } from "@/lib/auth/platformAdmin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ADMIN_OVERRIDE_SELECT_COLUMNS, mapCompanyOverride } from "@/lib/billing/adminOverrideMap";

export const dynamic = "force-dynamic";

// GET /api/admin/billing-overrides?q=...  — platform-admin only.
// Lists/searches companies with their current Stripe status + billing override
// (including the internal reason, which is admin-only).
export async function GET(request: Request) {
  try {
    await getPlatformAdmin();
  } catch (error) {
    const status = error instanceof PlatformAdminError ? error.status : 403;
    return NextResponse.json({ error: status === 401 ? "Not authenticated" : "Forbidden" }, { status });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin client unavailable" }, { status: 500 });
  }

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") ?? "").trim();

  let query = admin
    .from("companies")
    .select(ADMIN_OVERRIDE_SELECT_COLUMNS)
    .order("name", { ascending: true })
    .limit(50);

  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const result = await query;
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 400 });
  }

  const items = (result.data ?? []).map((row) => mapCompanyOverride(row));
  return NextResponse.json({ items });
}
