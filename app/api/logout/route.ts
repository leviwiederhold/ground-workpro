import { supabaseServer } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { revokeAllDeviceCredentialsForUser } from "@/lib/attendance/deviceCredentialServer";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "auth-logout",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const supabase = await supabaseServer();

  // Logout cleanup: revoke this user's device attendance credentials BEFORE the
  // session is torn down, so a signed-out device can no longer submit events.
  try {
    const admin = getSupabaseAdmin();
    const { data } = await supabase.auth.getUser();
    if (admin && data.user?.id) {
      await revokeAllDeviceCredentialsForUser(admin, data.user.id);
    }
  } catch {
    // Best-effort — never block logout on credential cleanup.
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    return errorResponse(error.message, 400);
  }

  return Response.json({ success: true });
}
