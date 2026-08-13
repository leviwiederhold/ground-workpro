import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import {
  canAssignTeamRole,
  canonicalizeRoleWrite,
  isMissingLegacyPermissionProfileColumn,
  legacyCompatibleRoleValue,
} from "@/lib/auth/teamRoles";

const bodySchema = z.object({
  employeeId: z.string().uuid(),
  email: z.string().email(),
  role: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    let actorRole: "admin" | "pm";
    try {
      actorRole = (await requireRole(["admin", "pm"])).role as "admin" | "pm";
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
            {
              error: "Validation error",
              details: parsed.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
                path: issue.path.join("."),
                message: issue.message,
              })),
            },
        { status: 422 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const payload = parsed.data;

    const employeeRow = await supabase
      .from("employees")
      .select("id, email, role")
      .eq("company_id", companyId)
      .eq("id", payload.employeeId)
      .maybeSingle();
    if (employeeRow.error) {
      return NextResponse.json({ error: employeeRow.error.message }, { status: 400 });
    }
    if (!employeeRow.data) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const email = String(payload.email).trim().toLowerCase();
    const roleWrite = canonicalizeRoleWrite(payload.role ?? employeeRow.data.role ?? "team_member");
    if (!canAssignTeamRole(actorRole, roleWrite.role)) {
      return NextResponse.json({ error: "Only Owners can invite another Owner." }, { status: 403 });
    }

    let employeeUpdate = await supabase
      .from("employees")
      .update({ email, ...roleWrite })
      .eq("company_id", companyId)
      .eq("id", payload.employeeId);
    if (isMissingLegacyPermissionProfileColumn(employeeUpdate.error)) {
      employeeUpdate = await supabase
        .from("employees")
        .update({
          email,
          role: legacyCompatibleRoleValue(
            payload.role ?? employeeRow.data.role,
            "employees"
          ),
        })
        .eq("company_id", companyId)
        .eq("id", payload.employeeId);
    }
    if (employeeUpdate.error) {
      return NextResponse.json({ error: employeeUpdate.error.message }, { status: 400 });
    }

    const token = randomBytes(24).toString("base64url");

    let insertResult = await supabase.from("invite_tokens").insert({
      token,
      company_id: companyId,
      employee_id: payload.employeeId,
      email,
      role: roleWrite.role,
      legacy_permission_profile: roleWrite.legacy_permission_profile,
      created_by: userId,
    });
    if (isMissingLegacyPermissionProfileColumn(insertResult.error)) {
      insertResult = await supabase.from("invite_tokens").insert({
        token,
        company_id: companyId,
        employee_id: payload.employeeId,
        email,
        role: legacyCompatibleRoleValue(
          payload.role ?? employeeRow.data.role,
          "invite_tokens"
        ),
        created_by: userId,
      });
    }
    if (insertResult.error) {
      return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    }

    const origin = request.headers.get("origin") || "";
    const url = `${origin}/signup?invite=1&token=${encodeURIComponent(token)}`;
    return NextResponse.json({ item: { token, url, role: roleWrite.role, email } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
