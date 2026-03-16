import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  ensureCompanyHasAtLeastOneCeoMembership,
  isCeoMembershipRole,
  listCompanyMembershipRoles,
} from "@/lib/auth/ceoGuard";

const COMPANY_OWNER_MEMBERSHIP_ROLE = "admin";

const bodySchema = z.object({
  token: z.string().min(20),
  email: z.string().email(),
  password: z.string().min(6),
});

type InviteRow = {
  token: string;
  company_id: string;
  employee_id: string;
  email: string;
  role: string;
  used_at: string | null;
  expires_at: string | null;
};

const normalizeRole = (value: unknown): "ceo" | "admin" | "pm" | "foreman" | "mechanic" | "operator" | "fieldstaff" => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.includes("ceo")) return "ceo";
  if (raw.includes("admin") || raw.includes("executive")) return "admin";
  if (raw === "pm" || raw.includes("operations") || raw.includes("projectmanager") || raw.includes("manager")) return "pm";
  if (raw.includes("foreman")) return "foreman";
  if (raw.includes("mechanic")) return "mechanic";
  if (raw.includes("fieldstaff") || raw.includes("field_staff") || raw.includes("field staff")) return "fieldstaff";
  return "operator";
};

const isMissingSchemaError = (message: string | undefined) =>
  /(column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table)/i.test(
    message ?? ""
  );

