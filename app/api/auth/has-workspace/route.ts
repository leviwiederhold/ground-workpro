import { supabaseServer } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/http/rateLimit";

export const runtime = "nodejs";

/**
 * GET /api/auth/has-workspace
 *
 * Returns whether the authenticated user belongs to at least one company
 * workspace (has an accepted membership row).
 *
 * Used by the native app to decide whether to route into the dashboard or
 * show the "Continue on Web" screen (for brand-new CEO accounts that have
 * not yet created a company workspace on the web).
 *
 * Response: { hasWorkspace: boolean }
 * 401 if not authenticated.
 */
export async function GET(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "has-workspace",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ownership and membership are both determined through the memberships table —
  // every accepted workspace member (including the CEO/owner) has a row here.
  // Pending invites do NOT have rows yet.
  const { data, error } = await supabase
    .from("memberships")
    .select("company_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[has-workspace] membership lookup failed:", error.message);
    return Response.json({ error: "Failed to check workspace" }, { status: 500 });
  }

  return Response.json({ hasWorkspace: Boolean(data?.company_id) });
}
