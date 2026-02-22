import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const bodySchema = z.object({
  role: z.enum(["admin", "pm", "foreman", "mechanic", "operator"]),
});

const toValidationError = (issues: { path: (string | number)[]; message: string }[]) => ({
  error: "Validation error",
  details: issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const payload = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const { supabase, userId } = await getCompanyId();
    const supabaseAdmin = getSupabaseAdmin();
    const client = supabaseAdmin ?? supabase;

    const { data: updatedRows, error } = await client
      .from("memberships")
      .update({ role: parsed.data.role })
      .eq("user_id", userId)
      .select("company_id, user_id, role");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set("e2e_role", parsed.data.role, { path: "/", sameSite: "lax" });
    return response;
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
