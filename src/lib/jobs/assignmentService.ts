/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side orchestration for conflict-checked employee job assignment.
//
// Modern path: the assign_job_employee / reassign_job_employee SQL functions run
// the conflict check + write in one transaction under a per-employee advisory
// lock, so concurrent requests cannot create an active double-booking.
//
// Fallback path: when those functions (or the job_employees table) are not
// present, we run the same rule in JS via evaluateAssignmentConflict. This is
// best-effort and not concurrency-safe, matching the app's existing tolerance
// for older schemas.

import {
  ASSIGNMENT_CONFLICT_CODE,
  evaluateAssignmentConflict,
  toConflictJob,
  type AssignmentConflict,
} from "@/lib/jobs/assignmentConflict";

export type AssignmentResult =
  | { status: "assigned" }
  | { status: "already_assigned" }
  | { status: "conflict"; conflict: AssignmentConflict }
  | { status: "job_not_found" }
  | { status: "error"; message: string }
  // The preferred job_employees schema is unavailable — caller should use its
  // legacy per-employee-column path.
  | { status: "unsupported" };

const isMissingFunctionOrTable = (message: string, code?: string) =>
  code === "PGRST202" ||
  /Could not find the function/i.test(message) ||
  /function .* does not exist/i.test(message) ||
  /relation .* does not exist/i.test(message) ||
  /Could not find the table/i.test(message);

const isMissingColumnOrTable = (message: string) =>
  /column .* does not exist/i.test(message) ||
  /Could not find the '.*' column/i.test(message) ||
  /relation .* does not exist/i.test(message) ||
  /Could not find the table/i.test(message);

function conflictFromRpc(payload: any, employeeId: string): AssignmentConflict {
  const job = payload?.conflicting_job ?? {};
  return {
    code: ASSIGNMENT_CONFLICT_CODE,
    employeeId: String(employeeId),
    conflictingJob: {
      id: String(job.id ?? ""),
      name: String(job.name ?? ""),
      startAt: job.startAt ?? null,
      endAt: job.endAt ?? null,
    },
  };
}

type AssignArgs = {
  supabase: any;
  companyId: string;
  jobId: string | number;
  employeeId: string | number;
  assignedRole?: string | null;
};

export async function assignEmployeeToJob(args: AssignArgs): Promise<AssignmentResult> {
  const { supabase, companyId, jobId, employeeId, assignedRole } = args;

  const rpc = await supabase.rpc("assign_job_employee", {
    p_company_id: companyId,
    p_job_id: String(jobId),
    p_employee_id: String(employeeId),
    p_assigned_role: assignedRole ?? null,
  });

  if (!rpc.error) {
    return interpretWriteRpc(rpc.data, String(employeeId));
  }

  if (!isMissingFunctionOrTable(rpc.error.message || "", rpc.error.code)) {
    return { status: "error", message: rpc.error.message || "Failed to assign employee" };
  }

  // ── JS fallback (job_employees present, RPC absent) ──────────────────────
  return assignFallback(args);
}

type ReassignArgs = {
  supabase: any;
  companyId: string;
  fromJobId: string | number;
  toJobId: string | number;
  employeeId: string | number;
  assignedRole?: string | null;
};

export async function reassignEmployee(args: ReassignArgs): Promise<AssignmentResult> {
  const { supabase, companyId, fromJobId, toJobId, employeeId, assignedRole } = args;

  const rpc = await supabase.rpc("reassign_job_employee", {
    p_company_id: companyId,
    p_from_job_id: String(fromJobId),
    p_to_job_id: String(toJobId),
    p_employee_id: String(employeeId),
    p_assigned_role: assignedRole ?? null,
  });

  if (!rpc.error) {
    return interpretWriteRpc(rpc.data, String(employeeId));
  }

  if (!isMissingFunctionOrTable(rpc.error.message || "", rpc.error.code)) {
    return { status: "error", message: rpc.error.message || "Failed to reassign employee" };
  }

  // ── JS fallback: delete old membership, then run the guarded assign. Not
  // atomic without the RPC, but preserves function on older schemas. ────────
  const del = await supabase
    .from("job_employees")
    .delete()
    .eq("company_id", companyId)
    .eq("job_id", fromJobId)
    .eq("employee_id", employeeId);
  if (del.error && !isMissingColumnOrTable(del.error.message || "")) {
    return { status: "error", message: del.error.message };
  }
  return assignFallback({ supabase, companyId, jobId: toJobId, employeeId, assignedRole });
}

function interpretWriteRpc(data: any, employeeId: string): AssignmentResult {
  if (data?.error === "JOB_NOT_FOUND") return { status: "job_not_found" };
  if (data?.conflict) return { status: "conflict", conflict: conflictFromRpc(data, employeeId) };
  if (data?.already_assigned) return { status: "already_assigned" };
  if (data?.ok) return { status: "assigned" };
  return { status: "error", message: "Assignment failed" };
}

async function assignFallback(args: AssignArgs): Promise<AssignmentResult> {
  const { supabase, companyId, jobId, employeeId, assignedRole } = args;

  // Target job (also confirms it exists in this company).
  const targetResult = await supabase
    .from("jobs")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", jobId)
    .limit(1);
  if (targetResult.error) {
    return { status: "error", message: targetResult.error.message };
  }
  const targetRow = (targetResult.data ?? [])[0];
  if (!targetRow) return { status: "job_not_found" };

  // Existing memberships (join-table). If the table is missing, defer to the
  // caller's legacy per-employee-column path.
  const existingResult = await supabase
    .from("job_employees")
    .select("job_id")
    .eq("company_id", companyId)
    .eq("employee_id", employeeId);
  if (existingResult.error) {
    if (isMissingColumnOrTable(existingResult.error.message || "")) return { status: "unsupported" };
    return { status: "error", message: existingResult.error.message };
  }

  const existingRows = existingResult.data ?? [];
  if (existingRows.some((row: any) => String(row.job_id) === String(jobId))) {
    return { status: "already_assigned" };
  }

  const otherJobIds = existingRows
    .map((row: any) => row.job_id)
    .filter((id: any) => id !== null && id !== undefined && String(id) !== String(jobId));

  let existingJobs: ReturnType<typeof toConflictJob>[] = [];
  if (otherJobIds.length > 0) {
    const jobsResult = await supabase
      .from("jobs")
      .select("*")
      .eq("company_id", companyId)
      .in("id", otherJobIds);
    if (jobsResult.error) return { status: "error", message: jobsResult.error.message };
    existingJobs = (jobsResult.data ?? []).map((row: any) => toConflictJob(row));
  }

  const conflict = evaluateAssignmentConflict({
    employeeId: String(employeeId),
    targetJob: toConflictJob(targetRow),
    existingJobs,
  });
  if (conflict) return { status: "conflict", conflict };

  const insertPayload: Record<string, unknown> = {
    company_id: companyId,
    job_id: jobId,
    employee_id: employeeId,
  };
  if (assignedRole) insertPayload.assigned_role = assignedRole;

  let insertResult = await supabase.from("job_employees").insert(insertPayload).select("employee_id").limit(1);
  if (insertResult.error && /assigned_role/i.test(insertResult.error.message || "")) {
    delete insertPayload.assigned_role;
    insertResult = await supabase.from("job_employees").insert(insertPayload).select("employee_id").limit(1);
  }
  if (insertResult.error) {
    const message = insertResult.error.message || "";
    if (/duplicate key|unique/i.test(message)) return { status: "already_assigned" };
    if (isMissingColumnOrTable(message)) return { status: "unsupported" };
    return { status: "error", message };
  }

  return { status: "assigned" };
}
