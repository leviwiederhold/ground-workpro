import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { isCeoMembershipRole } from "@/lib/auth/ceoGuard";
import {
  canonicalizeRoleWrite,
  isMissingLegacyPermissionProfileColumn,
  legacyCompatibleRoleValue,
  normalizeCanonicalTeamRole,
} from "@/lib/auth/teamRoles";
import { getPrimaryOwnerUserId } from "@/lib/auth/companyOwnership";
import {
  getDefaultPermissionsByRole,
  normalizePermissionPayload,
} from "@/lib/permissions/access";
import {
  compatibleInvitationRoleSchema,
  moduleAccessLevelSchema,
  modulePermissionKeys,
  type ModulePermissionMap,
} from "@/lib/permissions/types";

type PendingInvitationRow = {
  id: string;
  company_id: string;
  email: string | null;
  role: string;
  legacy_permission_profile?: string | null;
  full_name: string | null;
  job_title: string | null;
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

// New flow: the admin supplies role, job title, and permissions only. The
// employee provides their own email/name when they accept the invite.
const createInvitationSchema = z.object({
  role: compatibleInvitationRoleSchema,
  job_title: z.string().trim().max(120).optional(),
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
    const current = permissionsByInvitation.get(invitationId) ?? getDefaultPermissionsByRole("team_member");
    current[row.module_key as (typeof modulePermissionKeys)[number]] =
      row.access_level as ModulePermissionMap[(typeof modulePermissionKeys)[number]];
    permissionsByInvitation.set(invitationId, current);
  }
  return permissionsByInvitation;
};

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { role: actorRole } = await requireModuleAccess("team_management", "view");
    const { supabase, companyId } = await getCompanyId();

    // Active pending = not accepted and not expired (company-scoped).
    const nowIso = new Date().toISOString();

    const invitationWithName = await supabase
      .from("pending_invitations")
      .select("id, company_id, email, role, legacy_permission_profile, full_name, job_title, invite_token, expires_at, created_at, updated_at, accepted_at")
      .eq("company_id", companyId)
      .is("accepted_at", null)
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false });
    let invitationRows = invitationWithName.data as PendingInvitationRow[] | null;
    let invitationError = invitationWithName.error;

    if (isMissingLegacyPermissionProfileColumn(invitationError)) {
      const legacyInvitationsWithNames = await supabase
        .from("pending_invitations")
        .select("id, company_id, email, role, full_name, job_title, invite_token, expires_at, created_at, updated_at, accepted_at")
        .eq("company_id", companyId)
        .is("accepted_at", null)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false });
      if (legacyInvitationsWithNames.error && /full_name|job_title/i.test(legacyInvitationsWithNames.error.message || "")) {
        const legacyInvitationsWithoutNames = await supabase
          .from("pending_invitations")
          .select("id, company_id, email, role, invite_token, expires_at, created_at, updated_at, accepted_at")
          .eq("company_id", companyId)
          .is("accepted_at", null)
          .gt("expires_at", nowIso)
          .order("created_at", { ascending: false });
        invitationRows = (legacyInvitationsWithoutNames.data ?? []).map((row) => ({
          ...row,
          legacy_permission_profile: null,
          full_name: null,
          job_title: null,
        })) as PendingInvitationRow[];
        invitationError = legacyInvitationsWithoutNames.error;
      } else {
        invitationRows = (legacyInvitationsWithNames.data ?? []).map((row) => ({
          ...row,
          legacy_permission_profile: null,
        })) as PendingInvitationRow[];
        invitationError = legacyInvitationsWithNames.error;
      }
    } else if (invitationError && /full_name|job_title/i.test(invitationError.message || "")) {
      const invitationWithoutName = await supabase
        .from("pending_invitations")
        .select("id, company_id, email, role, legacy_permission_profile, invite_token, expires_at, created_at, updated_at, accepted_at")
        .eq("company_id", companyId)
        .is("accepted_at", null)
        .gt("expires_at", nowIso)
        .order("created_at", { ascending: false });
      invitationRows = (invitationWithoutName.data ?? []).map((row) => ({
        ...row,
        full_name: null,
        job_title: null,
      })) as PendingInvitationRow[];
      invitationError = invitationWithoutName.error;
    }

    if (invitationError) {
      return NextResponse.json({ error: invitationError.message }, { status: 400 });
    }

    const rows = invitationRows ?? [];
    const permissionMap = await loadPermissionMap(
      supabase,
      companyId,
      rows.map((row) => row.id)
    );

    const origin = buildOrigin(request);
    const items = rows.map((row) => {
      const defaultPermissions = getDefaultPermissionsByRole(
        row.role,
        row.legacy_permission_profile
      );
      const permissions = permissionMap.get(row.id) ?? defaultPermissions;
      return {
        id: row.id,
        full_name: row.full_name ?? "",
        email: row.email ?? "",
        job_title: row.job_title ?? "",
        role: normalizeCanonicalTeamRole(row.role) ?? "team_member",
        app_role: normalizeCanonicalTeamRole(row.role) ?? "team_member",
        status: "pending",
        invite_url:
          normalizeCanonicalTeamRole(row.role) === "owner" && !isCeoMembershipRole(actorRole)
            ? ""
            : origin
              ? `${origin}/signup?invite=1&token=${encodeURIComponent(row.invite_token)}`
              : "",
        invite_token:
          normalizeCanonicalTeamRole(row.role) === "owner" && !isCeoMembershipRole(actorRole)
            ? ""
            : row.invite_token,
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

    const requestedRole = canonicalizeRoleWrite(parsed.data.role);
    if (requestedRole.role === "owner") {
      return NextResponse.json(
        { error: "Primary ownership cannot be assigned through an invitation." },
        { status: 400 }
      );
    }
    if (requestedRole.role === "co_owner") {
      const primaryOwnerUserId = await getPrimaryOwnerUserId({ db: supabase, companyId });
      if (userId !== primaryOwnerUserId) {
        return NextResponse.json(
          { error: "Only the primary Owner can invite a Co-Owner." },
          { status: 403 }
        );
      }
    }

    const normalized = normalizePermissionPayload({
      role: parsed.data.role,
      permissions: parsed.data.permissions ?? [],
    });

    // 256 bits of entropy, URL-safe — hard to guess, single-use, expiring.
    const inviteToken = randomBytes(32).toString("base64url");
    const jobTitle = parsed.data.job_title?.trim() || null;
    const baseInsert: Record<string, unknown> = {
      company_id: companyId,
      role: normalized.role,
      legacy_permission_profile: requestedRole.legacy_permission_profile,
      job_title: jobTitle,
      invite_token: inviteToken,
      invited_by: userId,
    };

    // The application deploy can precede the database migration. On the legacy
    // schema, the legacy role value itself preserves the permission profile.
    const compatibleInsert = { ...baseInsert };
    let insertResult = await supabase
      .from("pending_invitations")
      .insert(compatibleInsert)
      .select("*")
      .single();

    for (let attempt = 0; insertResult.error && attempt < 4; attempt += 1) {
      const message = insertResult.error.message || "";
      if (isMissingLegacyPermissionProfileColumn(insertResult.error)) {
        delete compatibleInsert.legacy_permission_profile;
        compatibleInsert.role = legacyCompatibleRoleValue(
          parsed.data.role,
          "pending_invitations"
        );
      } else if (/job_title/i.test(message) && "job_title" in compatibleInsert) {
        delete compatibleInsert.job_title;
      } else {
        break;
      }
      insertResult = await supabase
        .from("pending_invitations")
        .insert(compatibleInsert)
        .select("*")
        .single();
    }

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

    // No email is known at creation time anymore, so there is no specific user
    // to notify — the link is shared by the admin directly.

    return NextResponse.json({
      item: {
        id: invitation.id,
        full_name: invitation.full_name ?? "",
        email: invitation.email ?? "",
        job_title: invitation.job_title ?? jobTitle ?? "",
        role: normalizeCanonicalTeamRole(invitation.role) ?? normalized.role,
        app_role: normalizeCanonicalTeamRole(invitation.role) ?? normalized.role,
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
