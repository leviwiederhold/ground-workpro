import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isCompanyOwnerEmployee } from "@/lib/auth/ownerLock";
import {
  assertCeoAccessLocked,
  assertCeoSelfAccessNotReduced,
  getDefaultPermissionsByRole,
  normalizePermissionPayload,
} from "@/lib/permissions/access";
import {
  modulePermissionKeys,
  moduleAccessLevelSchema,
  invitationRoleSchema,
  type ModulePermissionMap,
} from "@/lib/permissions/types";
import { normalizeAppRole } from "@/lib/nav/config";

const paramsSchema = z.object({ id: z.string().uuid() });

const permissionOverrideSchema = z.object({
  module_key: z.enum(modulePermissionKeys),
  access_level: moduleAccessLevelSchema,
});

const patchSchema = z.object({
  role: invitationRoleSchema.optional(),
  permissions: z.array(permissionOverrideSchema),
  mark_reviewed: z.boolean().optional().default(false),
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

const toTemplateRole = (role: string) => {
  const raw = String(role ?? "").trim().toLowerCase();
  if (raw.includes("fieldstaff") || raw.includes("field_staff") || raw.includes("field staff")) {
    return "fieldstaff" as const;
  }
  const normalized = normalizeAppRole(role) ?? "operator";
  if (normalized === "admin") return "ceo" as const;
  if (normalized === "pm") return "manager" as const;
  return normalized;
};

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireModuleAccess("team_management", "view");
    const { supabase, companyId } = await getCompanyId();

    const parsedParams = paramsSchema.safeParse(await context.params);
    if (!parsedParams.success) {
      return NextResponse.json(toValidationError(parsedParams.error.issues), { status: 422 });
    }

    const employeeResult = await supabase
      .from("employees")
      .select("id, role, user_id, email")
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .maybeSingle();

    if (employeeResult.error) {
      return NextResponse.json({ error: employeeResult.error.message }, { status: 400 });
    }
    if (!employeeResult.data) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    }

    const fallbackRole = toTemplateRole(String(employeeResult.data.role ?? "operator"));
    const permissionMap = getDefaultPermissionsByRole(fallbackRole);

    const userId = String(employeeResult.data.user_id ?? "").trim();
    if (userId) {
      const permissionResult = await supabase
        .from("module_permissions")
        .select("module_key, access_level")
        .eq("company_id", companyId)
        .eq("user_id", userId);

      if (permissionResult.error) {
        return NextResponse.json({ error: permissionResult.error.message }, { status: 400 });
      }

      for (const row of permissionResult.data ?? []) {
        permissionMap[row.module_key as (typeof modulePermissionKeys)[number]] =
          row.access_level as ModulePermissionMap[(typeof modulePermissionKeys)[number]];
      }
    }

    return NextResponse.json({
      item: {
        employee_id: parsedParams.data.id,
        user_id: userId || null,
        role: fallbackRole,
        permissions: permissionsToRows(permissionMap),
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && /CEO/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId: actorUserId, role: actorRole } = await requireModuleAccess("team_management", "edit");
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

    const employeeResult = await supabase
      .from("employees")
      .select("id, role, user_id, email")
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .maybeSingle();

    if (employeeResult.error) {
      return NextResponse.json({ error: employeeResult.error.message }, { status: 400 });
    }
    if (!employeeResult.data) {
      return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    }

    // Owner/CEO lock takes precedence over the unlinked-account guard: the
    // owner's role cannot be changed even if their employees row isn't linked.
    if (parsedBody.data.role && parsedBody.data.role !== "ceo") {
      const adminClient = getSupabaseAdmin();
      const isOwner = await isCompanyOwnerEmployee({
        adminClient,
        db: adminClient ?? supabase,
        companyId,
        employeeRole: employeeResult.data.role,
        employeeUserId: employeeResult.data.user_id,
        employeeEmail: (employeeResult.data as { email?: unknown }).email,
      });
      if (isOwner) {
        return NextResponse.json({ error: "CEO role is locked and cannot be changed" }, { status: 400 });
      }
    }

    const targetUserId = String(employeeResult.data.user_id ?? "").trim();
    if (!targetUserId) {
      return NextResponse.json({ error: "Team member has no active account yet" }, { status: 400 });
    }

    const membershipResult = await supabase
      .from("memberships")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (membershipResult.error) {
      return NextResponse.json({ error: membershipResult.error.message }, { status: 400 });
    }

    const normalized = normalizePermissionPayload({
      role: parsedBody.data.role ?? toTemplateRole(String(employeeResult.data.role ?? "operator")),
      permissions: parsedBody.data.permissions,
    });
    const currentTemplateRole = toTemplateRole(String(employeeResult.data.role ?? "operator"));
    const roleChanged = Boolean(parsedBody.data.role && normalized.role !== currentTemplateRole);
    const shouldMarkReviewed = parsedBody.data.mark_reviewed || roleChanged;
    if ((roleChanged || shouldMarkReviewed) && actorRole !== "admin") {
      return NextResponse.json(
        { error: "Only an owner or co-owner can review or change a member's role" },
        { status: 403 }
      );
    }

    const targetEmployeeRole = normalizeAppRole(String(employeeResult.data.role ?? ""));
    const targetMembershipRole = normalizeAppRole(String(membershipResult.data?.role ?? ""));
    const isTargetCeo = targetEmployeeRole === "admin" || targetMembershipRole === "admin";

    assertCeoAccessLocked({
      isTargetCeo,
      requestedRole: normalized.role,
      nextPermissions: normalized.permissions,
    });

    assertCeoSelfAccessNotReduced({
      actorUserId,
      targetUserId,
      targetRole: normalized.role,
      nextPermissions: normalized.permissions,
    });

    await supabase
      .from("module_permissions")
      .delete()
      .eq("company_id", companyId)
      .eq("user_id", targetUserId);

    const insertResult = await supabase.from("module_permissions").insert(
      permissionsToRows(normalized.permissions).map((row) => ({
        company_id: companyId,
        user_id: targetUserId,
        module_key: row.module_key,
        access_level: row.access_level,
        created_by: actorUserId,
      }))
    );

    if (insertResult.error) {
      return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    }

    if (roleChanged) {
      const membershipRole =
        normalized.role === "ceo"
          ? "admin"
          : normalized.role === "manager"
            ? "pm"
            : normalized.role === "fieldstaff"
              ? "operator"
              : normalized.role;
      const writeDb = getSupabaseAdmin() ?? supabase;
      const membershipUpdate = await writeDb
        .from("memberships")
        .update({ role: membershipRole })
        .eq("company_id", companyId)
        .eq("user_id", targetUserId);
      if (membershipUpdate.error) {
        return NextResponse.json({ error: membershipUpdate.error.message }, { status: 400 });
      }
    }

    if (roleChanged || shouldMarkReviewed) {
      const writeDb = getSupabaseAdmin() ?? supabase;
      const employeeUpdatePayload: Record<string, unknown> = {};
      if (roleChanged) {
        employeeUpdatePayload.role =
          normalized.role === "ceo"
            ? "admin"
            : normalized.role === "manager"
              ? "pm"
              : normalized.role;
      }
      if (shouldMarkReviewed) {
        employeeUpdatePayload.role_reviewed_at = new Date().toISOString();
      }
      const employeeUpdate = await writeDb
        .from("employees")
        .update(employeeUpdatePayload)
        .eq("company_id", companyId)
        .eq("id", parsedParams.data.id);
      if (employeeUpdate.error) {
        return NextResponse.json({ error: employeeUpdate.error.message }, { status: 400 });
      }
    }

    return NextResponse.json({
      item: {
        employee_id: parsedParams.data.id,
        user_id: targetUserId,
        role: normalized.role,
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
