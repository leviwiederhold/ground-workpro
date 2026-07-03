import { NextResponse } from "next/server";
import { getPlatformAdmin, PlatformAdminError } from "@/lib/auth/platformAdmin";
import { getStripe, isStripeConfigured } from "@/lib/billing/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ADMIN_OVERRIDE_SELECT_COLUMNS, mapCompanyOverride } from "@/lib/billing/adminOverrideMap";

export const dynamic = "force-dynamic";

type SupabaseAdmin = NonNullable<ReturnType<typeof getSupabaseAdmin>>;

type SearchMatch = {
  source: string;
  email: string | null;
  user_id?: string | null;
  employee_id?: string | null;
  stripe_customer_id?: string | null;
  company_id?: string | null;
  note?: string;
};

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isEmailLike(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function mergeMatchesByCompany(matches: SearchMatch[]) {
  const byCompany = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const companyId = String(match.company_id ?? "").trim();
    if (!companyId) continue;
    byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), match]);
  }
  return byCompany;
}

function isMissingSchemaError(message: string | undefined) {
  return /column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table|schema cache/i.test(
    message ?? ""
  );
}

function ilikePattern(value: string) {
  return value.replace(/[%,()]/g, " ");
}

async function findAuthUsersByEmail(admin: SupabaseAdmin, email: string): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  try {
    // Supabase Auth has no indexed email lookup in this client version. Keep this
    // bounded and exact-match only; admin-only diagnostic search, not user-facing.
    for (let page = 1; page <= 20; page += 1) {
      const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (result.error) {
        matches.push({ source: "auth", email, note: result.error.message });
        break;
      }

      const users = result.data.users ?? [];
      for (const user of users) {
        const userEmail = normalizeEmail(user.email);
        if (userEmail === email) {
          matches.push({ source: "auth", email: userEmail, user_id: user.id });
        }
      }

      if (users.length < 1000) break;
    }
  } catch (error) {
    matches.push({
      source: "auth",
      email,
      note: error instanceof Error ? error.message : "Failed to search auth users",
    });
  }
  return matches;
}

async function findProfileMatches(admin: SupabaseAdmin, email: string, userIds: string[]): Promise<SearchMatch[]> {
  const matches: SearchMatch[] = [];
  if (userIds.length > 0) {
    const byId = await admin.from("profiles").select("id, email").in("id", userIds);
    if (!byId.error) {
      for (const row of byId.data ?? []) {
        matches.push({
          source: "profile",
          email: normalizeEmail((row as { email?: unknown }).email) || email,
          user_id: String((row as { id?: unknown }).id ?? ""),
        });
      }
    } else if (!isMissingSchemaError(byId.error.message)) {
      matches.push({ source: "profile", email, note: byId.error.message });
    } else {
      const byIdNoEmail = await admin.from("profiles").select("id").in("id", userIds);
      if (!byIdNoEmail.error) {
        for (const row of byIdNoEmail.data ?? []) {
          matches.push({ source: "profile", email, user_id: String((row as { id?: unknown }).id ?? "") });
        }
      }
    }
  }

  const byEmail = await admin.from("profiles").select("id, email").ilike("email", email).limit(50);
  if (!byEmail.error) {
    for (const row of byEmail.data ?? []) {
      matches.push({
        source: "profile",
        email: normalizeEmail((row as { email?: unknown }).email) || email,
        user_id: String((row as { id?: unknown }).id ?? ""),
      });
    }
  } else if (!isMissingSchemaError(byEmail.error.message)) {
    matches.push({ source: "profile", email, note: byEmail.error.message });
  }

  return matches;
}

async function findMembershipMatches(admin: SupabaseAdmin, userIds: string[], email: string): Promise<SearchMatch[]> {
  if (userIds.length === 0) return [];
  const result = await admin
    .from("memberships")
    .select("company_id, user_id, role")
    .in("user_id", userIds)
    .limit(100);

  if (result.error) {
    return [{ source: "membership", email, note: result.error.message }];
  }

  return (result.data ?? []).map((row) => ({
    source: String((row as { role?: unknown }).role ?? "").trim()
      ? `membership:${String((row as { role?: unknown }).role).trim()}`
      : "membership",
    email,
    user_id: String((row as { user_id?: unknown }).user_id ?? ""),
    company_id: String((row as { company_id?: unknown }).company_id ?? ""),
  }));
}

async function findEmployeeMatches(admin: SupabaseAdmin, email: string): Promise<SearchMatch[]> {
  const result = await admin
    .from("employees")
    .select("id, company_id, user_id, email, role")
    .ilike("email", email)
    .limit(100);

  if (result.error) {
    return isMissingSchemaError(result.error.message)
      ? []
      : [{ source: "employee", email, note: result.error.message }];
  }

  return (result.data ?? []).map((row) => ({
    source: String((row as { role?: unknown }).role ?? "").trim()
      ? `employee:${String((row as { role?: unknown }).role).trim()}`
      : "employee",
    email: normalizeEmail((row as { email?: unknown }).email) || email,
    user_id: String((row as { user_id?: unknown }).user_id ?? "") || null,
    employee_id: String((row as { id?: unknown }).id ?? "") || null,
    company_id: String((row as { company_id?: unknown }).company_id ?? "") || null,
  }));
}

