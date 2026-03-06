import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { cookies } from "next/headers";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import {
  ACTING_ROLE_COOKIE,
  clampActingRole,
  getEffectiveRole,
  resolveRealRole,
} from "@/lib/auth/effectiveRole";
import { normalizeAppRole } from "@/lib/nav/config";

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

    const requestedRole = normalizeAppRole(parsed.data.role);

    if (!requestedRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const cookieStore = await cookies();
    const e2eRole =
      process.env.NODE_ENV !== "production"
        ? normalizeAppRole(cookieStore.get("e2e_role")?.value)
        : null;

    const { supabase, companyId, userId } = await getCompanyId();
    const realRole = e2eRole ?? (await resolveRealRole(supabase, companyId, userId));

    if (!realRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // Only real admins can switch acting role view.
    if (realRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const currentEffectiveRole = e2eRole ?? (await getEffectiveRole());
    if (!currentEffectiveRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const effectiveRole = clampActingRole(realRole, requestedRole);
    const response = NextResponse.json({ item: { role: effectiveRole } });

    response.cookies.set(ACTING_ROLE_COOKIE, requestedRole, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
