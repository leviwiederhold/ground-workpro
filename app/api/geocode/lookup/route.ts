import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { isGeocodeConfigured, resolvePlace } from "@/lib/geocode/provider";

export const dynamic = "force-dynamic";
const GEO_ROUTE_TIMEOUT_MS = 6000;

async function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), GEO_ROUTE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

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

  const result = await withTimeout(resolvePlace(placeId, q), null);
  return NextResponse.json({ configured: true, result });
}
