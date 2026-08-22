import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { supabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isCompanySubscriptionActive } from "@/lib/billing/isCompanySubscriptionActive";
import { syncStripeQuantityForCompany } from "@/lib/billing/syncStripeQuantity";
import { upsertProfileColumns } from "@/lib/user/profileRecord";
import { sanitizeProfileFullName } from "@/lib/user/profileFields";
import { enforceEmployeeJoinCodeRateLimit } from "@/lib/team/joinCodeRateLimit";
import {
  EMPLOYEE_JOIN_MEMBERSHIP_ROLE,
  employeeJoinAcceptSchema,
  getEmployeeJoinCodeStatus,
  hashEmployeeJoinCode,
} from "@/lib/team/joinCode";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "employee-join-code-accept",
    // Fast per-process shedding complements the authoritative database limit.
    limit: 36,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => ({}));
  const parsed = employeeJoinAcceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid join request", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const supabase = await supabaseServer();
  const authResult = await supabase.auth.getUser();
  const user = authResult.data?.user;
  if (authResult.error || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Join code service is unavailable" }, { status: 503 });
  }

  const distributedRateLimit = await enforceEmployeeJoinCodeRateLimit(request, admin, {
    scope: "accept",
    limit: 12,
    windowMs: 60_000,
    subject: user.id,
  });
  if (distributedRateLimit) return distributedRateLimit;

  const digest = hashEmployeeJoinCode(parsed.data.code);
  const codeResult = await admin
    .from("company_employee_join_codes")
    .select("company_id, code_digest, created_at, expires_at")
    .eq("code_digest", digest)
    .maybeSingle();
  if (codeResult.error) {
    return NextResponse.json({ error: "Unable to validate company code" }, { status: 500 });
  }
  if (!codeResult.data) {
    return NextResponse.json({ error: "Company code not found" }, { status: 404 });
  }

  const companyId = String(codeResult.data.company_id);
  let companyActive = false;
  try {
    companyActive = await isCompanySubscriptionActive(admin, companyId);
  } catch {
    return NextResponse.json({ error: "Unable to validate company" }, { status: 500 });
  }

  const status = getEmployeeJoinCodeStatus({
    row: {
      company_id: companyId,
      code_digest: String(codeResult.data.code_digest),
      created_at: String(codeResult.data.created_at),
      expires_at: String(codeResult.data.expires_at),
    },
    submittedDigest: digest,
    companyActive,
  });
  if (status === "expired") {
    return NextResponse.json({ error: "Company code has expired" }, { status: 410 });
  }
  if (status === "company_inactive") {
    return NextResponse.json({ error: "This company is not currently active" }, { status: 403 });
  }
  if (status !== "valid") {
    return NextResponse.json({ error: "Company code not found" }, { status: 404 });
  }

  const email = String(user.email ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Account email not found" }, { status: 400 });
  }
  const rawName = String(
    parsed.data.full_name ?? user.user_metadata?.full_name ?? user.user_metadata?.name ?? ""
  ).trim();
  const fullName = rawName ? sanitizeProfileFullName(rawName, email) : email;

  const profileResult = await upsertProfileColumns({
    supabase: admin,
    userId: user.id,
    payload: { id: user.id, full_name: fullName },
    selectColumns: ["full_name"],
  });
  if (profileResult.error) {
    return NextResponse.json({ error: profileResult.error.message }, { status: 400 });
  }

  // Code validation, the one-company membership invariant, and employee
  // creation all happen inside one database transaction. The RPC rechecks the
  // code under a row lock, so a replaced code cannot win a validation race.
  const joinedAt = new Date().toISOString();
  const joinResult = await admin.rpc("accept_employee_company_join", {
    p_user_id: user.id,
    p_code_digest: digest,
    p_email: email,
    p_full_name: fullName,
    p_joined_at: joinedAt,
  });
  if (joinResult.error) {
    return NextResponse.json({ error: "Unable to join company" }, { status: 500 });
  }

  const joinRow = (Array.isArray(joinResult.data) ? joinResult.data[0] : joinResult.data) as
    | {
        join_status?: unknown;
        joined_company_id?: unknown;
        joined_employee_id?: unknown;
      }
    | null;
  const joinStatus = String(joinRow?.join_status ?? "");
  if (joinStatus === "invalid_code") {
    return NextResponse.json({ error: "Company code not found" }, { status: 404 });
  }
  if (joinStatus === "expired") {
    return NextResponse.json({ error: "Company code has expired" }, { status: 410 });
  }
  if (joinStatus === "company_inactive") {
    return NextResponse.json({ error: "This company is not currently active" }, { status: 403 });
  }
  if (joinStatus === "already_member_same" || joinStatus === "already_member_other") {
    return NextResponse.json(
      {
        error:
          joinStatus === "already_member_same"
            ? "You already belong to this company"
            : "You already belong to another company",
      },
      { status: 409 }
    );
  }
  if (joinStatus !== "joined") {
    return NextResponse.json({ error: "Invalid join request" }, { status: 422 });
  }

  const joinedCompanyId = String(joinRow?.joined_company_id ?? "");
  const employeeId = String(joinRow?.joined_employee_id ?? "");
  if (!joinedCompanyId || joinedCompanyId !== companyId || !employeeId) {
    return NextResponse.json({ error: "Unable to join company" }, { status: 500 });
  }

  try {
    await syncStripeQuantityForCompany(joinedCompanyId);
  } catch (error) {
    console.error(
      "[join/accept] stripe quantity sync failed:",
      error instanceof Error ? error.message : error
    );
  }

  return NextResponse.json({
    item: {
      success: true,
      company_id: joinedCompanyId,
      employee_id: employeeId,
      role: "Employee",
      app_role: EMPLOYEE_JOIN_MEMBERSHIP_ROLE,
    },
  });
}
