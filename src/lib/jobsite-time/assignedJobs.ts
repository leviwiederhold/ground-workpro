/* eslint-disable @typescript-eslint/no-explicit-any */
// Authoritative resolver for a user's assigned jobs.
//
// job_employees IS the production assignment model — the same source the native
// monitoring-plan uses successfully. The employees table carries no `job_id`
// column, so assignments come solely from job_employees, company-scoped. This
// module holds the query so it can be unit-tested against a fake Supabase.

export type AssignedJob = {
  jobId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  addressVerified: boolean;
};

// Accepts the real Supabase client or the in-memory test double — both expose a
// chainable `.from(table)` query builder. Kept `any` (like the other attendance
// db helpers) so the fake and the real client are interchangeable.
type MinimalDb = { from: (table: string) => any };

/**
 * The current user's assigned jobs, company-scoped, with verified coordinates
 * when available. Authorization/tenant scoping is the caller's responsibility
 * (companyId/userId are already resolved); this never reads across companies.
 *
 * Returns [] when the user has no employee row or no assignments — the caller
 * (attendance card / geofence watcher / participation gate) treats an empty
 * list as "not an attendance participant".
 */
export async function resolveAssignedJobs(
  db: MinimalDb,
  companyId: string,
  userId: string,
): Promise<AssignedJob[]> {
  // The caller's own employee row (company-scoped — no cross-tenant lookup).
  const employeeResult = await db
    .from("employees")
    .select("id")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const employeeId = employeeResult.data?.id ? String(employeeResult.data.id) : null;
  if (!employeeId) return [];

  // Assignments come from job_employees — the authoritative model. (The old
  // `employees.job_id` path referenced a column that does not exist, which made
  // this endpoint error and return nothing for everyone.)
  const assignmentsResult = await db
    .from("job_employees")
    .select("job_id")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .limit(500);
  const jobIds = Array.from(
    new Set(
      (assignmentsResult.data ?? [])
        .map((row: any) => (row.job_id == null ? "" : String(row.job_id)))
        .filter((id: string) => id.length > 0),
    ),
  );
  if (jobIds.length === 0) return [];

  const jobsResult = await db
    .from("jobs")
    .select("id, name, lat, lng, address_verified")
    .eq("company_id", companyId)
    .in("id", jobIds);
  if (jobsResult.error) throw new Error(jobsResult.error.message);

  return (jobsResult.data ?? []).map((job: any) => ({
    jobId: String(job.id),
    name: job.name ?? "Job",
    lat: job.lat === null || job.lat === undefined ? null : Number(job.lat),
    lng: job.lng === null || job.lng === undefined ? null : Number(job.lng),
    addressVerified: Boolean(job.address_verified) && job.lat !== null && job.lng !== null,
  }));
}
