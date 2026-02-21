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
  if (process.env.E2E !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const payload = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const supabaseAdmin = getSupabaseAdmin();
    const client = supabaseAdmin ?? supabase;

    const { data: updated, error } = await client
      .from("memberships")
      .update({ role: parsed.data.role })
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .select("company_id, user_id, role")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (!updated) {
      return NextResponse.json({ error: "Membership not found" }, { status: 404 });
    }

    return NextResponse.json({
      item: {
        company_id: updated.company_id,
        user_id: updated.user_id,
        role: updated.role,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
