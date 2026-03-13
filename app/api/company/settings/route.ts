import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { markSetupStepCompleted } from "@/lib/onboarding/setupFlow";

const companySettingsSchema = z.object({
  company_name: z.string().trim().min(1, "Company name is required.").max(160),
  timezone: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(60).optional(),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional(),
  website: z.string().trim().max(240).optional(),
  industry: z.string().trim().max(120).optional(),
  employee_count: z.coerce.number().int().min(0).max(100000).nullable().optional(),
  default_work_hours: z.string().trim().max(120).optional(),
  currency: z.string().trim().min(3).max(8).optional(),
  date_format: z.string().trim().min(4).max(40).optional(),
  company_logo: z.string().trim().max(2_000_000).optional(),
});

type CompanySettingsRow = {
  id: string;
  name: string | null;
  timezone?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  website?: string | null;
  industry?: string | null;
  employee_count?: number | null;
  default_work_hours?: string | null;
  currency?: string | null;
  date_format?: string | null;
  company_logo?: string | null;
};

function normalizeCompanySettings(row: CompanySettingsRow | null | undefined) {
  return {
    company_name: String(row?.name ?? "").trim(),
    timezone: String(row?.timezone ?? "").trim(),
    phone: String(row?.phone ?? "").trim(),
    email: String(row?.email ?? "").trim(),
    address: String(row?.address ?? "").trim(),
    website: String(row?.website ?? "").trim(),
    industry: String(row?.industry ?? "").trim(),
    employee_count:
      row?.employee_count === null || row?.employee_count === undefined
        ? null
        : Number(row.employee_count),
    default_work_hours: String(row?.default_work_hours ?? "").trim(),
    currency: String(row?.currency ?? "USD").trim() || "USD",
    date_format: String(row?.date_format ?? "MM/DD/YYYY").trim() || "MM/DD/YYYY",
    company_logo: String(row?.company_logo ?? "").trim(),
  };
}

const isMissingColumnError = (message: string | undefined) =>
  /column|Could not find the/i.test(String(message || "")) &&
  /does not exist|not find/i.test(String(message || ""));

async function selectCompanyRow(supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"], companyId: string) {
  let result = await supabase
    .from("companies")
    .select(
      "id,name,timezone,phone,email,address,website,industry,employee_count,default_work_hours,currency,date_format,company_logo"
    )
    .eq("id", companyId)
    .maybeSingle();

  if (result.error && isMissingColumnError(result.error.message)) {
    result = await supabase
      .from("companies")
      .select("id,name")
      .eq("id", companyId)
      .maybeSingle();
  }

  return result;
}

export async function GET() {
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { supabase, companyId } = await getCompanyId();
    const result = await selectCompanyRow(supabase, companyId);
    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }
    return NextResponse.json({ item: normalizeCompanySettings(result.data as CompanySettingsRow) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const body = await request.json().catch(() => null);
    const parsed = companySettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const payload = parsed.data;
    const updatePayload = {
      name: payload.company_name,
      timezone: payload.timezone || null,
      phone: payload.phone || null,
      email: payload.email || null,
      address: payload.address || null,
      website: payload.website || null,
      industry: payload.industry || null,
      employee_count:
        payload.employee_count === null || payload.employee_count === undefined
          ? null
          : Number(payload.employee_count),
      default_work_hours: payload.default_work_hours || null,
      currency: payload.currency ? String(payload.currency).toUpperCase() : "USD",
      date_format: payload.date_format || "MM/DD/YYYY",
      company_logo: payload.company_logo || null,
    };

    let result: {
      data: CompanySettingsRow | null;
      error: { message?: string } | null;
    } = await supabase
      .from("companies")
      .update(updatePayload)
      .eq("id", companyId)
      .select(
        "id,name,timezone,phone,email,address,website,industry,employee_count,default_work_hours,currency,date_format,company_logo"
      )
      .maybeSingle();

    if (result.error && isMissingColumnError(result.error.message)) {
      const fallbackUpdateResult = await supabase
        .from("companies")
        .update({ name: payload.company_name })
        .eq("id", companyId)
        .select("id,name")
        .maybeSingle();
      result = {
        data: fallbackUpdateResult.data as CompanySettingsRow | null,
        error: fallbackUpdateResult.error,
      };
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    await markSetupStepCompleted({
      supabase,
      companyId,
      userId,
      key: "complete_company_settings",
      scope: "company",
    });

    return NextResponse.json({ item: normalizeCompanySettings(result.data as CompanySettingsRow) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
