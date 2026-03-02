import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const bodySchema = z.object({
  role: z.string().optional(),
  email: z.string().email().optional(),
  employeeId: z.string().uuid().optional(),
  token: z.string().min(20).optional(),
});

const normalizeRole = (value: unknown): "admin" | "pm" | "foreman" | "mechanic" | "operator" => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.includes("admin") || raw.includes("executive") || raw.includes("ceo")) return "admin";
  if (raw === "pm" || raw.includes("operations") || raw.includes("projectmanager") || raw.includes("manager")) return "pm";
  if (raw.includes("foreman")) return "foreman";
  if (raw.includes("mechanic")) return "mechanic";
  if (raw.includes("laborer") || raw.includes("labourer") || raw.includes("field")) return "operator";
  return "operator";
};

const toValidationError = (issues: { path: (string | number)[]; message: string }[]) => ({
  error: "Validation error",
  details: issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const supabase = await supabaseServer();
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = authData.user.id;
    const email = String(authData.user.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "Invite email not found" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const client = admin ?? supabase;

    const existingMembership = await client
      .from("memberships")
      .select("company_id, role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (existingMembership.error) {
      return NextResponse.json({ error: existingMembership.error.message }, { status: 400 });
    }

    const inviteToken = String(parsed.data.token ?? "").trim();
    if (!inviteToken) {
      if (existingMembership.data?.company_id) {
        return NextResponse.json({ item: { success: true, company_id: existingMembership.data.company_id } });
      }
      return NextResponse.json({ error: "Invite token is required" }, { status: 422 });
    }

    const invitation = await client
      .from("invite_tokens")
      .select("token, company_id, employee_id, role, email, used_at, expires_at")
      .eq("token", inviteToken)
      .limit(1)
      .maybeSingle();
    if (invitation.error) {
      return NextResponse.json({ error: invitation.error.message }, { status: 400 });
    }
    if (!invitation.data) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
    }
    if (invitation.data.used_at) {
      return NextResponse.json({ error: "Invite already used" }, { status: 409 });
    }
    if (invitation.data.expires_at && new Date(invitation.data.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    }

    const tokenEmail = String(invitation.data.email ?? "").trim().toLowerCase();
    if (!tokenEmail || tokenEmail !== email) {
      return NextResponse.json({ error: "Invite email does not match signed-in user" }, { status: 403 });
    }

    if (existingMembership.data?.company_id && String(existingMembership.data.company_id) !== String(invitation.data.company_id)) {
      return NextResponse.json({ error: "User already belongs to another company" }, { status: 409 });
    }

    const resolvedRole = normalizeRole(invitation.data.role);
    const upsertMembership = await client
      .from("memberships")
      .upsert(
        {
          company_id: invitation.data.company_id,
          user_id: userId,
          role: resolvedRole,
        },
        { onConflict: "company_id,user_id" }
      );
    if (upsertMembership.error) {
      return NextResponse.json({ error: upsertMembership.error.message }, { status: 400 });
    }

    let employeeProfile = await client
      .from("employees")
      .select("id, company_id, name, full_name")
      .eq("id", invitation.data.employee_id)
      .eq("company_id", invitation.data.company_id)
      .limit(1)
      .maybeSingle();
    if (employeeProfile.error && /column employees\.(name|full_name) does not exist/i.test(employeeProfile.error.message || "")) {
      employeeProfile = await client
        .from("employees")
        .select("id, company_id")
        .eq("id", invitation.data.employee_id)
        .eq("company_id", invitation.data.company_id)
        .limit(1)
        .maybeSingle();
    }
    if (employeeProfile.error) {
      return NextResponse.json({ error: employeeProfile.error.message }, { status: 400 });
    }

    const profileName = String(
      (employeeProfile.data as { name?: string; full_name?: string } | null)?.name ??
        (employeeProfile.data as { name?: string; full_name?: string } | null)?.full_name ??
        authData.user.email ??
        ""
    ).trim();
    if (profileName) {
      await client.from("profiles").upsert({ id: userId, full_name: profileName });
    }

    let employeeUpdate = await client
      .from("employees")
      .update({ user_id: userId, role: resolvedRole })
      .eq("id", invitation.data.employee_id)
      .eq("company_id", invitation.data.company_id);
    if (employeeUpdate.error && /Could not find the 'user_id' column/i.test(employeeUpdate.error.message || "")) {
      employeeUpdate = await client
        .from("employees")
        .update({ role: resolvedRole })
        .eq("id", invitation.data.employee_id)
        .eq("company_id", invitation.data.company_id);
    }
    if (employeeUpdate.error) {
      return NextResponse.json({ error: employeeUpdate.error.message }, { status: 400 });
    }

    const tokenUse = await client
      .from("invite_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token", inviteToken)
      .is("used_at", null);
    if (tokenUse.error) {
      return NextResponse.json({ error: tokenUse.error.message }, { status: 400 });
    }

    return NextResponse.json({
      item: {
        success: true,
        company_id: invitation.data.company_id,
        role: resolvedRole,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
