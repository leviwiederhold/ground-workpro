import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const paramsSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
});

const patchSchema = z.object({
  action: z.enum(["lock"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json({ error: "Validation error", details: parsedParams.error.flatten() }, { status: 422 });
    }
    const parsedBody = patchSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "Validation error", details: parsedBody.error.flatten() }, { status: 422 });
    }

    const { supabase, companyId } = await getCompanyId();
    const updateRes = await supabase
      .from("bid_estimate_versions")
      .update({
        status: "locked",
        locked_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("bid_id", parsedParams.data.id)
      .eq("id", parsedParams.data.versionId)
      .eq("status", "draft")
      .select("*")
      .maybeSingle();
    if (updateRes.error) return NextResponse.json({ error: updateRes.error.message }, { status: 400 });
    if (!updateRes.data) {
      return NextResponse.json({ error: "Version not found or already locked" }, { status: 404 });
    }
    return NextResponse.json({ item: updateRes.data });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
