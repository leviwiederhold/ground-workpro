import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { isGeocodeConfigured, suggestAddresses } from "@/lib/geocode/provider";

export const dynamic = "force-dynamic";

// GET /api/geocode/suggest?q=...  — auth-gated proxy so the provider key stays
// server-side. Returns [] (with configured:false) when no provider is set.
export async function GET(request: Request) {
  try {
    await getCompanyId();
  } catch (error) {
    const status = error instanceof TenantResolverError ? error.status : 401;
    return NextResponse.json({ error: "Unauthorized", suggestions: [] }, { status });
  }

  if (!isGeocodeConfigured()) {
    return NextResponse.json({ configured: false, suggestions: [] });
  }

  const params = new URL(request.url).searchParams;
  const q = params.get("q") ?? "";
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  const bias = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  const suggestions = await suggestAddresses(q, bias);
  return NextResponse.json({ configured: true, suggestions });
}
