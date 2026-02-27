import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const bodySchema = z.object({
  subscription_status: z.enum(["inactive", "trialing", "active", "past_due", "canceled"]),
  plan_type: z.string().min(1).optional(),
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
    try {
      await requireRole(["admin"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const payload = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const { supabase, companyId } = await getCompanyId();
    const updatePayload: { subscription_status: string; plan_type?: string } = {
      subscription_status: parsed.data.subscription_status,
    };

    if (parsed.data.plan_type) {
      updatePayload.plan_type = parsed.data.plan_type;
    }

    const { data, error } = await supabase
      .from("companies")
      .update(updatePayload)
      .eq("id", companyId)
      .select("plan_type, subscription_status, trial_ends_at, current_period_end")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      item: {
        plan_type: data.plan_type,
        subscription_status: data.subscription_status,
        trial_ends_at: data.trial_ends_at,
        current_period_end: data.current_period_end,
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
