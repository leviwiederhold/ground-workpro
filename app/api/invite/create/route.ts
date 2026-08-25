import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import {
  canonicalizeRoleWrite,
  isMissingLegacyPermissionProfileColumn,
  legacyCompatibleRoleValue,
} from "@/lib/auth/teamRoles";
import { getPrimaryOwnerUserId } from "@/lib/auth/companyOwnership";

const bodySchema = z.object({
  employeeId: z.string().uuid(),
  email: z.string().email(),
  role: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    let actorUserId = "";
    try {
      const actor = await requireRole(["admin", "pm"]);
      actorUserId = actor.userId;
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
    if (roleWrite.role === "owner") {
      return NextResponse.json(
        { error: "Primary ownership cannot be assigned through an invitation." },
        { status: 400 }
      );
    }
    if (roleWrite.role === "co_owner") {
      const primaryOwnerUserId = await getPrimaryOwnerUserId({ db: supabase, companyId });
      if (actorUserId !== primaryOwnerUserId) {
        return NextResponse.json({ error: "Only the primary Owner can invite a Co-Owner." }, { status: 403 });
      }
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
