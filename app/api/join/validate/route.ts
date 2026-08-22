import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isCompanySubscriptionActive } from "@/lib/billing/isCompanySubscriptionActive";
import { enforceEmployeeJoinCodeRateLimit } from "@/lib/team/joinCodeRateLimit";
import {
  employeeJoinCodeSchema,
  getEmployeeJoinCodeStatus,
  hashEmployeeJoinCode,
} from "@/lib/team/joinCode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const rateLimited = enforceRateLimit(request, {
    keyPrefix: "employee-join-code-validate",
    // Fast per-process shedding complements the authoritative database limit.
    limit: 60,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => ({}));
  const parsed = employeeJoinCodeSchema.safeParse(body?.code);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid company code" }, { status: 422 });
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Join code service is unavailable" }, { status: 503 });
  }

  const distributedRateLimit = await enforceEmployeeJoinCodeRateLimit(request, admin, {
    scope: "validate",
    limit: 20,
    windowMs: 60_000,
  });
  if (distributedRateLimit) return distributedRateLimit;

  const digest = hashEmployeeJoinCode(parsed.data);
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

  let companyActive = false;
  try {
    companyActive = await isCompanySubscriptionActive(admin, String(codeResult.data.company_id));
  } catch {
    return NextResponse.json({ error: "Unable to validate company" }, { status: 500 });
  }

  const status = getEmployeeJoinCodeStatus({
    row: {
      company_id: String(codeResult.data.company_id),
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

  const companyResult = await admin
    .from("companies")
    .select("name")
    .eq("id", codeResult.data.company_id)
    .maybeSingle();

  return NextResponse.json({
    item: {
      valid: true,
      company_name: String(companyResult.data?.name ?? ""),
      expires_at: String(codeResult.data.expires_at),
      role: "Employee",
    },
  });
}
