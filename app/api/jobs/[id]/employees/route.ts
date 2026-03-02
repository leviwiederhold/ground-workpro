/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { enqueueNotifications } from "@/lib/notifications/enqueue";

const assignEmployeeSchema = z.object({
  employee_id: z.union([z.number(), z.string()]),
  assigned_role: z.string().optional(),
});

const normalizeId = (id: unknown): string | number | null => {
  if (id === null || id === undefined || id === "") return null;
  if (typeof id === "number") return id;
  if (typeof id === "string" && /^\d+$/.test(id)) return Number(id);
  if (typeof id === "string") return id;
  return String(id);
};

const parseCertifications = (value: unknown) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const mapEmployee = (row: any) => ({
  id: row.id,
  name: row.name ?? row.full_name ?? "",
  role: row.role ?? "Laborer",
  assigned_role: row.assigned_role ?? null,
  phone: row.phone ?? "",
  email: row.email ?? "",
  hourlyRate: Number(row.hourly_rate ?? row.hourlyRate ?? 0),
  certifications: parseCertifications(row.certifications),
  jobId: normalizeId(row.job_id ?? row.jobId),
  status: row.status ?? "off",
  clockedInAt: row.clocked_in_at ?? row.clockedInAt ?? null,
});

const isMissingColumnOrTable = (message: string) =>
  /column .* does not exist/i.test(message) ||
  /Could not find the '.*' column/i.test(message) ||
  /relation .* does not exist/i.test(message) ||
  /Could not find the table/i.test(message);

