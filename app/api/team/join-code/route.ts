import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  createEmployeeJoinCodeTimes,
  generateEmployeeJoinCode,
  hashEmployeeJoinCode,
} from "@/lib/team/joinCode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SELECT_COLUMNS = "company_id, code, created_at, expires_at";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}
export async function GET() {
  try {
    await requireRole(["admin"]);
    const { supabase, companyId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;
    const result = await db
      .from("company_employee_join_codes")
      .select(SELECT_COLUMNS)
      .eq("company_id", companyId)
      .maybeSingle();

    if (result.error) {
      return noStoreJson({ error: result.error.message }, { status: 400 });
    }

    const row = result.data;
    return noStoreJson({
      item: row
        ? {
            code: String(row.code),
            created_at: String(row.created_at),
            expires_at: String(row.expires_at),
            expired: Date.parse(String(row.expires_at)) <= Date.now(),
          }
        : null,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return noStoreJson({ error: error.message }, { status: error.status });
    }
    return noStoreJson({ error: "Forbidden" }, { status: 403 });
  }
}

export async function POST() {
  try {
    const actor = await requireRole(["admin"]);
    const { supabase, companyId } = await getCompanyId();
    const db = getSupabaseAdmin() ?? supabase;

    // A digest collision is extraordinarily unlikely, but retrying keeps the
    // unique index from turning it into a user-facing generation failure.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generateEmployeeJoinCode();
      const { createdAt, expiresAt } = createEmployeeJoinCodeTimes();
      const result = await db
        .from("company_employee_join_codes")
        .upsert(
          {
            company_id: companyId,
            code,
            code_digest: hashEmployeeJoinCode(code),
            created_by: actor.userId,
            created_at: createdAt,
            expires_at: expiresAt,
          },
          { onConflict: "company_id" }
        )
        .select(SELECT_COLUMNS)
        .single();

      if (!result.error && result.data) {
        return noStoreJson({
          item: {
            code: String(result.data.code),
            created_at: String(result.data.created_at),
            expires_at: String(result.data.expires_at),
            expired: false,
          },
        });
      }

      if (!/code_digest|duplicate key|unique/i.test(result.error?.message ?? "")) {
        return noStoreJson({ error: result.error?.message || "Failed to generate join code" }, { status: 400 });
      }
    }

    return noStoreJson({ error: "Failed to generate a unique join code" }, { status: 503 });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return noStoreJson({ error: error.message }, { status: error.status });
    }
    return noStoreJson({ error: "Forbidden" }, { status: 403 });
  }
}
