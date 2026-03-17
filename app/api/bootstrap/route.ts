import { supabaseServer } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { ensureCompanyHasAtLeastOneCeoMembership } from "@/lib/auth/ceoGuard";
import { upsertProfileColumns } from "@/lib/user/profileRecord";
import { sanitizeProfileFullName } from "@/lib/user/profileFields";

const COMPANY_OWNER_MEMBERSHIP_ROLE = "admin";

const normalizeMembershipRole = (value: unknown) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "operator";
  if (raw.includes("ceo") || raw.includes("admin") || raw.includes("executive")) return COMPANY_OWNER_MEMBERSHIP_ROLE;
  if (raw === "pm" || raw.includes("operations") || raw.includes("projectmanager") || raw.includes("manager")) return "pm";
  if (raw.includes("foreman")) return "foreman";
  if (raw.includes("mechanic")) return "mechanic";
  return "operator";
};

async function seedPersonalProfile(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  userId: string,
  email: string,
  metadata: Record<string, unknown> | undefined
) {
  const rawFullName = String(metadata?.full_name ?? metadata?.name ?? "").trim();
  const payload: Record<string, unknown> = {
    id: userId,
    email: email || null,
  };
  if (rawFullName) {
    payload.full_name = sanitizeProfileFullName(rawFullName, email);
  }

  const result = await upsertProfileColumns({
    supabase,
    userId,
    payload,
    selectColumns: ["full_name", "email"],
  });

  if (result.error) {
    throw new Error(result.error.message || "Failed to initialize profile");
  }
}

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
  const userEmail = String(user.email ?? "").trim().toLowerCase();
  const userMetadata =
    user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : undefined;
  const requestedCompanyName = String(userMetadata?.company_name ?? userMetadata?.company ?? "").trim();

  // Idempotent: if user already has membership, do not create duplicate company.
  const { data: existingMemberships, error: existingMembershipError } = await supabase
    .from("memberships")
    .select("company_id, role")
    .eq("user_id", user.id)
    .limit(1);

  if (existingMembershipError) {
    return errorResponse(existingMembershipError.message, 400);
  }

  if ((existingMemberships ?? []).length > 0) {
    await seedPersonalProfile(supabase, user.id, userEmail, userMetadata);
    const existingCompanyId = String(existingMemberships?.[0]?.company_id ?? "");
    if (existingCompanyId) {
      try {
        await ensureCompanyHasAtLeastOneCeoMembership(supabase, existingCompanyId);
      } catch {
        await supabase
          .from("memberships")
          .update({ role: COMPANY_OWNER_MEMBERSHIP_ROLE })
          .eq("company_id", existingCompanyId)
          .eq("user_id", user.id);
      }
    }
    return Response.json({ success: true, company_id: existingMemberships?.[0]?.company_id ?? null });
  }

  if (userEmail) {
    let linkedEmployee = await supabase
      .from("employees")
      .select("id, company_id, role")
      .ilike("email", userEmail)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (linkedEmployee.error && /created_at|Could not find the 'created_at' column/i.test(linkedEmployee.error.message || "")) {
      linkedEmployee = await supabase
        .from("employees")
        .select("id, company_id, role")
        .ilike("email", userEmail)
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
    }

    if (linkedEmployee.error) {
      return errorResponse(linkedEmployee.error.message, 400);
    }

    if (linkedEmployee.data?.company_id) {
      await seedPersonalProfile(supabase, user.id, userEmail, userMetadata);
      const membershipRole = normalizeMembershipRole(linkedEmployee.data.role);
      const { error: membershipUpsertError } = await supabase.from("memberships").upsert(
        {
          company_id: linkedEmployee.data.company_id,
          user_id: user.id,
          role: membershipRole,
        },
        { onConflict: "company_id,user_id" }
      );
      if (membershipUpsertError) {
        return errorResponse(membershipUpsertError.message, 400);
      }

      await supabase
        .from("employees")
        .update({ user_id: user.id, role: membershipRole === COMPANY_OWNER_MEMBERSHIP_ROLE ? "admin" : membershipRole })
        .eq("id", linkedEmployee.data.id)
        .eq("company_id", linkedEmployee.data.company_id);

      try {
        await ensureCompanyHasAtLeastOneCeoMembership(supabase, String(linkedEmployee.data.company_id));
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : "Failed to enforce CEO role", 400);
      }

      return Response.json({ success: true, company_id: linkedEmployee.data.company_id });
    }

    const pendingInvite = await supabase
      .from("pending_invitations")
      .select("id")
      .ilike("email", userEmail)
      .is("accepted_at", null)
      .limit(1)
      .maybeSingle();
    if (!pendingInvite.error && pendingInvite.data?.id) {
      return errorResponse("Pending invite must be accepted before creating a new company", 409);
    }
  }

  // 1) Ensure profile exists
  await seedPersonalProfile(supabase, user.id, userEmail, userMetadata);

  // 2) Create company
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({ name: requestedCompanyName || "My First Company" })
    .select()
    .single();

  if (companyError) {
    return errorResponse(companyError.message, 400);
  }

  // The memberships table stores company owners as "admin"; app role normalization
  // still treats admin as the top-level CEO/executive role.
  const { error: membershipError } = await supabase.from("memberships").insert({
    company_id: company.id,
    user_id: user.id,
    role: COMPANY_OWNER_MEMBERSHIP_ROLE,
  });

  if (membershipError) {
    return errorResponse(membershipError.message, 400);
  }

  try {
    await ensureCompanyHasAtLeastOneCeoMembership(supabase, String(company.id));
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to enforce CEO role", 400);
  }

  return Response.json({ success: true, company });
}
