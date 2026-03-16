import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import {
  getDefaultPermissionsByRole,
  normalizePermissionPayload,
} from "@/lib/permissions/access";
import {
  invitationRoleSchema,
  moduleAccessLevelSchema,
  modulePermissionKeys,
  type ModulePermissionMap,
} from "@/lib/permissions/types";
import { enqueueNotifications } from "@/lib/notifications/enqueue";

type PendingInvitationRow = {
  id: string;
  company_id: string;
  email: string;
  role: z.infer<typeof invitationRoleSchema>;
  full_name: string | null;
  invite_token: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
};

const permissionOverrideSchema = z.object({
  module_key: z.enum(modulePermissionKeys),
  access_level: moduleAccessLevelSchema,
});

const createInvitationSchema = z.object({
  full_name: z.string().trim().min(1),
  email: z.string().trim().email(),
  role: invitationRoleSchema,
  permissions: z.array(permissionOverrideSchema).optional(),
});

const toValidationError = (issues: z.ZodIssue[]) => ({
  error: "Validation error",
  details: issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

const buildOrigin = (request: Request) => {
  const host = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return request.headers.get("origin") ?? "";
};

const permissionsToRows = (permissions: ModulePermissionMap) =>
  modulePermissionKeys.map((moduleKey) => ({
    module_key: moduleKey,
    access_level: permissions[moduleKey],
  }));

const invitationRoleToAppRole = (role: z.infer<typeof invitationRoleSchema>) => {
  if (role === "ceo") return "admin";
  if (role === "manager") return "pm";
  if (role === "fieldstaff") return "fieldstaff";
  return role;
};

const loadPermissionMap = async (
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  invitationIds: string[]
) => {
  if (invitationIds.length === 0) return new Map<string, ModulePermissionMap>();

  const permissionsResult = await supabase
    .from("module_permissions")
    .select("invitation_id, module_key, access_level")
    .eq("company_id", companyId)
    .in("invitation_id", invitationIds);

  if (permissionsResult.error) {
    throw new Error(permissionsResult.error.message);
  }

  const permissionsByInvitation = new Map<string, ModulePermissionMap>();
  for (const row of permissionsResult.data ?? []) {
    const invitationId = String(row.invitation_id ?? "");
    if (!invitationId) continue;
    const current = permissionsByInvitation.get(invitationId) ?? getDefaultPermissionsByRole("fieldstaff");
    current[row.module_key as (typeof modulePermissionKeys)[number]] =
      row.access_level as ModulePermissionMap[(typeof modulePermissionKeys)[number]];
    permissionsByInvitation.set(invitationId, current);
  }
  return permissionsByInvitation;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireModuleAccess("team_management", "view");
    const { supabase, companyId } = await getCompanyId();

    const invitationWithName = await supabase
      .from("pending_invitations")
      .select("id, company_id, email, role, full_name, invite_token, expires_at, created_at, updated_at, accepted_at")
      .eq("company_id", companyId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false });

    const invitationWithoutName =
      invitationWithName.error && /full_name/i.test(invitationWithName.error.message || "")
        ? await supabase
        .from("pending_invitations")
        .select("id, company_id, email, role, invite_token, expires_at, created_at, updated_at, accepted_at")
        .eq("company_id", companyId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false })
        : null;

    const invitationError = invitationWithoutName?.error ?? invitationWithName.error;
    if (invitationError) {
      return NextResponse.json({ error: invitationError.message }, { status: 400 });
    }

    const rows = ((invitationWithoutName?.data ?? invitationWithName.data) ?? []) as PendingInvitationRow[];
    const permissionMap = await loadPermissionMap(
      supabase,
      companyId,
      rows.map((row) => row.id)
    );

    const origin = buildOrigin(request);
    const items = rows.map((row) => {
      const defaultPermissions = getDefaultPermissionsByRole(row.role);
      const permissions = permissionMap.get(row.id) ?? defaultPermissions;
      return {
        id: row.id,
        full_name: row.full_name ?? "",
        email: row.email,
        role: row.role,
        app_role: invitationRoleToAppRole(row.role),
        status: "pending",
        invite_url: origin ? `${origin}/signup?invite=1&token=${encodeURIComponent(row.invite_token)}` : "",
        invite_token: row.invite_token,
        created_at: row.created_at,
        updated_at: row.updated_at,
        expires_at: row.expires_at,
        permissions: permissionsToRows(permissions),
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { userId } = await requireModuleAccess("team_management", "edit");
    const { supabase, companyId } = await getCompanyId();

    const body = await request.json().catch(() => ({}));
    const parsed = createInvitationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const normalized = normalizePermissionPayload({
      role: parsed.data.role,
      permissions: parsed.data.permissions ?? [],
    });

    const inviteToken = randomBytes(24).toString("base64url");
    const insertResult = await supabase
      .from("pending_invitations")
      .insert({
        company_id: companyId,
        full_name: parsed.data.full_name,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
        invite_token: inviteToken,
        invited_by: userId,
      })
      .select("id, company_id, email, role, full_name, invite_token, expires_at, created_at, updated_at, accepted_at")
      .single();

    if (insertResult.error) {
      return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    }

    const invitation = insertResult.data as PendingInvitationRow;
    const moduleRows = permissionsToRows(normalized.permissions).map((row) => ({
      company_id: companyId,
      invitation_id: invitation.id,
      module_key: row.module_key,
      access_level: row.access_level,
      created_by: userId,
    }));

    const permissionInsert = await supabase.from("module_permissions").insert(moduleRows);
    if (permissionInsert.error) {
      await supabase.from("pending_invitations").delete().eq("id", invitation.id).eq("company_id", companyId);
      return NextResponse.json({ error: permissionInsert.error.message }, { status: 400 });
    }

    const origin = buildOrigin(request);
    const inviteUrl = origin
      ? `${origin}/signup?invite=1&token=${encodeURIComponent(inviteToken)}`
      : `/signup?invite=1&token=${encodeURIComponent(inviteToken)}`;

    try {
      // Notify the invited user when that email already maps to a known profile.
      const profileResult = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", invitation.email)
        .limit(1);
      if (!profileResult.error) {
        const recipientUserIds = (profileResult.data ?? [])
          .map((row) => String((row as { id?: string }).id ?? ""))
          .filter((id) => Boolean(id) && id !== String(userId));
        if (recipientUserIds.length > 0) {
          await enqueueNotifications({
            supabase,
            companyId,
            userIds: recipientUserIds,
            type: "company_invite",
            payload: {
              inviteId: invitation.id,
              fullName: invitation.full_name ?? parsed.data.full_name,
              email: invitation.email,
              role: invitation.role,
              href: "/signup",
              inviteMessage: `${invitation.full_name ?? parsed.data.full_name} was invited to join the company.`,
            },
            entityType: "company_invite",
            entityId: invitation.id,
            actorUserId: userId,
          });
        }
      }
    } catch {
      // Non-blocking notification fanout.
    }

    return NextResponse.json({
      item: {
        id: invitation.id,
        full_name: invitation.full_name ?? parsed.data.full_name,
        email: invitation.email,
        role: invitation.role,
        app_role: invitationRoleToAppRole(invitation.role),
        status: "pending",
        invite_url: inviteUrl,
        invite_token: inviteToken,
        created_at: invitation.created_at,
        updated_at: invitation.updated_at,
        expires_at: invitation.expires_at,
        permissions: permissionsToRows(normalized.permissions),
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
