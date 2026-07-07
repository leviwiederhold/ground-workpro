import { supabaseServer } from "@/lib/supabase/server";
import { errorResponse } from "@/lib/http/errorResponse";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { ensureCompanyHasAtLeastOneCeoMembership } from "@/lib/auth/ceoGuard";
import { upsertProfileColumns } from "@/lib/user/profileRecord";
import { sanitizeProfileFullName } from "@/lib/user/profileFields";
import { getStripe } from "@/lib/billing/stripe";

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
  };
  if (rawFullName) {
    payload.full_name = sanitizeProfileFullName(rawFullName, email);
  }

  const result = await upsertProfileColumns({
    supabase,
    userId,
    payload,
    selectColumns: ["full_name"],
  });

  if (result.error) {
    throw new Error(result.error.message || "Failed to initialize profile");
  }
}

const isMissingSchemaError = (message: string | undefined) =>
  /(column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table)/i.test(
    message ?? ""
  );

async function runBestEffort(label: string, task: () => Promise<unknown>, timeoutMs = 2500) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task(),
      new Promise((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[bootstrap] ${label} failed`, error);
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function loadStripeCheckoutBilling(stripeSessionId: string | null) {
  if (!stripeSessionId) return null;

  const session = await getStripe().checkout.sessions.retrieve(stripeSessionId, {
    expand: ["subscription"],
  });
  if (session.mode !== "subscription" || session.status !== "complete") return null;

  const subscription =
    typeof session.subscription === "string"
      ? await getStripe().subscriptions.retrieve(session.subscription)
      : session.subscription;
  if (!subscription) return null;

  return {
    stripe_customer_id: typeof session.customer === "string" ? session.customer : session.customer?.id,
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
    plan_type: "groundwork_pro",
    trial_ends_at: typeof subscription.trial_end === "number" ? new Date(subscription.trial_end * 1000).toISOString() : null,
    current_period_end:
      typeof subscription.items.data[0]?.current_period_end === "number"
        ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
        : null,
  };
}

async function applyStripeCheckoutBilling(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  companyId: string,
  stripeSessionId: string | null
) {
  const billing = await loadStripeCheckoutBilling(stripeSessionId);
  if (!billing) return;

  const result = await supabase.from("companies").update(billing).eq("id", companyId);
  if (result.error && !isMissingSchemaError(result.error.message)) {
    throw new Error(result.error.message || "Failed to attach Stripe billing");
  }
}

async function ensureCompanyBootstrapDefaults(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  companyId: string,
  metadata: Record<string, unknown> | undefined
) {
  // Never auto-default the company timezone. A timezone (with the company name)
  // marks company setup "derived complete", which would let a brand-new owner
  // skip /setup. Only honor a timezone the user explicitly provided at signup;
  // otherwise leave it empty so onboarding routes the owner to /setup.
  const explicitTimezone = String(metadata?.timezone ?? "").trim();
  if (!explicitTimezone) return;

  const companyResult = await supabase
    .from("companies")
    .select("timezone")
    .eq("id", companyId)
    .maybeSingle();

  if (companyResult.error) {
    if (isMissingSchemaError(companyResult.error.message)) return;
    throw new Error(companyResult.error.message || "Failed to load company defaults");
  }

  const currentTimezone = String(companyResult.data?.timezone ?? "").trim();
  if (currentTimezone) return;

  const updateResult = await supabase
    .from("companies")
    .update({ timezone: explicitTimezone })
    .eq("id", companyId);
  if (updateResult.error && !isMissingSchemaError(updateResult.error.message)) {
    throw new Error(updateResult.error.message || "Failed to initialize company timezone");
  }
}

export async function POST(request: Request) {
  try {
    const rateLimited = enforceRateLimit(request, {
      keyPrefix: "auth-bootstrap",
      limit: 30,
      windowMs: 60_000,
    });
    if (rateLimited) return rateLimited;

    const supabase = await supabaseServer();
    const body = await request.json().catch(() => ({}));
    const stripeSessionId =
      body && typeof body === "object" && "stripeSessionId" in body
        ? String((body as { stripeSessionId?: unknown }).stripeSessionId ?? "").trim() || null
        : null;

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
      const existingCompanyId = String(existingMemberships?.[0]?.company_id ?? "");
      if (existingCompanyId) {
        void runBestEffort("existing member maintenance", async () => {
          await seedPersonalProfile(supabase, user.id, userEmail, userMetadata);
          await ensureCompanyBootstrapDefaults(supabase, existingCompanyId, userMetadata);
          await applyStripeCheckoutBilling(supabase, existingCompanyId, stripeSessionId);
          try {
            await ensureCompanyHasAtLeastOneCeoMembership(supabase, existingCompanyId);
          } catch {
            await supabase
              .from("memberships")
              .update({ role: COMPANY_OWNER_MEMBERSHIP_ROLE })
              .eq("company_id", existingCompanyId)
              .eq("user_id", user.id);
          }
        });
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
        await ensureCompanyBootstrapDefaults(supabase, String(linkedEmployee.data.company_id), userMetadata);
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

    // ── Defense-in-depth owner guard ───────────────────────────────────────
    // Company bootstrap is ONLY for brand-new OWNER accounts that have no
    // company association of any kind. The branches above already return early
    // for members, linked employees, and pending invites; this is an explicit
    // re-assertion right at the create-company path so a future refactor can
    // never let an invited employee / existing member fall through and create a
    // (duplicate) company. Re-checks membership, employee-row, and pending
    // invite, then rejects anything that is an employee/member candidate.
    {
      const [membershipReassert, employeeReassert, pendingReassert] = await Promise.all([
        supabase.from("memberships").select("company_id").eq("user_id", user.id).limit(1),
        userEmail
          ? supabase.from("employees").select("id").ilike("email", userEmail).not("company_id", "is", null).limit(1)
          : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
        userEmail
          ? supabase.from("pending_invitations").select("id").ilike("email", userEmail).is("accepted_at", null).limit(1)
          : Promise.resolve({ data: [], error: null } as { data: unknown[]; error: null }),
      ]);
      const hasMembership = ((membershipReassert.data as unknown[]) ?? []).length > 0;
      const hasEmployeeRow = ((employeeReassert.data as unknown[]) ?? []).length > 0;
      const hasPendingInvite = ((pendingReassert.data as unknown[]) ?? []).length > 0;
      if (hasMembership || hasEmployeeRow || hasPendingInvite) {
        // This user belongs to (or was invited to) a company — they are an
        // employee/member candidate, NOT a new owner. Never create a company.
        return errorResponse(
          "This account is associated with an existing company. Accept your invitation or sign in instead.",
          409
        );
      }
    }

    // 1) Ensure profile exists
    await seedPersonalProfile(supabase, user.id, userEmail, userMetadata);

    // 2) Create company
    const { data: company, error: companyError } = await supabase
      .from("companies")
      // Do NOT auto-set a default timezone here. A timezone (plus company name)
      // would mark company setup "derived complete" and let a brand-new owner
      // skip /setup. The owner sets the timezone during onboarding instead.
      .insert({ name: requestedCompanyName || "My First Company", timezone: "" })
      .select()
      .single();

    if (companyError) {
      return errorResponse(companyError.message, 400);
    }
    await applyStripeCheckoutBilling(supabase, String(company.id), stripeSessionId);

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
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : "Failed to initialize company", 500);
  }
}
