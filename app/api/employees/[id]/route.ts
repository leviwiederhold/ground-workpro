/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { enqueueNotifications } from "@/lib/notifications/enqueue";

const employeeStatusSchema = z.enum(["clocked-in", "off", "active", "inactive"]);

const updateEmployeeSchema = z
  .object({
    name: z.string().min(1).optional(),
    role: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    hourlyRate: z.number().nonnegative().optional(),
    certifications: z.array(z.object({ name: z.string(), expires: z.string() })).optional(),
    jobId: z.union([z.number(), z.string()]).nullable().optional(),
    status: employeeStatusSchema.optional(),
    clockedInAt: z.string().nullable().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const normalizeId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);
const normalizeRoleValue = (value: unknown) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "executive" || raw === "ceo") return "admin";
  if (raw === "project manager" || raw === "manager") return "pm";
  if (raw === "laborer") return "operator";
  return raw;
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
  role: String(row.role ?? "operator").trim().toLowerCase(),
  user_id: row.user_id ?? null,
  phone: row.phone ?? "",
  email: row.email ?? "",
  hourlyRate: Number(row.hourly_rate ?? row.hourlyRate ?? row.pay_rate ?? row.rate ?? 0),
  certifications: parseCertifications(row.certifications),
  jobId: row.job_id === null || row.job_id === undefined ? null : /^\d+$/.test(String(row.job_id)) ? Number(row.job_id) : row.job_id,
  status: row.status ?? "off",
  clockedInAt: row.clocked_in_at ?? row.clockedInAt ?? null,
});

const isStatusCheckError = (message: string | undefined) =>
  /employees_status_check|violates check constraint .*status/i.test(message ?? "");

const isRoleCheckError = (message: string | undefined) =>
  /employees_role_check|violates check constraint .*role/i.test(message ?? "");

