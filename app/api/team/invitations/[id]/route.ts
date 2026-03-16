import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import {
  normalizePermissionPayload,
  getDefaultPermissionsByRole,
} from "@/lib/permissions/access";
import {
  invitationRoleSchema,
  moduleAccessLevelSchema,
  modulePermissionKeys,
  type ModulePermissionMap,
} from "@/lib/permissions/types";

const paramsSchema = z.object({ id: z.string().uuid() });

const permissionOverrideSchema = z.object({
  module_key: z.enum(modulePermissionKeys),
  access_level: moduleAccessLevelSchema,
});

const patchSchema = z
  .object({
    full_name: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    role: invitationRoleSchema.optional(),
    permissions: z.array(permissionOverrideSchema).optional(),
    regenerate: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const toValidationError = (issues: z.ZodIssue[]) => ({
  error: "Validation error",
  details: issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

const permissionsToRows = (permissions: ModulePermissionMap) =>
  modulePermissionKeys.map((moduleKey) => ({
    module_key: moduleKey,
    access_level: permissions[moduleKey],
  }));

const buildOrigin = (request: Request) => {
  const host = request.headers.get("x-forwarded-host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host) return `${proto}://${host}`;
  return request.headers.get("origin") ?? "";
};

const invitationRoleToAppRole = (role: z.infer<typeof invitationRoleSchema>) => {
  if (role === "ceo") return "admin";
  if (role === "manager") return "pm";
  if (role === "fieldstaff") return "fieldstaff";
  return role;
};

const loadPermissions = async (
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  invitationId: string,
  fallbackRole: z.infer<typeof invitationRoleSchema>
) => {
  const permissionsResult = await supabase
    .from("module_permissions")
    .select("module_key, access_level")
    .eq("company_id", companyId)
    .eq("invitation_id", invitationId);

  if (permissionsResult.error) {
    throw new Error(permissionsResult.error.message);
  }

  const defaultPermissions = getDefaultPermissionsByRole(fallbackRole);
  for (const row of permissionsResult.data ?? []) {
    defaultPermissions[row.module_key as (typeof modulePermissionKeys)[number]] =
      row.access_level as ModulePermissionMap[(typeof modulePermissionKeys)[number]];
  }

  return defaultPermissions;
};

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireModuleAccess("team_management", "edit");
    const { supabase, companyId } = await getCompanyId();

    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json(toValidationError(parsedParams.error.issues), { status: 422 });
    }

    const body = await request.json().catch(() => ({}));
    const parsedBody = patchSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(toValidationError(parsedBody.error.issues), { status: 422 });
    }

    const invitationId = parsedParams.data.id;
    const existing = await supabase
      .from("pending_invitations")
      .select("id, role, full_name, email, invite_token, expires_at")
      .eq("company_id", companyId)
      .eq("id", invitationId)
      .is("accepted_at", null)
      .maybeSingle();

    if (existing.error) {
      return NextResponse.json({ error: existing.error.message }, { status: 400 });
    }
    if (!existing.data) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    const updatePayload: Record<string, unknown> = {};
    if (parsedBody.data.full_name !== undefined) updatePayload.full_name = parsedBody.data.full_name;
    if (parsedBody.data.email !== undefined) updatePayload.email = parsedBody.data.email.toLowerCase();
    if (parsedBody.data.role !== undefined) updatePayload.role = parsedBody.data.role;
    if (parsedBody.data.regenerate) {
      updatePayload.invite_token = randomBytes(24).toString("base64url");
      updatePayload.expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    }

    let updatedRow = existing.data;
    if (Object.keys(updatePayload).length > 0) {
      const updateResult = await supabase
        .from("pending_invitations")
        .update(updatePayload)
        .eq("company_id", companyId)
        .eq("id", invitationId)
        .select("id, role, full_name, email, invite_token, expires_at, created_at, updated_at")
        .single();

      if (updateResult.error) {
        return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
      }
      updatedRow = updateResult.data;
    }

    const normalizedPermissions = parsedBody.data.permissions
      ? normalizePermissionPayload({
          role: parsedBody.data.role ?? (updatedRow.role as z.infer<typeof invitationRoleSchema>),
          permissions: parsedBody.data.permissions,
        }).permissions
      : await loadPermissions(
          supabase,
          companyId,
          invitationId,
          updatedRow.role as z.infer<typeof invitationRoleSchema>
        );

    if (parsedBody.data.permissions) {
      await supabase
        .from("module_permissions")
        .delete()
        .eq("company_id", companyId)
        .eq("invitation_id", invitationId);

      const permissionInsert = await supabase.from("module_permissions").insert(
        permissionsToRows(normalizedPermissions).map((row) => ({
          company_id: companyId,
          invitation_id: invitationId,
          module_key: row.module_key,
          access_level: row.access_level,
          created_by: userId,
        }))
      );

      if (permissionInsert.error) {
        return NextResponse.json({ error: permissionInsert.error.message }, { status: 400 });
      }
    }

    const origin = buildOrigin(request);
    const inviteUrl = origin
      ? `${origin}/signup?invite=1&token=${encodeURIComponent(String(updatedRow.invite_token))}`
      : `/signup?invite=1&token=${encodeURIComponent(String(updatedRow.invite_token))}`;

    return NextResponse.json({
      item: {
        id: invitationId,
        full_name: String(updatedRow.full_name ?? ""),
        email: String(updatedRow.email),
        role: updatedRow.role,
        app_role: invitationRoleToAppRole(updatedRow.role as z.infer<typeof invitationRoleSchema>),
        status: "pending",
        invite_url: inviteUrl,
        invite_token: String(updatedRow.invite_token),
        expires_at: String(updatedRow.expires_at),
        permissions: permissionsToRows(normalizedPermissions),
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireModuleAccess("team_management", "edit");
    const { supabase, companyId } = await getCompanyId();

    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json(toValidationError(parsedParams.error.issues), { status: 422 });
    }

    const invitationId = parsedParams.data.id;

    const deleteResult = await supabase
      .from("pending_invitations")
      .delete()
      .eq("company_id", companyId)
      .eq("id", invitationId)
      .is("accepted_at", null);

    if (deleteResult.error) {
      return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
