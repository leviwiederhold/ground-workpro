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
      .select("company_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (existingMembership.error) {
      return NextResponse.json({ error: existingMembership.error.message }, { status: 400 });
    }
    if (existingMembership.data?.company_id) {
      return NextResponse.json({ item: { success: true, company_id: existingMembership.data.company_id } });
    }

    const inviteEmail = String(parsed.data.email ?? "").trim().toLowerCase();
    const inviteEmployeeId = String(parsed.data.employeeId ?? "").trim();
    const inviteToken = String(parsed.data.token ?? "").trim();
    type InviteRow = {
      id?: string;
      company_id?: string;
      employee_id?: string;
      role?: string;
      name?: string;
      full_name?: string | null;
      email?: string;
      used_at?: string | null;
      expires_at?: string | null;
    };
    type InviteResult = { data: InviteRow | null; error: { message?: string | null } | null };
    let invitation: InviteResult | null = null;

    if (inviteToken) {
      invitation = await client
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
      if (tokenEmail && tokenEmail !== email) {
        return NextResponse.json({ error: "Invite email does not match signed-in user" }, { status: 403 });
      }
      invitation = {
        data: {
          id: invitation.data.employee_id,
          company_id: invitation.data.company_id,
          role: invitation.data.role,
          full_name: undefined,
          email: invitation.data.email,
        },
        error: null,
      };
    } else if (inviteEmployeeId) {
      invitation = await client
        .from("employees")
        .select("id, company_id, role, name, full_name, email")
        .eq("id", inviteEmployeeId)
        .limit(1)
        .maybeSingle();

      if (invitation.error && /column employees\.name does not exist/i.test(invitation.error.message || "")) {
        invitation = await client
          .from("employees")
          .select("id, company_id, role, full_name, email")
          .eq("id", inviteEmployeeId)
          .limit(1)
          .maybeSingle();
      }

      if (!invitation.error && invitation.data?.email) {
        const candidateEmail = String(invitation.data.email).trim().toLowerCase();
        if (candidateEmail && candidateEmail !== email) {
          return NextResponse.json({ error: "Invite email does not match signed-in user" }, { status: 403 });
        }
      }
    }

    if (!invitation?.data?.company_id) {
      invitation = null;
    }
    if (!invitation) {
      invitation = await client
      .from("employees")
      .select("id, company_id, role, name, full_name")
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    }

    if (invitation.error && /created_at/i.test(invitation.error.message || "")) {
      invitation = await client
        .from("employees")
        .select("id, company_id, role, name, full_name")
        .ilike("email", email)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
    }

    if (invitation.error && /column employees\.name does not exist/i.test(invitation.error.message || "")) {
      invitation = await client
        .from("employees")
        .select("id, company_id, role, full_name")
        .ilike("email", email)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
    }

    if ((!invitation.data || !invitation.data.company_id) && inviteEmail) {
      invitation = await client
        .from("employees")
        .select("id, company_id, role, name, full_name")
        .ilike("email", inviteEmail)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
    }

    if (invitation.error) {
      return NextResponse.json({ error: invitation.error.message }, { status: 400 });
    }
    if (!invitation.data?.company_id) {
      return NextResponse.json({ error: "No invite found for this email" }, { status: 404 });
    }

    const resolvedRole = parsed.data.role ?? normalizeRole(invitation.data.role);

    const membershipInsert = await client.from("memberships").insert({
      company_id: invitation.data.company_id,
      user_id: userId,
      role: resolvedRole,
    });
    if (membershipInsert.error && !/duplicate key|unique/i.test(membershipInsert.error.message || "")) {
      return NextResponse.json({ error: membershipInsert.error.message }, { status: 400 });
    }

    const profileName = String(
      (invitation.data as { name?: string; full_name?: string }).name ??
        (invitation.data as { name?: string; full_name?: string }).full_name ??
        authData.user.email ??
        ""
    ).trim();
    if (profileName) {
      await client.from("profiles").upsert({ id: userId, full_name: profileName });
    }

    let employeeUpdate = await client
      .from("employees")
      .update({ user_id: userId, role: resolvedRole })
      .eq("id", invitation.data.id)
      .eq("company_id", invitation.data.company_id);

    if (employeeUpdate.error && /Could not find the 'user_id' column/i.test(employeeUpdate.error.message || "")) {
      employeeUpdate = await client
        .from("employees")
        .update({ role: resolvedRole })
        .eq("id", invitation.data.id)
        .eq("company_id", invitation.data.company_id);
    }

    if (employeeUpdate.error && !/duplicate key|unique/i.test(employeeUpdate.error.message || "")) {
      return NextResponse.json({ error: employeeUpdate.error.message }, { status: 400 });
    }

    if (inviteToken) {
      const tokenUse = await client
        .from("invite_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("token", inviteToken)
        .is("used_at", null);
      if (tokenUse.error) {
        return NextResponse.json({ error: tokenUse.error.message }, { status: 400 });
      }
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
