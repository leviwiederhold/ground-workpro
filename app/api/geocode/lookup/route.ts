import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { isGeocodeConfigured, resolvePlace } from "@/lib/geocode/provider";

export const dynamic = "force-dynamic";

// GET /api/geocode/lookup?placeId=...&q=...  — resolve a suggestion to verified
// coordinates + formatted address, server-side.
export async function GET(request: Request) {
  try {
    await getCompanyId();
  } catch (error) {
    const status = error instanceof TenantResolverError ? error.status : 401;
    return NextResponse.json({ error: "Unauthorized" }, { status });
  }

  if (!isGeocodeConfigured()) {
    return NextResponse.json({ configured: false, result: null });
  }

  const url = new URL(request.url);
  const placeId = url.searchParams.get("placeId") ?? "";
  const q = url.searchParams.get("q") ?? "";
  if (!placeId && !q) {
    return NextResponse.json({ error: "placeId or q required" }, { status: 400 });
  }

  const result = await resolvePlace(placeId, q);
  return NextResponse.json({ configured: true, result });
}