const getStatusCandidates = (value: unknown) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "clocked-in") return ["clocked-in", "active", "off", "inactive"];
  if (normalized === "active") return ["active", "clocked-in", "off", "inactive"];
  if (normalized === "off") return ["off", "inactive", "active", "clocked-in"];
  if (normalized === "inactive") return ["inactive", "off", "active", "clocked-in"];
  return [normalized];
};

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  id: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("employees")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    lastResult = result;
    const message = result.error?.message || "";
    const postgrestMissing = message.match(/Could not find the '([^']+)' column/i);
    const postgresMissing = message.match(/column\s+employees\.([a-zA-Z0-9_]+)\s+does not exist/i);
    const relationMissing = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+of relation\s+"?employees"?\s+does not exist/i);
    const genericMissing = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
    const missingColumn = postgrestMissing?.[1] ?? postgresMissing?.[1] ?? relationMissing?.[1] ?? genericMissing?.[1];
    if (!missingColumn) return result;
    if (!(missingColumn in currentPayload)) return result;
    delete currentPayload[missingColumn];
  }

  return lastResult;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let actorRole: string;
    try {
      const actor = await requireModuleAccess("team_management", "edit");
      actorRole = actor.role;
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    if (
      body &&
      typeof body === "object" &&
      ("company_id" in body || "created_by" in body || "created_at" in body)
    ) {
      return NextResponse.json(
        { error: "company_id, created_by, and created_at cannot be updated" },
        { status: 400 }
      );
    }

    const parsed = updateEmployeeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid employee payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const employeeId = normalizeId(id);
    const existingEmployeeResult = await supabase
      .from("employees")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .maybeSingle();
    if (existingEmployeeResult.error) {
      return NextResponse.json({ error: existingEmployeeResult.error.message }, { status: 400 });
    }
    if (!existingEmployeeResult.data) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const existingEmployee = existingEmployeeResult.data;
    const payload = parsed.data;
    const existingRole = normalizeRoleValue(existingEmployee.role);

    if (payload.role !== undefined && actorRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (payload.role !== undefined && existingRole === "admin" && normalizeRoleValue(payload.role) !== "admin") {
      return NextResponse.json({ error: "CEO role is locked and cannot be changed" }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {};

    if (payload.name !== undefined) {
      updatePayload.name = payload.name;
      updatePayload.full_name = payload.name;
    }
    if (payload.role !== undefined) updatePayload.role = normalizeRoleValue(payload.role);
    if (payload.phone !== undefined) updatePayload.phone = payload.phone;
    if (payload.email !== undefined) updatePayload.email = payload.email;
    if (payload.hourlyRate !== undefined) {
      updatePayload.hourly_rate = payload.hourlyRate;
      updatePayload.hourlyRate = payload.hourlyRate;
      updatePayload.pay_rate = payload.hourlyRate;
      updatePayload.rate = payload.hourlyRate;
    }
    if (payload.certifications !== undefined) updatePayload.certifications = payload.certifications;
    if (payload.jobId !== undefined) updatePayload.job_id = payload.jobId === "" ? null : payload.jobId;
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.clockedInAt !== undefined) updatePayload.clocked_in_at = payload.clockedInAt;

    let { data, error } = await updateWithColumnFallback(
      supabase,
      companyId,
      employeeId,
      updatePayload
    );

    if (error && payload.status !== undefined && isStatusCheckError(error.message)) {
      const statusCandidates = getStatusCandidates(payload.status);
      for (const candidate of statusCandidates.slice(1)) {
        const nextPayload = { ...updatePayload, status: candidate };
        const retry = await updateWithColumnFallback(
          supabase,
          companyId,
          employeeId,
          nextPayload
        );
        data = retry.data;
        error = retry.error;
        if (!error) break;
      }
    }

    if (error && payload.status !== undefined && isStatusCheckError(error.message)) {
      const retryWithoutStatusPayload = { ...updatePayload };
      delete retryWithoutStatusPayload.status;
      const retryWithoutStatus = await updateWithColumnFallback(
        supabase,
        companyId,
        employeeId,
        retryWithoutStatusPayload
      );
      data = retryWithoutStatus.data;
      error = retryWithoutStatus.error;
    }

    if (error && payload.role !== undefined && isRoleCheckError(error.message)) {
      const retryWithoutRolePayload = { ...updatePayload };
      delete retryWithoutRolePayload.role;
      const retryWithoutRole = await updateWithColumnFallback(
        supabase,
        companyId,
        employeeId,
        retryWithoutRolePayload
      );
      data = retryWithoutRole.data;
      error = retryWithoutRole.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const updatedEmployee = data;
    const oldJobId = existingEmployee.job_id == null ? null : String(existingEmployee.job_id);
    const requestedJobId =
      payload.jobId !== undefined
        ? payload.jobId === "" || payload.jobId === null
          ? null
          : String(payload.jobId)
        : updatedEmployee?.job_id == null
          ? null
          : String(updatedEmployee.job_id);
    const today = new Date().toISOString().slice(0, 10);

    if (payload.jobId !== undefined) {
      const deleteJoinAssignments = await supabase
        .from("job_employees")
        .delete()
        .eq("company_id", companyId)
        .eq("employee_id", employeeId);
      if (deleteJoinAssignments.error && !/relation .* does not exist|Could not find the table/i.test(deleteJoinAssignments.error.message || "")) {
        return NextResponse.json({ error: deleteJoinAssignments.error.message }, { status: 400 });
      }

      const deleteTodayAssignments = await supabase
        .from("schedule_assignments")
        .delete()
        .eq("company_id", companyId)
        .eq("employee_id", employeeId)
        .eq("date", today);
      if (deleteTodayAssignments.error && !/relation .* does not exist|Could not find the table/i.test(deleteTodayAssignments.error.message || "")) {
        return NextResponse.json({ error: deleteTodayAssignments.error.message }, { status: 400 });
      }

      if (requestedJobId) {
        const joinInsertResult = await supabase
          .from("job_employees")
          .insert({
            company_id: companyId,
            job_id: requestedJobId,
            employee_id: employeeId,
          });
        if (joinInsertResult.error && !/relation .* does not exist|Could not find the table|duplicate key|unique/i.test(joinInsertResult.error.message || "")) {
          return NextResponse.json({ error: joinInsertResult.error.message }, { status: 400 });
        }

        const scheduleInsertResult = await supabase
          .from("schedule_assignments")
          .insert({
            company_id: companyId,
            job_id: requestedJobId,
            employee_id: employeeId,
            date: today,
            notes: "Auto-added from Team assignment",
          });
        if (scheduleInsertResult.error && !/relation .* does not exist|Could not find the table|duplicate key|unique/i.test(scheduleInsertResult.error.message || "")) {
          return NextResponse.json({ error: scheduleInsertResult.error.message }, { status: 400 });
        }

        if (requestedJobId !== oldJobId) {
          const jobResult = await supabase
            .from("jobs")
            .select("id, name")
            .eq("company_id", companyId)
            .eq("id", requestedJobId)
            .maybeSingle();
          const linkedUserId = String(updatedEmployee?.user_id ?? "").trim();
          if (linkedUserId) {
            try {
              await enqueueNotifications({
                supabase,
                companyId,
                userIds: [linkedUserId],
                type: "job_assigned",
                payload: {
                  jobId: String(requestedJobId),
                  jobName: String(jobResult.data?.name ?? "Assigned Job"),
                  date: today,
                  href: "/schedule",
                },
              });
            } catch {
              // no-op: assignment save should not fail on notification issue
            }
          }
        }
      }
    }

    if (payload.role !== undefined && updatedEmployee?.user_id) {
      const membershipResult = await supabase
        .from("memberships")
        .update({ role: normalizeRoleValue(payload.role) })
        .eq("company_id", companyId)
        .eq("user_id", updatedEmployee.user_id);
      if (membershipResult.error) {
        await supabase.from("memberships").insert({
          company_id: companyId,
          user_id: updatedEmployee.user_id,
          role: normalizeRoleValue(payload.role),
        });
      }
    }

    return NextResponse.json({
      employee: mapEmployee(
        payload.jobId !== undefined
          ? {
              ...updatedEmployee,
              job_id: requestedJobId,
            }
          : updatedEmployee
      ),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireModuleAccess("team_management", "edit");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();

    const { error } = await supabase
      .from("employees")
      .delete()
      .eq("company_id", companyId)
      .eq("id", normalizeId(id));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
