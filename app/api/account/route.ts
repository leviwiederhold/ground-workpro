import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({ confirmation: z.literal("DELETE") });
const OWNER_ROLES = ["admin", "ceo", "executive", "owner"];
const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"];

export async function DELETE(request: Request) {
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Type DELETE to confirm account deletion." }, { status: 422 });
  }

  const supabase = await supabaseServer();
  const authResult = await supabase.auth.getUser();
  const user = authResult.data.user;
  if (authResult.error || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Account deletion is temporarily unavailable." }, { status: 503 });
  }

  // Mirror the database owner guard so the user receives a useful explanation
  // instead of Supabase Auth's generic "Database error deleting user" response.
  const memberships = await admin
    .from("memberships")
    .select("company_id, role")
    .eq("user_id", user.id);
  if (memberships.error) {
    return NextResponse.json({ error: memberships.error.message }, { status: 400 });
  }

  const ownedCompanyIds = (memberships.data ?? [])
    .filter((row) => OWNER_ROLES.includes(String(row.role ?? "").toLowerCase()))
    .map((row) => String(row.company_id ?? ""))
    .filter(Boolean);
  if (ownedCompanyIds.length > 0) {
    const companies = await admin
      .from("companies")
      .select("id, name, subscription_status")
      .in("id", ownedCompanyIds)
      .in("subscription_status", ACTIVE_SUBSCRIPTION_STATUSES)
      .limit(1);
    if (companies.error) {
      return NextResponse.json({ error: companies.error.message }, { status: 400 });
    }
    const activeCompany = companies.data?.[0];
    if (activeCompany) {
      return NextResponse.json(
        {
          error:
            `Transfer ownership or end the active subscription for ${String(activeCompany.name ?? "your company")} before deleting this account.`,
          code: "active_company_owner",
        },
        { status: 409 },
      );
    }
  }

  const deletion = await admin.auth.admin.deleteUser(user.id, false);
  if (deletion.error) {
    return NextResponse.json({ error: deletion.error.message || "Account deletion failed." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
