import { supabaseServer } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "auth-bootstrap",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const supabase = await supabaseServer();

  // Get current user
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return errorResponse("Not authenticated", 401);
  }

  const user = userData.user;

  // Idempotent: if user already has membership, do not create duplicate company.
  const { data: existingMemberships, error: existingMembershipError } = await supabase
    .from("memberships")
    .select("company_id")
    .eq("user_id", user.id)
    .limit(1);

  if (existingMembershipError) {
    return errorResponse(existingMembershipError.message, 400);
  }

  if ((existingMemberships ?? []).length > 0) {
    return Response.json({ success: true, company_id: existingMemberships?.[0]?.company_id ?? null });
  }

  // 1) Ensure profile exists
  await supabase.from("profiles").upsert({
    id: user.id,
    full_name: user.email,
  });

  // 2) Create company
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({ name: "My First Company" })
    .select()
    .single();

  if (companyError) {
    return errorResponse(companyError.message, 400);
  }

  // 3) Create membership as admin
  const { error: membershipError } = await supabase.from("memberships").insert({
    company_id: company.id,
    user_id: user.id,
    role: "admin",
  });

  if (membershipError) {
    return errorResponse(membershipError.message, 400);
  }

  return Response.json({ success: true, company });
}
