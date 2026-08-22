import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const bodySchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("expire_current") }),
  z.object({
    operation: z.literal("age_review"),
    employee_id: z.string().uuid(),
    days: z.number().int().min(31).max(3650).default(31),
  }),
  z.object({
    operation: z.literal("audit_member"),
    email: z.string().email(),
  }),
]);

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production" && process.env.E2E !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await requireRole(["admin"]);
  const { companyId } = await getCompanyId();
  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Supabase admin not configured" }, { status: 500 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation error" }, { status: 422 });
  }

  if (parsed.data.operation === "expire_current") {
    const expiresAt = new Date(Date.now() - 60 * 60 * 1000);
    const createdAt = new Date(expiresAt.getTime() - 24 * 60 * 60 * 1000);
    const result = await admin
      .from("company_employee_join_codes")
      .update({ created_at: createdAt.toISOString(), expires_at: expiresAt.toISOString() })
      .eq("company_id", companyId)
      .select("company_id")
      .maybeSingle();
    if (result.error || !result.data) {
      return NextResponse.json(
        { error: result.error?.message || "Current code not found" },
        { status: result.error ? 400 : 404 }
      );
    }
    return NextResponse.json({ item: { expired: true } });
  }

  if (parsed.data.operation === "age_review") {
    const joinedAt = new Date(Date.now() - parsed.data.days * 24 * 60 * 60 * 1000).toISOString();
    const result = await admin
      .from("employees")
      .update({ joined_via_company_code_at: joinedAt, role_reviewed_at: null })
      .eq("company_id", companyId)
      .eq("id", parsed.data.employee_id)
      .select("id")
      .maybeSingle();
    if (result.error || !result.data) {
      return NextResponse.json(
        { error: result.error?.message || "Employee not found" },
        { status: result.error ? 400 : 404 }
      );
    }
    return NextResponse.json({ item: { joined_at: joinedAt } });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const employee = await admin
    .from("employees")
    .select("user_id")
    .eq("company_id", companyId)
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  const userId = String(employee.data?.user_id ?? "");
  if (employee.error || !userId) {
    return NextResponse.json(
      { error: employee.error?.message || "Employee not found" },
      { status: employee.error ? 400 : 404 }
    );
  }

  const [memberships, employees] = await Promise.all([
    admin.from("memberships").select("company_id").eq("user_id", userId),
    admin.from("employees").select("id").eq("user_id", userId),
  ]);
  if (memberships.error || employees.error) {
    return NextResponse.json(
      { error: memberships.error?.message || employees.error?.message || "Audit failed" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    item: {
      membership_count: memberships.data?.length ?? 0,
      employee_count: employees.data?.length ?? 0,
    },
  });
}
