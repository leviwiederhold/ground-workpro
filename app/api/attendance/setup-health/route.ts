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

export const dynamic = "force-dynamic";

const INACTIVE_STATUSES = new Set(["inactive", "deleted", "archived", "removed"]);

export async function GET() {
  try {
    const { companyId } = await requireRole(["admin", "pm"]);
    const admin = getSupabaseAdmin();
    if (!admin) {
      return NextResponse.json({ error: "Attendance setup health requires service access" }, { status: 503 });
    }

    const settingsRow = await admin
      .from("companies")
      .select("attendance_automatic_enabled")
      .eq("id", companyId)
      .maybeSingle();
    const settings = mapRowToAttendanceSettings(settingsRow.data as Record<string, unknown> | null);

    const employeesResult = await admin
      .from("employees")
      .select("id, full_name, user_id, status")
      .eq("company_id", companyId)
      .limit(500);
    const employees = (employeesResult.data ?? []).filter(
      (e: Record<string, unknown>) => !INACTIVE_STATUSES.has(String(e.status ?? "").toLowerCase())
    );
    if (employees.length === 0) {
      return NextResponse.json({ items: [], brokenCount: 0, healthyCount: 0 });
    }

    const employeeIds = employees.map((e: Record<string, unknown>) => String(e.id));
    const userIds = employees
      .map((e: Record<string, unknown>) => (e.user_id ? String(e.user_id) : null))
      .filter((id: string | null): id is string => Boolean(id));

    const [assignments, credentials] = await Promise.all([
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
    ]);

    const assignmentRows = (assignments.data ?? []) as Array<{ employee_id: string; job_id: string }>;
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
    const credentialByUser = new Map<string, { expiresAt: string | null; revokedAt: string | null; lastUsedAt: string | null }>();
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

    const inputs: EmployeeSetupInput[] = employees.map((employee: Record<string, unknown>) => {
      const employeeId = String(employee.id);
      const jobId = assignmentByEmployee.get(employeeId) ?? null;
      const job = jobId ? jobById.get(jobId) : null;
      const userId = employee.user_id ? String(employee.user_id) : null;
      return {
        employeeId,
        name: String(employee.full_name ?? "Team member"),
        hasAssignmentToday: Boolean(jobId),
        jobsiteVerified: Boolean(job?.address_verified) && job?.lat != null && job?.lng != null,
        jobName: job?.name ? String(job.name) : null,
        credential: userId ? (credentialByUser.get(userId) ?? null) : null,
        automaticAttendanceEnabled: settings.automaticAttendanceEnabled,
      };
    });

    return NextResponse.json(summarizeSetupHealth(inputs));
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }
}