async function findStripeCustomerMatches(admin: SupabaseAdmin, email: string): Promise<SearchMatch[]> {
  if (!isStripeConfigured()) return [];

  try {
    const stripe = getStripe();
    const escaped = email.replace(/['\\]/g, "\\$&");
    const customers = await stripe.customers.search({
      query: `email:'${escaped}'`,
      limit: 10,
    });
    const customerIds = customers.data.map((customer) => customer.id);
    if (customerIds.length === 0) return [];

    const companies = await admin
      .from("companies")
      .select("id, stripe_customer_id")
      .in("stripe_customer_id", customerIds);
    const companyByCustomer = new Map(
      (companies.data ?? []).map((row) => [
        String((row as { stripe_customer_id?: unknown }).stripe_customer_id ?? ""),
        String((row as { id?: unknown }).id ?? ""),
      ])
    );

    return customers.data.map((customer) => ({
      source: "stripe_customer",
      email: normalizeEmail(customer.email) || email,
      stripe_customer_id: customer.id,
      company_id: companyByCustomer.get(customer.id) ?? null,
      note: companyByCustomer.has(customer.id) ? undefined : "Stripe customer has no matching local company",
    }));
  } catch (error) {
    return [{
      source: "stripe_customer",
      email,
      note: error instanceof Error ? error.message : "Failed to search Stripe customers",
    }];
  }
}

async function resolveEmailSearch(admin: SupabaseAdmin, email: string) {
  const authMatches = await findAuthUsersByEmail(admin, email);
  const authUserIds = uniqueStrings(authMatches.map((match) => match.user_id));
  const profileMatches = await findProfileMatches(admin, email, authUserIds);
  const userIds = uniqueStrings([...authUserIds, ...profileMatches.map((match) => match.user_id)]);
  const [membershipMatches, employeeMatches, stripeMatches] = await Promise.all([
    findMembershipMatches(admin, userIds, email),
    findEmployeeMatches(admin, email),
    findStripeCustomerMatches(admin, email),
  ]);

  const matches = [
    ...authMatches,
    ...profileMatches,
    ...membershipMatches,
    ...employeeMatches,
    ...stripeMatches,
  ];

  return {
    email,
    matches,
    companyIds: uniqueStrings(matches.map((match) => match.company_id)),
  };
}

async function loadCompanies(admin: SupabaseAdmin, companyIds: string[], q: string) {
  if (companyIds.length === 0 && !q) {
    return admin
      .from("companies")
      .select(ADMIN_OVERRIDE_SELECT_COLUMNS)
      .order("name", { ascending: true })
      .limit(50);
  }

  const directPattern = ilikePattern(q);
  const directQuery = admin
    .from("companies")
    .select(ADMIN_OVERRIDE_SELECT_COLUMNS)
    .order("name", { ascending: true })
    .limit(50);

  if (companyIds.length > 0 && q) {
    return directQuery.or(`id.in.(${companyIds.join(",")}),name.ilike.%${directPattern}%,email.ilike.%${directPattern}%`);
  }
  if (companyIds.length > 0) {
    return directQuery.in("id", companyIds);
  }
  return directQuery.or(`name.ilike.%${directPattern}%,email.ilike.%${directPattern}%`);
}

// GET /api/admin/billing-overrides?q=...  — platform-admin only.
// Lists/searches companies with their current Stripe status + billing override
// (including the internal reason, which is admin-only).
export async function GET(request: Request) {
  try {
    await getPlatformAdmin();
  } catch (error) {
    const status = error instanceof PlatformAdminError ? error.status : 403;
    return NextResponse.json({ error: status === 401 ? "Not authenticated" : "Forbidden" }, { status });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin client unavailable" }, { status: 500 });
  }

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") ?? "").trim();
  const normalizedEmail = normalizeEmail(q);
  const emailSearch = q && isEmailLike(normalizedEmail)
    ? await resolveEmailSearch(admin, normalizedEmail)
    : null;

  const result = await loadCompanies(admin, emailSearch?.companyIds ?? [], q);
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 400 });
  }

  const matchesByCompany = mergeMatchesByCompany(emailSearch?.matches ?? []);
  const items = (result.data ?? []).map((row) => {
    const mapped = mapCompanyOverride(row);
    const search_matches = matchesByCompany.get(String(mapped.company_id)) ?? [];
    return {
      ...mapped,
      search_matches,
      contact_email:
        search_matches.find((match) => match.email)?.email ||
        String(mapped.email ?? "").trim() ||
        null,
    };
  });

  const orphanMatches = (emailSearch?.matches ?? []).filter((match) => !String(match.company_id ?? "").trim());
  return NextResponse.json({
    items,
    diagnostic: emailSearch
      ? {
          email: emailSearch.email,
          auth_user_exists: emailSearch.matches.some((match) => match.source === "auth" && match.user_id),
          profile_exists: emailSearch.matches.some((match) => match.source === "profile" && match.user_id),
          membership_exists: emailSearch.matches.some((match) => match.source.startsWith("membership") && match.company_id),
          employee_exists: emailSearch.matches.some((match) => match.source.startsWith("employee")),
          stripe_customer_exists: emailSearch.matches.some((match) => match.source === "stripe_customer" && match.stripe_customer_id),
          company_found: items.length > 0,
          orphaned: items.length === 0 && orphanMatches.length > 0,
          orphan_matches: orphanMatches,
        }
      : null,
  });
}
