import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ensureCompanyHasAtLeastOneCeoMembership,
  isCeoMembershipRole,
  listCompanyMembershipRoles,
} from "@/lib/auth/ceoGuard";

const bodySchema = z.object({
  role: z.string().optional(),
  email: z.string().email().optional(),
  employeeId: z.string().uuid().optional(),
  token: z.string().min(20).optional(),
});

const normalizeRole = (value: unknown): "ceo" | "admin" | "pm" | "foreman" | "mechanic" | "operator" => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.includes("ceo")) return "ceo";
  if (raw.includes("admin") || raw.includes("executive")) return "admin";
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
        const existingCompanyId = String(existingMembership.data.company_id);
        try {
          await ensureCompanyHasAtLeastOneCeoMembership(client, existingCompanyId);
        } catch {
          await client
            .from("memberships")
            .update({ role: "ceo" })
            .eq("company_id", existingCompanyId)
            .eq("user_id", userId);
        }
        return NextResponse.json({ item: { success: true, company_id: existingMembership.data.company_id } });
      }
      return NextResponse.json({ error: "Invite token is required" }, { status: 422 });
    }

    const pendingInvitation = await client
      .from("pending_invitations")
      .select("id, company_id, employee_id, role, email, accepted_at, accepted_user_id, expires_at")
      .eq("invite_token", inviteToken)
      .limit(1)
      .maybeSingle();
    if (pendingInvitation.error) {
      return NextResponse.json({ error: pendingInvitation.error.message }, { status: 400 });
    }

    const legacyInvitation = !pendingInvitation.data
      ? await client
          .from("invite_tokens")
          .select("token, company_id, employee_id, role, email, used_at, expires_at")
          .eq("token", inviteToken)
          .limit(1)
          .maybeSingle()
      : null;
    if (legacyInvitation?.error) {
      return NextResponse.json({ error: legacyInvitation.error.message }, { status: 400 });
    }

    const invitationData = pendingInvitation.data
      ? {
          company_id: pendingInvitation.data.company_id,
          employee_id: pendingInvitation.data.employee_id,
          role: pendingInvitation.data.role,
          email: pendingInvitation.data.email,
          used_at: pendingInvitation.data.accepted_at,
          expires_at: pendingInvitation.data.expires_at,
          pending_id: pendingInvitation.data.id,
        }
      : legacyInvitation?.data
        ? {
            company_id: legacyInvitation.data.company_id,
            employee_id: legacyInvitation.data.employee_id,
            role: legacyInvitation.data.role,
            email: legacyInvitation.data.email,
            used_at: legacyInvitation.data.used_at,
            expires_at: legacyInvitation.data.expires_at,
            pending_id: null,
          }
        : null;

    if (!invitationData) {
      return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
    }
    if (invitationData.used_at) {
      return NextResponse.json({ error: "Invite already used" }, { status: 409 });
    }
    if (invitationData.expires_at && new Date(invitationData.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Invite expired" }, { status: 410 });
    }

    const tokenEmail = String(invitationData.email ?? "").trim().toLowerCase();
    if (!tokenEmail || tokenEmail !== email) {
      return NextResponse.json({ error: "Invite email does not match signed-in user" }, { status: 403 });
    }

    if (
      existingMembership.data?.company_id &&
      String(existingMembership.data.company_id) !== String(invitationData.company_id)
    ) {
      return NextResponse.json({ error: "User already belongs to another company" }, { status: 409 });
    }

    const resolvedRole = normalizeRole(invitationData.role);
    const existingCompanyMemberships = await listCompanyMembershipRoles(
      client,
      String(invitationData.company_id)
    );
    const ceoUserIds = new Set(
      existingCompanyMemberships
        .filter((row) => isCeoMembershipRole(row.role))
        .map((row) => row.user_id)
    );
    const userIsExistingCeo = ceoUserIds.has(userId);
    const resolvedIsCeo = isCeoMembershipRole(resolvedRole);
    if (!resolvedIsCeo && ceoUserIds.size === 0) {
      return NextResponse.json({ error: "Company must always have at least one CEO membership" }, { status: 409 });
    }
    if (!resolvedIsCeo && userIsExistingCeo && ceoUserIds.size <= 1) {
      return NextResponse.json({ error: "Cannot demote the last CEO membership" }, { status: 409 });
    }

    const upsertMembership = await client
      .from("memberships")
      .upsert(
        {
          company_id: invitationData.company_id,
          user_id: userId,
          role: resolvedRole,
        },
        { onConflict: "company_id,user_id" }
      );
    if (upsertMembership.error) {
      return NextResponse.json({ error: upsertMembership.error.message }, { status: 400 });
    }

    try {
      await ensureCompanyHasAtLeastOneCeoMembership(client, String(invitationData.company_id));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to enforce CEO role" }, { status: 409 });
    }

    let employeeProfile = await client
      .from("employees")
      .select("id, company_id, name, full_name")
      .eq("id", invitationData.employee_id)
      .eq("company_id", invitationData.company_id)
      .limit(1)
      .maybeSingle();
    if (employeeProfile.error && /column employees\.(name|full_name) does not exist/i.test(employeeProfile.error.message || "")) {
      employeeProfile = await client
        .from("employees")
        .select("id, company_id")
        .eq("id", invitationData.employee_id)
        .eq("company_id", invitationData.company_id)
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
      let profileUpsert = await client
        .from("profiles")
        .upsert({ id: userId, full_name: profileName, email });
      if (
        profileUpsert.error &&
        /column .*email.* does not exist|Could not find the 'email' column/i.test(profileUpsert.error.message || "")
      ) {
        profileUpsert = await client.from("profiles").upsert({ id: userId, full_name: profileName });
      }
      if (profileUpsert.error) {
        return NextResponse.json({ error: profileUpsert.error.message }, { status: 400 });
      }
    }

    const employeeRole = resolvedRole === "ceo" ? "admin" : resolvedRole;

    let employeeUpdate = await client
      .from("employees")
      .update({ user_id: userId, role: employeeRole })
      .eq("id", invitationData.employee_id)
      .eq("company_id", invitationData.company_id);
    if (employeeUpdate.error && /Could not find the 'user_id' column/i.test(employeeUpdate.error.message || "")) {
      employeeUpdate = await client
        .from("employees")
        .update({ role: employeeRole })
        .eq("id", invitationData.employee_id)
        .eq("company_id", invitationData.company_id);
    }
    if (employeeUpdate.error) {
      return NextResponse.json({ error: employeeUpdate.error.message }, { status: 400 });
    }

    const acceptedAt = new Date().toISOString();
    if (invitationData.pending_id) {
      const pendingUse = await client
        .from("pending_invitations")
        .update({ accepted_at: acceptedAt, accepted_user_id: userId })
        .eq("id", invitationData.pending_id)
        .is("accepted_at", null);
      if (pendingUse.error) {
        return NextResponse.json({ error: pendingUse.error.message }, { status: 400 });
      }

      const invitePermissions = await client
        .from("module_permissions")
        .select("module_key, access_level")
        .eq("company_id", invitationData.company_id)
        .eq("invitation_id", invitationData.pending_id);
      if (invitePermissions.error) {
        return NextResponse.json({ error: invitePermissions.error.message }, { status: 400 });
      }

      if ((invitePermissions.data ?? []).length > 0) {
        await client
          .from("module_permissions")
          .delete()
          .eq("company_id", invitationData.company_id)
          .eq("user_id", userId);
        const userPermissionInsert = await client.from("module_permissions").insert(
          (invitePermissions.data ?? []).map((row) => ({
            company_id: invitationData.company_id,
            user_id: userId,
            module_key: row.module_key,
            access_level: row.access_level,
          }))
        );
        if (userPermissionInsert.error) {
          return NextResponse.json({ error: userPermissionInsert.error.message }, { status: 400 });
        }
      }
    } else {
      const tokenUse = await client
        .from("invite_tokens")
        .update({ used_at: acceptedAt })
        .eq("token", inviteToken)
        .is("used_at", null);
      if (tokenUse.error) {
        return NextResponse.json({ error: tokenUse.error.message }, { status: 400 });
      }
    }

    return NextResponse.json({
      item: {
        success: true,
        company_id: invitationData.company_id,
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
