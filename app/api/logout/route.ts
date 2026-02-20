import { supabaseServer } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "auth-logout",
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signOut();

  if (error) {
    return errorResponse(error.message, 400);
  }

  return Response.json({ success: true });
}
