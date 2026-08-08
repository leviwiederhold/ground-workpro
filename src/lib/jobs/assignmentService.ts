/* eslint-disable @typescript-eslint/no-explicit-any */
import { ASSIGNMENT_CONFLICT_CODE } from "./assignmentConflict.ts";

export type CurrentJob = { id: string; name: string };

export type AssignmentResult =
  | { status: "assigned" }
  | { status: "already_assigned" }
  | { status: "reassigned" }
  | { status: "conflict"; currentJob: CurrentJob }
  | { status: "job_not_found" }
  | { status: "employee_not_found" }
  | { status: "source_assignment_not_found" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: any;
    error: { code?: string; message?: string } | null;
  }>;
};

function normalizePayload(data: any) {
  return Array.isArray(data) ? data[0] ?? {} : data ?? {};
}

function isMissingAtomicRpc(error: { code?: string; message?: string }) {
  const message = String(error.message ?? "");
  return (
    error.code === "PGRST202" ||
    /Could not find the function/i.test(message) ||
    /function .* does not exist/i.test(message)
  );
}

export function interpretAssignmentRpc(data: any): AssignmentResult {
  const payload = normalizePayload(data);
  if (payload.ok === true && payload.status === "assigned") return { status: "assigned" };
  if (payload.ok === true && payload.status === "already_assigned") {
    return { status: "already_assigned" };
  }
  if (payload.ok === true && payload.status === "reassigned") return { status: "reassigned" };
  if (payload.code === ASSIGNMENT_CONFLICT_CODE) {
    return {
      status: "conflict",
      currentJob: {
        id: String(payload.current_job?.id ?? ""),
        name: String(payload.current_job?.name ?? "Current job"),
      },
    };
  }
  if (payload.code === "JOB_NOT_FOUND") return { status: "job_not_found" };
  if (payload.code === "EMPLOYEE_NOT_FOUND") return { status: "employee_not_found" };
  if (payload.code === "SOURCE_ASSIGNMENT_NOT_FOUND") {
    return { status: "source_assignment_not_found" };
  }
  return { status: "error", message: String(payload.error ?? "Assignment failed") };
}

async function callAtomicRpc(
  supabase: RpcClient,
  name: "assign_job_employee" | "reassign_job_employee",
  args: Record<string, unknown>,
): Promise<AssignmentResult> {
  const result = await supabase.rpc(name, args);
  if (!result.error) return interpretAssignmentRpc(result.data);
  if (isMissingAtomicRpc(result.error)) {
    return {
      status: "unavailable",
      message: "Atomic job assignment is not available. Apply the current database migration and try again.",
    };
  }
  return { status: "error", message: result.error.message || "Assignment failed" };
}

export function assignEmployeeToJob(params: {
  supabase: RpcClient;
  companyId: string;
  jobId: string;
  employeeId: string;
  assignedRole?: string | null;
}) {
  return callAtomicRpc(params.supabase, "assign_job_employee", {
    p_company_id: params.companyId,
    p_job_id: params.jobId,
    p_employee_id: params.employeeId,
    p_assigned_role: params.assignedRole ?? null,
  });
}

export function reassignEmployeeToJob(params: {
  supabase: RpcClient;
  companyId: string;
  fromJobId: string;
  toJobId: string;
  employeeId: string;
  assignedRole?: string | null;
}) {
  return callAtomicRpc(params.supabase, "reassign_job_employee", {
    p_company_id: params.companyId,
    p_from_job_id: params.fromJobId,
    p_to_job_id: params.toJobId,
    p_employee_id: params.employeeId,
    p_assigned_role: params.assignedRole ?? null,
  });
}