const parseMissingColumn = (message: string | undefined): string | null => {
  if (!message) return null;
  const quoted = message.match(/Could not find the '([^']+)' column/i);
  if (quoted?.[1]) return quoted[1];
  const relation = message.match(/column "?([a-zA-Z0-9_]+)"? of relation/i);
  if (relation?.[1]) return relation[1];
  const generic = message.match(/column "?([a-zA-Z0-9_]+)"? does not exist/i);
  if (generic?.[1]) return generic[1];
  return null;
};

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.E2E !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 422 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const token = parsed.data.token.trim();

  const pendingInvite = await admin
    .from("pending_invitations")
    .select("id, company_id, employee_id, email, role, accepted_at, expires_at")
    .eq("invite_token", token)
    .maybeSingle();
  if (pendingInvite.error) {
    return NextResponse.json({ error: pendingInvite.error.message }, { status: 400 });
  }

  const inviteResult = !pendingInvite.data
    ? await admin
        .from("invite_tokens")
        .select("token, company_id, employee_id, email, role, used_at, expires_at")
        .eq("token", token)
        .maybeSingle<InviteRow>()
    : null;
  if (inviteResult?.error) {
    return NextResponse.json({ error: inviteResult.error.message }, { status: 400 });
  }

  const invitation = pendingInvite.data
    ? {
        company_id: pendingInvite.data.company_id,
        employee_id: pendingInvite.data.employee_id,
        email: pendingInvite.data.email,
        role: pendingInvite.data.role,
        used_at: pendingInvite.data.accepted_at,
        expires_at: pendingInvite.data.expires_at,
        pending_id: pendingInvite.data.id,
      }
    : inviteResult?.data
      ? {
          company_id: inviteResult.data.company_id,
          employee_id: inviteResult.data.employee_id,
          email: inviteResult.data.email,
          role: inviteResult.data.role,
          used_at: inviteResult.data.used_at,
          expires_at: inviteResult.data.expires_at,
          pending_id: null,
        }
      : null;

  if (!invitation) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  }
  if (invitation.used_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 409 });
  }
  if (invitation.expires_at && new Date(invitation.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }
  if (invitation.email.trim().toLowerCase() !== email) {
    return NextResponse.json({ error: "Invite email does not match" }, { status: 403 });
  }

  let userId: string | null = null;
  const createUser = await admin.auth.admin.createUser({
    email,
    password: parsed.data.password,
    email_confirm: true,
  });

  if (createUser.error) {
    const listUsers = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listUsers.error) {
      return NextResponse.json({ error: createUser.error.message }, { status: 400 });
    }
    const existing = (listUsers.data.users ?? []).find(
      (user) => String(user.email ?? "").trim().toLowerCase() === email
    );
    if (!existing) {
      return NextResponse.json({ error: createUser.error.message }, { status: 400 });
    }
    userId = existing.id;
  } else {
    userId = createUser.data.user?.id ?? null;
  }

  if (!userId) {
    return NextResponse.json({ error: "Failed to resolve invite user" }, { status: 500 });
  }

  const role = normalizeRole(invitation.role);
  const existingCompanyMemberships = await listCompanyMembershipRoles(
    admin,
    String(invitation.company_id)
  );
  const ceoUserIds = new Set(
    existingCompanyMemberships
      .filter((row) => isCeoMembershipRole(row.role))
      .map((row) => row.user_id)
  );
  const userIsExistingCeo = ceoUserIds.has(userId);
  const roleIsCeo = isCeoMembershipRole(role);
  if (!roleIsCeo && ceoUserIds.size === 0) {
    return NextResponse.json({ error: "Company must always have at least one CEO membership" }, { status: 409 });
  }
  if (!roleIsCeo && userIsExistingCeo && ceoUserIds.size <= 1) {
    return NextResponse.json({ error: "Cannot demote the last CEO membership" }, { status: 409 });
  }

  const membershipRole = role === "ceo" ? COMPANY_OWNER_MEMBERSHIP_ROLE : role;
  const membershipInsert = await admin.from("memberships").upsert(
    {
      company_id: invitation.company_id,
      user_id: userId,
      role: membershipRole,
    },
    { onConflict: "company_id,user_id" }
  );
  if (membershipInsert.error) {
    return NextResponse.json({ error: membershipInsert.error.message }, { status: 400 });
  }
  try {
    await ensureCompanyHasAtLeastOneCeoMembership(admin, String(invitation.company_id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to enforce CEO role" }, { status: 409 });
  }

  const employeeRole = membershipRole === COMPANY_OWNER_MEMBERSHIP_ROLE ? "admin" : membershipRole;

  const profileName = "";
  let employeeId = String(invitation.employee_id ?? "").trim();
  if (!employeeId) {
    const employeeByEmail = await admin
      .from("employees")
      .select("id")
      .eq("company_id", invitation.company_id)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (!employeeByEmail.error && employeeByEmail.data?.id) {
      employeeId = String(employeeByEmail.data.id);
    }
  }
  if (!employeeId) {
    const insertPayload: Record<string, unknown> = {
      company_id: invitation.company_id,
      email,
      role: employeeRole,
      user_id: userId,
      name: profileName,
      full_name: profileName,
      status: "active",
    };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const insertResult = await admin.from("employees").insert(insertPayload).select("id").maybeSingle();
      if (!insertResult.error && insertResult.data?.id) {
        employeeId = String(insertResult.data.id);
        break;
      }
      const message = insertResult.error?.message ?? "";
      if (/duplicate key|unique/i.test(message)) {
        const existingByEmail = await admin
          .from("employees")
          .select("id")
          .eq("company_id", invitation.company_id)
          .ilike("email", email)
          .limit(1)
          .maybeSingle();
        if (!existingByEmail.error && existingByEmail.data?.id) {
          employeeId = String(existingByEmail.data.id);
          break;
        }
      }
      if (!isMissingSchemaError(message)) {
        return NextResponse.json({ error: message || "Failed to create employee" }, { status: 400 });
      }
      const missingColumn = parseMissingColumn(message);
      if (!missingColumn || !(missingColumn in insertPayload)) {
        return NextResponse.json({ error: message || "Failed to create employee" }, { status: 400 });
      }
      delete insertPayload[missingColumn];
    }
  }
  if (!employeeId) {
    return NextResponse.json({ error: "Failed to resolve employee for invite" }, { status: 400 });
  }

  const employeeUpdatePayload: Record<string, unknown> = {
    role: employeeRole,
    user_id: userId,
    email,
    name: profileName,
    full_name: profileName,
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const employeeUpdate = await admin
      .from("employees")
      .update(employeeUpdatePayload)
      .eq("company_id", invitation.company_id)
      .eq("id", employeeId);
    if (!employeeUpdate.error) break;
    const message = employeeUpdate.error.message ?? "";
    if (!isMissingSchemaError(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    const missingColumn = parseMissingColumn(message);
    if (!missingColumn || !(missingColumn in employeeUpdatePayload)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    delete employeeUpdatePayload[missingColumn];
  }

  const acceptedAt = new Date().toISOString();
  if (invitation.pending_id) {
    const pendingUse = await admin
      .from("pending_invitations")
      .update({ accepted_at: acceptedAt, accepted_user_id: userId })
      .eq("id", invitation.pending_id);
    if (pendingUse.error) {
      return NextResponse.json({ error: pendingUse.error.message }, { status: 400 });
    }

    const invitePermissions = await admin
      .from("module_permissions")
      .select("module_key, access_level")
      .eq("company_id", invitation.company_id)
      .eq("invitation_id", invitation.pending_id);
    if (invitePermissions.error) {
      return NextResponse.json({ error: invitePermissions.error.message }, { status: 400 });
    }
    if ((invitePermissions.data ?? []).length > 0) {
      await admin.from("module_permissions").delete().eq("company_id", invitation.company_id).eq("user_id", userId);
      const insertPermissions = await admin.from("module_permissions").insert(
        (invitePermissions.data ?? []).map((row) => ({
          company_id: invitation.company_id,
          user_id: userId,
          module_key: row.module_key,
          access_level: row.access_level,
        }))
      );
      if (insertPermissions.error) {
        return NextResponse.json({ error: insertPermissions.error.message }, { status: 400 });
      }
    }
  } else {
    const tokenUse = await admin
      .from("invite_tokens")
      .update({ used_at: acceptedAt })
      .eq("token", token);
    if (tokenUse.error) {
      return NextResponse.json({ error: tokenUse.error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ item: { success: true, userId } });
}
