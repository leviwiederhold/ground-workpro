/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";

const normalizeId = (id: unknown): string | number | null => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  if (typeof id === "string") return id;
  return String(id);
};

const isMissingColumnOrTable = (message: string) =>
  /column .* does not exist/i.test(message) ||
  /Could not find the '.*' column/i.test(message) ||
  /relation .* does not exist/i.test(message) ||
  /Could not find the table/i.test(message);

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; employeeId: string }> }
) {
  try {
    const { id, employeeId } = await params;
    const { supabase, companyId } = await getCompanyId();
    const jobId = normalizeId(id);
    const normalizedEmployeeId = normalizeId(employeeId);
    if (jobId === null || normalizedEmployeeId === null) {
      return NextResponse.json({ error: "Invalid job or employee id" }, { status: 400 });
    }

    const { data: employeeRows, error: employeeError } = await supabase
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", normalizedEmployeeId)
      .limit(1);

    if (employeeError || !(employeeRows && employeeRows.length > 0)) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    // Preferred schema: join table
    const deleteJoinResult = await supabase
      .from("job_employees")
      .delete()
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .eq("employee_id", normalizedEmployeeId)
      .select("employee_id");

    if (!deleteJoinResult.error) {
      const deletedRows = deleteJoinResult.data ?? [];
      if (deletedRows.length === 0) {
        return NextResponse.json({ error: "Employee is not assigned to this job" }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (!isMissingColumnOrTable(deleteJoinResult.error?.message || "")) {
      return NextResponse.json({ error: deleteJoinResult.error?.message || "Failed to unassign employee" }, { status: 400 });
    }

    // Fallback schema: assignment column on employees table
    const assignmentColumns = ["job_id", "assigned_job_id", "current_job_id"];
    for (const column of assignmentColumns) {
      const valueResult = await supabase
        .from("employees")
        .select(`id, ${column}`)
        .eq("company_id", companyId)
        .eq("id", normalizedEmployeeId)
        .limit(1);

      if (valueResult.error) {
        if (isMissingColumnOrTable(valueResult.error.message || "")) {
          continue;
        }
        return NextResponse.json({ error: valueResult.error.message }, { status: 400 });
      }

      const valueRow = (valueResult.data ?? [])[0];
      if (!valueRow) {
        return NextResponse.json({ error: "Employee not found" }, { status: 404 });
      }

      const currentValue = normalizeId((valueRow as any)[column]);
      if (currentValue !== jobId) {
        continue;
      }

      const payload: Record<string, unknown> = {
        [column]: null,
        assigned_role: null,
      };
      let updateResult = await supabase
        .from("employees")
        .update(payload)
        .eq("company_id", companyId)
        .eq("id", normalizedEmployeeId)
        .select("id")
        .limit(1);

      if (updateResult.error && /assigned_role/i.test(updateResult.error.message || "")) {
        delete payload.assigned_role;
        updateResult = await supabase
          .from("employees")
          .update(payload)
          .eq("company_id", companyId)
          .eq("id", normalizedEmployeeId)
          .select("id")
          .limit(1);
      }

      if (updateResult.error) {
        if (isMissingColumnOrTable(updateResult.error.message || "")) {
          continue;
        }
        return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
      }

      const updatedRows = updateResult.data ?? [];
      if (updatedRows.length === 0) {
        return NextResponse.json({ error: "Employee update was blocked or not found" }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Employee is not assigned to this job" }, { status: 400 });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
