import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const bodySchema = z.object({
  subscription_status: z.enum(["inactive", "trialing", "active", "past_due", "canceled"]),
  plan_type: z.string().min(1).optional(),
});

const toValidationError = (issues: { path: (string | number)[]; message: string }[]) => ({
  error: "Validation error",
  details: issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  })),
});

function parseCookieHeader(cookieHeader: string | null) {
  const map = new Map<string, string>();
  for (const part of String(cookieHeader ?? "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    map.set(rawName, rawValue.join("="));
  }
  return map;
}

function getUserIdFromSupabaseCookie(request: Request): string | null {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const tokenEntry = Array.from(cookies.entries()).find(([name]) => name.endsWith("-auth-token"));
  if (!tokenEntry) return null;
  const raw = decodeURIComponent(tokenEntry[1] ?? "");
  const encoded = raw.startsWith("base64-") ? raw.slice("base64-".length) : null;
  if (!encoded) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const userId = payload?.user?.id;
    return typeof userId === "string" && userId ? userId : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const admin = getSupabaseAdmin();
    try {
      await requireRole(["admin"]);
    } catch {
      if (!admin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const payload = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json(toValidationError(parsed.error.issues), { status: 422 });
    }

    let supabase;
    let companyId: string | null = null;
    const fallbackUserId = getUserIdFromSupabaseCookie(request);
    try {
      const tenant = await getCompanyId();
      supabase = tenant.supabase;
      companyId = tenant.companyId;
    } catch (error) {
      if (!admin) throw error;
      if (!fallbackUserId) throw error;
      const membershipLookup = await admin
        .from("memberships")
        .select("company_id")
        .eq("user_id", fallbackUserId)
        .limit(1)
        .maybeSingle();
      if (membershipLookup.error || !membershipLookup.data?.company_id) {
        throw error;
      }
      supabase = admin;
      companyId = String(membershipLookup.data.company_id);
    }
    if ((!companyId || companyId === "null" || companyId === "undefined") && admin && fallbackUserId) {
      const membershipLookup = await admin
        .from("memberships")
        .select("company_id")
        .eq("user_id", fallbackUserId)
        .limit(1)
        .maybeSingle();
      if (membershipLookup.data?.company_id) {
        supabase = admin;
        companyId = String(membershipLookup.data.company_id);
      }
    }
    const updatePayload: { subscription_status: string; plan_type?: string } = {
      subscription_status: parsed.data.subscription_status,
    };

    if (parsed.data.plan_type) {
      updatePayload.plan_type = parsed.data.plan_type;
    }

    const { data, error } = await supabase
      .from("companies")
      .update(updatePayload)
      .eq("id", companyId)
      .select("plan_type, subscription_status, trial_ends_at, current_period_end");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return NextResponse.json({
        item: {
          plan_type: parsed.data.plan_type ?? "starter",
          subscription_status: parsed.data.subscription_status,
          trial_ends_at: null,
          current_period_end: null,
        },
      });
    }

    return NextResponse.json({
      item: {
        plan_type: row.plan_type,
        subscription_status: row.subscription_status,
        trial_ends_at: row.trial_ends_at,
        current_period_end: row.current_period_end,
      },
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
