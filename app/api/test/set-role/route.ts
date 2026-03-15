import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

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
  if (process.env.NODE_ENV === "production" && process.env.E2E !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const payload = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const { supabase, userId } = await getCompanyId();

    const membershipUpdate = await supabase
      .from("memberships")
      .update({ role: parsed.data.role })
      .eq("user_id", userId)
      .select("user_id");

    if (membershipUpdate.error) {
      return NextResponse.json({ error: membershipUpdate.error.message }, { status: 400 });
    }
    const response = NextResponse.json({ item: { role: parsed.data.role }, success: true });
    response.cookies.set("e2e_role", parsed.data.role, { path: "/", sameSite: "lax" });
    response.cookies.set("gw_acting_role", parsed.data.role, { path: "/", sameSite: "lax" });
    return response;
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
