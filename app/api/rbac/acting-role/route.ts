import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import {
  ACTING_ROLE_COOKIE,
  clampActingRole,
  resolveRealRole,
} from "@/lib/auth/effectiveRole";

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
  try {
    const payload = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const realRole = await resolveRealRole(supabase, companyId, userId);

    if (!realRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const effectiveRole = clampActingRole(realRole, parsed.data.role);
    if (effectiveRole !== parsed.data.role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const response = NextResponse.json({ item: { role: effectiveRole }, success: true });
    response.cookies.set(ACTING_ROLE_COOKIE, effectiveRole, { path: "/", sameSite: "lax" });
    if (process.env.NODE_ENV !== "production" || process.env.E2E === "true") {
      response.cookies.set("e2e_role", effectiveRole, { path: "/", sameSite: "lax" });
    }
    return response;
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
