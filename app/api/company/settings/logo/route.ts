import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"]);

const toDataUrl = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:${file.type};base64,${base64}`;
};

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { supabase, companyId } = await getCompanyId();
    const formData = await request.formData();
    const logo = formData.get("logo");
    if (!(logo instanceof File)) {
      return NextResponse.json({ error: "Logo file is required." }, { status: 400 });
    }
    if (!ALLOWED_CONTENT_TYPES.has(String(logo.type).toLowerCase())) {
      return NextResponse.json({ error: "Only PNG, JPEG, WEBP, or SVG logos are supported." }, { status: 400 });
    }
    if (logo.size > MAX_LOGO_SIZE_BYTES) {
      return NextResponse.json({ error: "Logo file must be 2MB or smaller." }, { status: 400 });
    }

    const dataUrl = await toDataUrl(logo);
    const updateResult = await supabase
      .from("companies")
      .update({ company_logo: dataUrl })
      .eq("id", companyId)
      .select("company_logo")
      .maybeSingle();

    if (updateResult.error) {
      return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
    }

    return NextResponse.json({ item: { company_logo: String(updateResult.data?.company_logo ?? "") } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