async function getEmployeeById(supabase: any, companyId: string, employeeId: string | number) {
  return supabase
    .from("employees")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", employeeId)
    .limit(1);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();
    const jobId = normalizeId(id);

    const { data: jobRows, error: jobError } = await supabase
      .from("jobs")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .limit(1);

    if (jobError || !(jobRows && jobRows.length > 0)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Preferred schema: join table
    const assignmentsResult = await supabase
      .from("job_employees")
      .select("employee_id, assigned_role")
      .eq("company_id", companyId)
      .eq("job_id", jobId);

    if (!assignmentsResult.error) {
      const assignments = assignmentsResult.data ?? [];
      if (assignments.length === 0) {
        return NextResponse.json({ employees: [] });
      }

      const ids = assignments
        .map((assignment: any) => normalizeId(assignment.employee_id))
        .filter((value) => value !== null);
      if (ids.length === 0) {
        return NextResponse.json({ employees: [] });
      }

      const { data: employeeRows, error: employeesError } = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId)
        .in("id", ids as Array<string | number>);

      if (employeesError) {
        return NextResponse.json({ error: employeesError.message }, { status: 400 });
      }

      const roleMap = new Map(
        assignments.map((assignment: any) => [String(assignment.employee_id), assignment.assigned_role ?? null])
      );

      const mapped = (employeeRows ?? []).map((employee: any) => ({
        ...mapEmployee(employee),
        assigned_role: roleMap.get(String(employee.id)) ?? null,
      }));
      return NextResponse.json({ employees: mapped });
    }

    // Fallback schema: assignment column on employees table
    if (!isMissingColumnOrTable(assignmentsResult.error?.message || "")) {
      return NextResponse.json({ error: assignmentsResult.error?.message || "Failed to load job employees" }, { status: 400 });
    }

    const assignmentColumns = ["job_id", "assigned_job_id", "current_job_id"];
    for (const column of assignmentColumns) {
      const result = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId)
        .eq(column, jobId);

      if (result.error) {
        if (isMissingColumnOrTable(result.error.message || "")) {
          continue;
        }
        return NextResponse.json({ error: result.error.message }, { status: 400 });
      }
      return NextResponse.json({ employees: (result.data ?? []).map(mapEmployee) });
    }

    return NextResponse.json({ error: "No supported employee assignment schema found" }, { status: 400 });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const parsed = assignEmployeeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid assignment payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const jobId = normalizeId(id);
    const employeeId = normalizeId(parsed.data.employee_id);
    if (jobId === null || employeeId === null) {
      return NextResponse.json({ error: "Invalid job or employee id" }, { status: 400 });
    }

    const { data: jobRows, error: jobError } = await supabase
      .from("jobs")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .limit(1);

    if (jobError || !(jobRows && jobRows.length > 0)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const { data: employeeRows, error: employeeError } = await getEmployeeById(supabase, companyId, employeeId);

    if (employeeError || !(employeeRows && employeeRows.length > 0)) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const employee = employeeRows[0];

    // Preferred schema: join table
    const checkExisting = await supabase
      .from("job_employees")
      .select("id, employee_id")
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .eq("employee_id", employeeId)
      .limit(1);

    if (!checkExisting.error) {
      if ((checkExisting.data ?? []).length > 0) {
        return NextResponse.json({ error: "Employee is already assigned to this job" }, { status: 409 });
      }

      const insertPayload: Record<string, unknown> = {
        company_id: companyId,
        job_id: jobId,
        employee_id: employeeId,
      };
      if (parsed.data.assigned_role) insertPayload.assigned_role = parsed.data.assigned_role;

      let insertResult = await supabase
        .from("job_employees")
        .insert(insertPayload)
        .select("employee_id")
        .limit(1);

      if (insertResult.error && /assigned_role/i.test(insertResult.error.message || "")) {
        delete insertPayload.assigned_role;
        insertResult = await supabase
          .from("job_employees")
          .insert(insertPayload)
          .select("employee_id")
          .limit(1);
      }

      if (insertResult.error) {
        const message = insertResult.error.message || "";
        if (/duplicate key|unique/i.test(message)) {
          return NextResponse.json({ error: "Employee is already assigned to this job" }, { status: 409 });
        }
        return NextResponse.json({ error: message }, { status: 400 });
      }

      const employeeUserId = String((employee as any).user_id ?? "").trim();
      if (employeeUserId) {
        try {
          await enqueueNotifications({
            supabase,
            companyId,
            userIds: [employeeUserId],
            type: "assignment_created",
            payload: {
              jobId: String(jobId),
              jobName: String((jobRows[0] as any)?.name ?? "Assigned Job"),
              date: new Date().toISOString().slice(0, 10),
              href: "/schedule",
            },
          });
        } catch {
          // Keep assignment successful even if notifications table is unavailable.
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      const existingScheduleResult = await supabase
        .from("schedule_assignments")
        .select("id")
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .eq("employee_id", employeeId)
        .eq("date", today)
        .limit(1);
      if (!existingScheduleResult.error && (existingScheduleResult.data ?? []).length === 0) {
        await supabase.from("schedule_assignments").insert({
          company_id: companyId,
          job_id: jobId,
          employee_id: employeeId,
          date: today,
          created_by: userId,
          notes: "Auto-added from job assignment",
        });
      }

      return NextResponse.json({
        employee: { ...mapEmployee(employee), assigned_role: parsed.data.assigned_role ?? null, jobId: jobId },
      });
    }

    if (!isMissingColumnOrTable(checkExisting.error?.message || "")) {
      return NextResponse.json({ error: checkExisting.error?.message || "Failed to assign employee" }, { status: 400 });
    }

    // Fallback schema: assignment column on employees table
    const assignmentColumns = ["job_id", "assigned_job_id", "current_job_id"];
    for (const column of assignmentColumns) {
      const currentValue = normalizeId((employee as any)[column]);
      if (currentValue === jobId) {
        return NextResponse.json({ error: "Employee is already assigned to this job" }, { status: 409 });
      }

      const payload: Record<string, unknown> = {
        [column]: jobId,
      };
      if (parsed.data.assigned_role) payload.assigned_role = parsed.data.assigned_role;

      let updateResult = await supabase
        .from("employees")
        .update(payload)
        .eq("company_id", companyId)
        .eq("id", employeeId)
        .select("*")
        .limit(1);

      if (updateResult.error && /assigned_role/i.test(updateResult.error.message || "")) {
        delete payload.assigned_role;
        updateResult = await supabase
          .from("employees")
          .update(payload)
          .eq("company_id", companyId)
          .eq("id", employeeId)
          .select("*")
          .limit(1);
      }

      if (updateResult.error) {
        if (isMissingColumnOrTable(updateResult.error.message || "")) {
          continue;
        }
        return NextResponse.json({ error: updateResult.error.message }, { status: 400 });
      }

      const updated = (updateResult.data ?? [])[0];
      if (!updated) {
        return NextResponse.json({ error: "Employee update was blocked or not found" }, { status: 400 });
      }

      const employeeUserId = String((updated as any).user_id ?? (employee as any).user_id ?? "").trim();
      if (employeeUserId) {
        try {
          await enqueueNotifications({
            supabase,
            companyId,
            userIds: [employeeUserId],
            type: "assignment_created",
            payload: {
              jobId: String(jobId),
              jobName: String((jobRows[0] as any)?.name ?? "Assigned Job"),
              date: new Date().toISOString().slice(0, 10),
              href: "/schedule",
            },
          });
        } catch {
          // Keep assignment successful even if notifications table is unavailable.
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      const existingScheduleResult = await supabase
        .from("schedule_assignments")
        .select("id")
        .eq("company_id", companyId)
        .eq("job_id", jobId)
        .eq("employee_id", employeeId)
        .eq("date", today)
        .limit(1);
      if (!existingScheduleResult.error && (existingScheduleResult.data ?? []).length === 0) {
        await supabase.from("schedule_assignments").insert({
          company_id: companyId,
          job_id: jobId,
          employee_id: employeeId,
          date: today,
          created_by: userId,
          notes: "Auto-added from job assignment",
        });
      }
      return NextResponse.json({ employee: mapEmployee(updated) });
    }

    return NextResponse.json({ error: "No supported employee assignment schema found" }, { status: 400 });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
