import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { moduleAccessLevelSchema, modulePermissionKeys } from "@/lib/permissions/types";
import { TEST_MODULE_ACCESS_COOKIE } from "@/lib/permissions/runtime";

const bodySchema = z.object({
  permissions: z.array(
    z.object({
      module_key: z.enum(modulePermissionKeys),
      access_level: moduleAccessLevelSchema,
    })
  ),
});

const toValidationError = (issues: z.ZodIssue[]) => ({
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
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    const { supabase, companyId, userId } = await getCompanyId();

    const deleteResult = await supabase
      .from("module_permissions")
      .delete()
      .eq("company_id", companyId)
      .eq("user_id", userId);
    const isMissingSchema =
      /Could not find the table|does not exist/i.test(deleteResult.error?.message ?? "");
    if (deleteResult.error && !isMissingSchema) {
      return NextResponse.json({ error: deleteResult.error.message }, { status: 400 });
    }

    if (parsed.data.permissions.length > 0 && !isMissingSchema) {
      const insertResult = await supabase.from("module_permissions").insert(
        parsed.data.permissions.map((entry) => ({
          company_id: companyId,
          user_id: userId,
          module_key: entry.module_key,
          access_level: entry.access_level,
          created_by: userId,
        }))
      );
      if (insertResult.error) {
        return NextResponse.json({ error: insertResult.error.message }, { status: 400 });
      }
    }

    const response = NextResponse.json({
      item: {
        user_id: userId,
        company_id: companyId,
        permissions: parsed.data.permissions,
      },
    });
    response.cookies.set(
      TEST_MODULE_ACCESS_COOKIE,
      JSON.stringify(
        Object.fromEntries(
          parsed.data.permissions.map((entry) => [entry.module_key, entry.access_level])
        )
      ),
      { path: "/", sameSite: "lax" }
    );
    return response;
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
