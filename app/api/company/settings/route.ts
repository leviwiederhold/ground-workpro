import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { markSetupStepCompleted } from "@/lib/onboarding/setupFlow";
import {
  DEFAULT_EARLY_ARRIVAL_WINDOW_MINUTES,
  DEFAULT_LATE_GRACE_MINUTES,
} from "@/lib/jobsite-time/domain";
import {
  earlyArrivalWindowField,
  geofenceRadiusField,
  getMissingCompanyConfigFields,
  lateGraceField,
  parseWorkDays,
  parseWorkTime,
  resolveGeofenceRadiusFeet,
  timezoneField,
  workDaysField,
  workTimeField,
} from "@/lib/company/companyConfig";

// Company name is required; the work-schedule / attendance fields reuse the
// SAME canonical validators as onboarding setup so timezone and work-hour
// validation are provably identical in both flows. They are `.optional()` here
// only so a partial "Save Changes" doesn't force every field on every write —
// but any value that IS present is validated by the identical rule.
const companySettingsSchema = z.object({
  company_name: z.string().trim().min(1, "Company name is required.").max(160),
  timezone: timezoneField.optional().or(z.literal("")),
  default_work_days: workDaysField.optional(),
  default_work_start_time: workTimeField.optional(),
  default_work_end_time: workTimeField.optional(),
  attendance_early_arrival_window_minutes: earlyArrivalWindowField.optional(),
  attendance_late_grace_minutes: lateGraceField.optional(),
  jobsite_geofence_radius_feet: geofenceRadiusField.optional(),
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
  default_work_days?: string[] | null;
  default_work_start_time?: string | null;
  default_work_end_time?: string | null;
  attendance_early_arrival_window_minutes?: number | null;
  attendance_late_grace_minutes?: number | null;
  jobsite_geofence_radius_feet?: number | null;
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

// Reflect the TRUE stored state. Required work-schedule fields return "" / []
// when unconfigured (never a fabricated default) so Setup, Settings, and the
// completion prompt all agree on what is actually missing. Optional tuning
// knobs (early/late/geofence) carry sensible defaults.
function normalizeCompanySettings(row: CompanySettingsRow | null | undefined) {
  return {
    company_name: String(row?.name ?? "").trim(),
    timezone: String(row?.timezone ?? "").trim(),
    default_work_days: parseWorkDays(row?.default_work_days) ?? [],
    default_work_start_time: parseWorkTime(row?.default_work_start_time) ?? "",
    default_work_end_time: parseWorkTime(row?.default_work_end_time) ?? "",
    attendance_early_arrival_window_minutes: Number(
      row?.attendance_early_arrival_window_minutes ?? DEFAULT_EARLY_ARRIVAL_WINDOW_MINUTES
    ),
    attendance_late_grace_minutes: Number(
      row?.attendance_late_grace_minutes ?? DEFAULT_LATE_GRACE_MINUTES
    ),
    jobsite_geofence_radius_feet: resolveGeofenceRadiusFeet(row?.jobsite_geofence_radius_feet),
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

const SELECT_COLUMNS =
  "id,name,timezone,phone,email,address,website,industry,employee_count,default_work_hours,currency,date_format,company_logo" +
  ",default_work_days,default_work_start_time,default_work_end_time,attendance_early_arrival_window_minutes,attendance_late_grace_minutes,jobsite_geofence_radius_feet";

async function selectCompanyRow(supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"], companyId: string) {
  let result = await supabase
    .from("companies")
    .select(SELECT_COLUMNS)
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

// The response always advertises which REQUIRED company-config fields are still
// missing, so the CEO completion prompt can target exactly those.
function withMissingConfig(row: CompanySettingsRow | null | undefined) {
  return {
    item: normalizeCompanySettings(row),
    missingConfig: getMissingCompanyConfigFields(row),
  };
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
    return NextResponse.json(withMissingConfig(result.data as unknown as CompanySettingsRow));
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
    // Non-schedule company fields are always written. Work-schedule columns are
    // only written when the caller actually sent them, so a partial save never
    // nulls out existing config or invents a default.
    const updatePayload: Record<string, unknown> = {
      name: payload.company_name,
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
    if (payload.timezone !== undefined) updatePayload.timezone = payload.timezone || null;
    if (payload.default_work_days !== undefined) {
      updatePayload.default_work_days = parseWorkDays(payload.default_work_days);
    }
    if (payload.default_work_start_time !== undefined) {
      updatePayload.default_work_start_time = parseWorkTime(payload.default_work_start_time);
    }
    if (payload.default_work_end_time !== undefined) {
      updatePayload.default_work_end_time = parseWorkTime(payload.default_work_end_time);
    }
    if (payload.attendance_early_arrival_window_minutes !== undefined) {
      updatePayload.attendance_early_arrival_window_minutes = payload.attendance_early_arrival_window_minutes;
    }
    if (payload.attendance_late_grace_minutes !== undefined) {
      updatePayload.attendance_late_grace_minutes = payload.attendance_late_grace_minutes;
    }
    if (payload.jobsite_geofence_radius_feet !== undefined) {
      updatePayload.jobsite_geofence_radius_feet = payload.jobsite_geofence_radius_feet;
    }

    let result: {
      data: CompanySettingsRow | null;
      error: { message?: string } | null;
    } = await supabase
      .from("companies")
      .update(updatePayload)
      .eq("id", companyId)
      .select(SELECT_COLUMNS)
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

    return NextResponse.json(withMissingConfig(result.data as CompanySettingsRow));
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
