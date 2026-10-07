import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({ confirmation: z.literal("DELETE") });
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

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

  // The company row is now the authoritative ownership record. Mirror the
  // database deletion trigger so users get an actionable response rather than
  // Supabase Auth's generic database error.
  const companies = await admin
    .from("companies")
    .select("id, name, subscription_status")
    .eq("primary_owner_user_id", user.id)
    .limit(1);
  if (companies.error) {
    return NextResponse.json({ error: companies.error.message }, { status: 400 });
  }

  const ownedCompany = companies.data?.[0];
  if (ownedCompany) {
    const hasActiveSubscription = ACTIVE_SUBSCRIPTION_STATUSES.has(
      String(ownedCompany.subscription_status ?? "").toLowerCase(),
    );
    return NextResponse.json(
      {
        error: hasActiveSubscription
          ? `Cancel the active subscription and transfer ownership of ${String(ownedCompany.name ?? "your company")} before deleting this account.`
          : `Transfer ownership of ${String(ownedCompany.name ?? "your company")} before deleting this account.`,
        code: "primary_company_owner",
      },
      { status: 409 },
    );
  }

  const deletion = await admin.auth.admin.deleteUser(user.id, false);
  if (deletion.error) {
    return NextResponse.json({ error: deletion.error.message || "Account deletion failed." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
