import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { randomBytes } from "crypto";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const bodySchema = z.object({
  employeeId: z.string().uuid(),
  email: z.string().email(),
  role: z.string().optional(),
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

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm"]);
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
    const role = normalizeRole(payload.role ?? employeeRow.data.role ?? "operator");
    const token = randomBytes(24).toString("base64url");

    const insertResult = await supabase.from("invite_tokens").insert({
      token,
      company_id: companyId,
      employee_id: payload.employeeId,
      email,
      role,
      created_by: userId,
    });
    if (insertResult.error) {
      return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
    }

    const origin = request.headers.get("origin") || "";
    const url = `${origin}/signup?invite=1&token=${encodeURIComponent(token)}`;
    return NextResponse.json({ item: { token, url, role, email } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
