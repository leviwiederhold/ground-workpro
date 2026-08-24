// Which employees have broken or incomplete automatic-attendance setup.
//
// Managers need to find out that an employee's attendance will not record
// BEFORE payroll day. Everything here is derived from server-visible facts —
// assignment, jobsite verification, device enrollment, last device check-in —
// so the answer does not depend on that employee having the app open.
//
// PRIVACY: this is a setup report, not a location report. It returns no
// coordinates, no distances, and no location history — only whether the pieces
// required to record attendance exist. Do not add a position to this response.

import { NextResponse } from "next/server";
import { TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapRowToAttendanceSettings } from "@/lib/attendance/attendanceSettings";
import { summarizeSetupHealth, type EmployeeSetupInput } from "@/lib/attendance/setupHealth";
import { buildJobsiteRegions } from "@/lib/attendance/nativeGeofence";
import { feetToMeters, mapCompanyJobsiteSettings } from "@/lib/jobsite-time/domain";

export const dynamic = "force-dynamic";

const INACTIVE_STATUSES = new Set(["inactive", "deleted", "archived", "removed"]);

export async function GET() {
  try {
    const { companyId } = await requireRole(["admin", "pm"]);
    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json(
        { error: "Attendance setup health requires service access" },
        { status: 503 }
      );
    }

    const settingsRow = await admin
      .from("companies")
      .select(
        "attendance_automatic_enabled,jobsite_geofence_radius_feet,jobsite_wake_radius_meters"
      )
      .eq("id", companyId)
      .maybeSingle();
    if (settingsRow.error) {
      throw new Error(`company settings: ${settingsRow.error.message}`);
    }
    const settings = mapRowToAttendanceSettings(settingsRow.data as Record<string, unknown> | null);
    const regionSettings = mapCompanyJobsiteSettings(settingsRow.data);

    const employeesResult = await admin
      .from("employees")
      .select("id, full_name, user_id, status")
      .eq("company_id", companyId)
      .limit(500);
    if (employeesResult.error) {
      throw new Error(`employees: ${employeesResult.error.message}`);
    }
    const employees = (employeesResult.data ?? []).filter(
      (e: Record<string, unknown>) => !INACTIVE_STATUSES.has(String(e.status ?? "").toLowerCase())
    );
    if (employees.length === 0) {
      return NextResponse.json({
        items: [],
        brokenCount: 0,
        healthyCount: 0,
        configuredCount: 0,
        totalCount: 0,
      });
    }

    const employeeIds = employees.map((e: Record<string, unknown>) => String(e.id));
    const userIds = employees
      .map((e: Record<string, unknown>) => (e.user_id ? String(e.user_id) : null))
      .filter((id: string | null): id is string => Boolean(id));

    const nativeActivitySince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const [assignments, credentials, nativeActivity, permissionReports] = await Promise.all([
      admin
        .from("job_employees")
        .select("employee_id, job_id")
        .eq("company_id", companyId)
        .in("employee_id", employeeIds)
        .limit(2000),
      userIds.length > 0
        ? admin
            .from("device_attendance_credentials")
            .select("user_id, expires_at, revoked_at, last_used_at")
            .eq("company_id", companyId)
            .in("user_id", userIds)
            .is("revoked_at", null)
            .limit(2000)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      userIds.length > 0
        ? admin
            .from("jobsite_timecard_events")
            .select("user_id,occurred_at")
            .eq("company_id", companyId)
            .in("user_id", userIds)
            .in("event_source", ["native_geofence", "offline_sync"])
            .eq("validation_result", "accepted")
            .gte("occurred_at", nativeActivitySince)
            .order("occurred_at", { ascending: false })
            .limit(2000)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      userIds.length > 0
        ? admin
            .from("employee_location_permissions")
            .select(
              "user_id,location_services_enabled,background_refresh_enabled,background,precise,native_service_supported,native_service_healthy,native_has_secure_credential,required_region_ids,registered_region_ids,native_readiness_reported_at"
            )
            .eq("company_id", companyId)
            .in("user_id", userIds)
            .limit(500)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ]);
    for (const [label, result] of [
      ["assignments", assignments],
      ["credentials", credentials],
      ["native readiness", permissionReports],
      ["native activity", nativeActivity],
    ] as const) {
      if ("error" in result && result.error) {
        throw new Error(`${label}: ${result.error.message}`);
      }
    }

    const assignmentRows = (assignments.data ?? []) as Array<{
      employee_id: string;
      job_id: string;
    }>;
    const jobIds = Array.from(new Set(assignmentRows.map((a) => String(a.job_id))));
    const jobsResult =
      jobIds.length > 0
        ? await admin
            .from("jobs")
            .select("id, name, lat, lng, address_verified")
            .eq("company_id", companyId)
            .in("id", jobIds)
            .limit(2000)
        : { data: [] as Array<Record<string, unknown>> };
    if ("error" in jobsResult && jobsResult.error) {
      throw new Error(`jobs: ${jobsResult.error.message}`);
    }

    const jobById = new Map<string, Record<string, unknown>>();
    for (const job of (jobsResult.data ?? []) as Array<Record<string, unknown>>) {
      jobById.set(String(job.id), job);
    }
    const assignmentByEmployee = new Map<string, string>();
    for (const row of assignmentRows) {
      if (!assignmentByEmployee.has(String(row.employee_id))) {
        assignmentByEmployee.set(String(row.employee_id), String(row.job_id));
      }
    }
    // Keep the credential that expires furthest out — an employee may have more
    // than one device, and the healthiest one represents their setup.
    const credentialByUser = new Map<
      string,
      { expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null }
    >();
    for (const row of (credentials.data ?? []) as Array<Record<string, unknown>>) {
      const userId = String(row.user_id);
      const next = {
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        revokedAt: row.revoked_at ? String(row.revoked_at) : null,
        lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
      };
      const existing = credentialByUser.get(userId);
      if (!existing || Date.parse(next.expiresAt ?? "") > Date.parse(existing.expiresAt ?? "")) {
        credentialByUser.set(userId, next);
      }
    }
    const readinessByUser = new Map<string, Record<string, unknown>>();
    for (const row of (permissionReports.data ?? []) as Array<Record<string, unknown>>) {
      readinessByUser.set(String(row.user_id), row);
    }
    const nativeActivityByUser = new Map<string, string>();
    for (const row of (nativeActivity.data ?? []) as Array<Record<string, unknown>>) {
      const activityUserId = String(row.user_id);
      if (!nativeActivityByUser.has(activityUserId) && row.occurred_at) {
        nativeActivityByUser.set(activityUserId, String(row.occurred_at));
      }
    }

    const inputs: EmployeeSetupInput[] = employees.map((employee: Record<string, unknown>) => {
      const employeeId = String(employee.id);
      const jobId = assignmentByEmployee.get(employeeId) ?? null;
      const job = jobId ? jobById.get(jobId) : null;
      const userId = employee.user_id ? String(employee.user_id) : null;
      const readiness = userId ? readinessByUser.get(userId) : null;
      return {
        employeeId,
        userId,
        name: String(employee.full_name ?? "Team member"),
        hasAppAccess: Boolean(userId),
        hasAssignmentToday: Boolean(jobId),
        jobsiteVerified: Boolean(job?.address_verified) && job?.lat != null && job?.lng != null,
        jobName: job?.name ? String(job.name) : null,
        // Use the exact desired-state builder used by native registration. In
        // particular, it intentionally omits a redundant wake region when the
        // configured radii collapse to the same boundary.
        requiredRegionIds:
          jobId && job
            ? buildJobsiteRegions(
                {
                  jobId,
                  lat: job.lat == null ? null : Number(job.lat),
                  lng: job.lng == null ? null : Number(job.lng),
                  addressVerified: Boolean(job.address_verified),
                },
                feetToMeters(regionSettings.arrivalRadiusFeet),
                regionSettings.wakeRadiusMeters
              ).map((region) => region.identifier)
            : [],
        credential: userId ? (credentialByUser.get(userId) ?? null) : null,
        nativeReadiness: readiness
          ? {
              locationServicesEnabled:
                typeof readiness.location_services_enabled === "boolean"
                  ? readiness.location_services_enabled
                  : null,
              backgroundRefreshEnabled:
                typeof readiness.background_refresh_enabled === "boolean"
                  ? readiness.background_refresh_enabled
                  : null,
              background: String(readiness.background ?? "unknown"),
              precise: typeof readiness.precise === "boolean" ? readiness.precise : null,
              serviceSupported:
                typeof readiness.native_service_supported === "boolean"
                  ? readiness.native_service_supported
                  : null,
              serviceHealthy:
                typeof readiness.native_service_healthy === "boolean"
                  ? readiness.native_service_healthy
                  : null,
              hasSecureCredential:
                typeof readiness.native_has_secure_credential === "boolean"
                  ? readiness.native_has_secure_credential
                  : null,
              requiredRegionIds: Array.isArray(readiness.required_region_ids)
                ? readiness.required_region_ids.map(String)
                : [],
              registeredRegionIds: Array.isArray(readiness.registered_region_ids)
                ? readiness.registered_region_ids.map(String)
                : [],
              reportedAt: readiness.native_readiness_reported_at
                ? String(readiness.native_readiness_reported_at)
                : null,
            }
          : null,
        latestNativeActivityAt: userId ? (nativeActivityByUser.get(userId) ?? null) : null,
        automaticAttendanceEnabled: settings.automaticAttendanceEnabled,
      };
    });

    return NextResponse.json(summarizeSetupHealth(inputs));
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to load attendance setup health" }, { status: 500 });
  }
}
