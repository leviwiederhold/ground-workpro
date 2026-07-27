import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { mintDeviceCredential, revokeDeviceCredential } from "@/lib/attendance/deviceCredentialServer";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  deviceId: z.string().min(8).max(200),
  platform: z.enum(["ios", "android", "web", "unknown"]).optional(),
});
const deleteSchema = z.object({ deviceId: z.string().min(8).max(200).optional() });

// Mint (or rotate) a device attendance credential for the signed-in employee.
// Session-authenticated (so only the real user can enroll a device); returns the
// plaintext token ONCE for storage in the Keychain/Keystore.
export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, { keyPrefix: "attendance-credential-mint", limit: 10, windowMs: 60_000 });
  if (rateLimited) return rateLimited;

  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const admin = getSupabaseAdmin() ?? supabase;
    const parsed = postSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation error", details: parsed.error.flatten() }, { status: 422 });
    }

    const employeeResult = await admin
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    const employeeId = employeeResult.data?.id ? String(employeeResult.data.id) : null;

    const minted = await mintDeviceCredential(admin, {
      companyId,
      userId,
      employeeId,
      deviceId: parsed.data.deviceId,
      platform: parsed.data.platform ?? null,
    });
    if ("error" in minted) {
      return NextResponse.json({ error: minted.error }, { status: 400 });
    }
    return NextResponse.json({
      token: minted.token,
      expiresAt: minted.expiresAt,
      credentialId: minted.credentialId,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}

// Revoke this device's credential (or all of the user's on logout when no
// deviceId is given). Session-authenticated.
export async function DELETE(request: Request) {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const admin = getSupabaseAdmin() ?? supabase;
    const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
    const deviceId = parsed.success ? parsed.data.deviceId ?? null : null;
    await revokeDeviceCredential(admin, { companyId, userId, deviceId });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
