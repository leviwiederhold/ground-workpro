/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { syncStripeQuantityForCompany } from "@/lib/billing/syncStripeQuantity";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isCompanyOwnerEmployee } from "@/lib/auth/ownerLock";
import { ASSIGNMENT_CONFLICT_CODE } from "@/lib/jobs/assignmentConflict";
import { runJobAssignmentSideEffects } from "@/lib/jobs/assignmentSideEffects";
import { assignEmployeeToJob } from "@/lib/jobs/assignmentService";
import {
  canonicalizeRoleWrite,
  isMissingLegacyPermissionProfileColumn,
  isOwnerTeamRole,
  legacyCompatibleRoleValue,
  normalizeCanonicalTeamRole,
  normalizeLegacyPermissionProfile,
} from "@/lib/auth/teamRoles";

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

const mapEmployee = (row: any) => {
  const id = row?.id;
  if (id === null || id === undefined || id === "") return null;

  return {
    id,
    name: row.name ?? row.full_name ?? "",
    role: normalizeCanonicalTeamRole(row.role) ?? "team_member",
    jobTitle: String(row.job_title ?? ""),
    accessProfile:
      normalizeLegacyPermissionProfile(row.role, row.legacy_permission_profile) ?? "operator",
    user_id: row.user_id ?? null,
    phone: row.phone ?? "",
    email: row.email ?? "",
    certifications: parseCertifications(row.certifications),
    jobId: row.job_id === null || row.job_id === undefined ? null : /^\d+$/.test(String(row.job_id)) ? Number(row.job_id) : row.job_id,
    status: row.status ?? "off",
    clockedInAt: row.clocked_in_at ?? row.clockedInAt ?? null,
  };
};

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
    let actorUserId = "";
    try {
      const actor = await requireModuleAccess("team_management", "edit");
      actorRole = actor.role;
      actorUserId = String(actor.userId || "").trim();
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

    const { supabase, companyId, userId } = await getCompanyId();
    if (!actorUserId) {
      actorUserId = String(userId || "").trim();
    }
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

    if (payload.role !== undefined && actorRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (payload.hourlyRate !== undefined && actorRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Owner lock: an Owner's access role cannot be changed through the
    // Employees endpoint, regardless of how the employees row is linked.
    if (payload.role !== undefined && !isOwnerTeamRole(payload.role)) {
      const adminClient = getSupabaseAdmin();
      const isTargetCeo = await isCompanyOwnerEmployee({
        adminClient,
        db: adminClient ?? supabase,
        companyId,
        employeeRole: existingEmployee.role,
        employeeUserId: existingEmployee.user_id,
        employeeEmail: existingEmployee.email,
      });
      if (isTargetCeo) {
        return NextResponse.json({ error: "Owner role is locked and cannot be changed" }, { status: 400 });
      }
    }

    const requestedJobId =
      payload.jobId === undefined
        ? undefined
        : payload.jobId === "" || payload.jobId === null
          ? null
          : String(payload.jobId);
    let assignmentTargetJob: Record<string, any> | null = null;
    let assignmentWasCreated = false;
    let explicitlyUnassignedJobId: string | null = null;

    // job_employees is authoritative. Handle its mutation before profile edits
    // so a conflict cannot partially save unrelated form fields, and never use
    // the legacy delete-then-insert reassignment sequence.
    if (requestedJobId !== undefined) {
      const admin = getSupabaseAdmin();
      if (!admin) {
        return NextResponse.json({ error: "Atomic assignment service unavailable" }, { status: 503 });
      }

      if (requestedJobId === null) {
        const memberships = await admin
          .from("job_employees")
          .select("job_id")
          .eq("company_id", companyId)
          .eq("employee_id", employeeId);
        if (memberships.error) {
          return NextResponse.json({ error: memberships.error.message }, { status: 400 });
        }
        if ((memberships.data ?? []).length > 1) {
          return NextResponse.json(
            {
              code: "EMPLOYEE_ASSIGNMENT_REMEDIATION_REQUIRED",
              error: "This employee has multiple existing job assignments. Resolve them separately before unassigning.",
            },
            { status: 409 },
          );
        }
        explicitlyUnassignedJobId = String(memberships.data?.[0]?.job_id ?? "") || null;
        if (explicitlyUnassignedJobId) {
          const removal = await admin
            .from("job_employees")
            .delete()
            .eq("company_id", companyId)
            .eq("employee_id", employeeId)
            .eq("job_id", explicitlyUnassignedJobId);
          if (removal.error) {
            return NextResponse.json({ error: removal.error.message }, { status: 400 });
          }
        }
      } else {
        const targetJobResult = await supabase
          .from("jobs")
          .select("id, name, status")
          .eq("company_id", companyId)
          .eq("id", requestedJobId)
          .maybeSingle();
        if (targetJobResult.error || !targetJobResult.data) {
          return NextResponse.json({ error: "Job not found" }, { status: 404 });
        }
        assignmentTargetJob = targetJobResult.data;

        const assignmentResult = await assignEmployeeToJob({
          supabase: admin,
          companyId,
          jobId: requestedJobId,
          employeeId: String(employeeId),
        });
        if (assignmentResult.status === "conflict") {
          const name = String(existingEmployee.name ?? existingEmployee.full_name ?? "Employee");
          return NextResponse.json(
            {
              code: ASSIGNMENT_CONFLICT_CODE,
              error: `${name} is already assigned to ${assignmentResult.currentJob.name}.`,
              employee: { id: String(employeeId), name },
              currentJob: assignmentResult.currentJob,
            },
            { status: 409 },
          );
        }
        if (assignmentResult.status === "job_not_found") {
          return NextResponse.json({ error: "Job not found" }, { status: 404 });
        }
        if (assignmentResult.status === "employee_not_found") {
          return NextResponse.json({ error: "Employee not found" }, { status: 404 });
        }
        if (assignmentResult.status === "unavailable") {
          return NextResponse.json({ error: assignmentResult.message }, { status: 503 });
        }
        if (
          assignmentResult.status !== "assigned" &&
          assignmentResult.status !== "already_assigned"
        ) {
          return NextResponse.json(
            {
              error:
                "message" in assignmentResult
                  ? assignmentResult.message
                  : "Failed to assign employee",
            },
            { status: 400 },
          );
        }
        assignmentWasCreated = assignmentResult.status === "assigned";
      }
    }

    const updatePayload: Record<string, unknown> = {};

    if (payload.name !== undefined) {
      updatePayload.name = payload.name;
      updatePayload.full_name = payload.name;
    }
    if (payload.role !== undefined) Object.assign(updatePayload, canonicalizeRoleWrite(payload.role));
    if (payload.phone !== undefined) updatePayload.phone = payload.phone;
    if (payload.email !== undefined) updatePayload.email = payload.email;
    if (payload.hourlyRate !== undefined) {
      updatePayload.hourly_rate = payload.hourlyRate;
      updatePayload.hourlyRate = payload.hourlyRate;
      updatePayload.pay_rate = payload.hourlyRate;
      updatePayload.rate = payload.hourlyRate;
    }
    if (payload.certifications !== undefined) updatePayload.certifications = payload.certifications;
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.clockedInAt !== undefined) updatePayload.clocked_in_at = payload.clockedInAt;

    let data: any = existingEmployee;
    let error: any = null;
    if (Object.keys(updatePayload).length > 0) {
      const updateResult = await updateWithColumnFallback(
        supabase,
        companyId,
        employeeId,
        updatePayload
      );
      data = updateResult.data;
      error = updateResult.error;
    }

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
      const legacyRolePayload = {
        ...updatePayload,
        role: legacyCompatibleRoleValue(payload.role, "employees"),
      };
      delete (legacyRolePayload as Record<string, unknown>).legacy_permission_profile;
      const retryWithoutRole = await updateWithColumnFallback(
        supabase,
        companyId,
        employeeId,
        legacyRolePayload
      );
      data = retryWithoutRole.data;
      error = retryWithoutRole.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    let updatedEmployee = data;
    if (!updatedEmployee) {
      const refreshedEmployeeResult = await supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId)
        .eq("id", employeeId)
        .maybeSingle();
      if (refreshedEmployeeResult.error) {
        return NextResponse.json({ error: refreshedEmployeeResult.error.message }, { status: 400 });
      }
      updatedEmployee = refreshedEmployeeResult.data;
    }
    if (assignmentWasCreated && assignmentTargetJob) {
      await runJobAssignmentSideEffects({
        supabase,
        companyId,
        actorUserId,
        employee: updatedEmployee ?? existingEmployee,
        job: assignmentTargetJob,
      });
    } else if (explicitlyUnassignedJobId) {
      try {
        await supabase
          .from("schedule_assignments")
          .delete()
          .eq("company_id", companyId)
          .eq("employee_id", employeeId)
          .eq("job_id", explicitlyUnassignedJobId)
          .eq("date", new Date().toISOString().slice(0, 10));
      } catch {
        // Membership removal is authoritative; today's schedule is a mirror.
      }
    }

    if (payload.role !== undefined && updatedEmployee?.user_id) {
      const roleWrite = canonicalizeRoleWrite(payload.role);
      let membershipResult = await supabase
        .from("memberships")
        .update(roleWrite)
        .eq("company_id", companyId)
        .eq("user_id", updatedEmployee.user_id);
      if (isMissingLegacyPermissionProfileColumn(membershipResult.error)) {
        membershipResult = await supabase
          .from("memberships")
          .update({ role: legacyCompatibleRoleValue(payload.role, "memberships") })
          .eq("company_id", companyId)
          .eq("user_id", updatedEmployee.user_id);
      }
      if (membershipResult.error) {
        let membershipInsert = await supabase.from("memberships").insert({
          company_id: companyId,
          user_id: updatedEmployee.user_id,
          ...roleWrite,
        });
        if (isMissingLegacyPermissionProfileColumn(membershipInsert.error)) {
          membershipInsert = await supabase.from("memberships").insert({
            company_id: companyId,
            user_id: updatedEmployee.user_id,
            role: legacyCompatibleRoleValue(payload.role, "memberships"),
          });
        }
      }
    }

    const employee = mapEmployee(
      payload.jobId !== undefined
        ? {
            ...(updatedEmployee ?? {}),
            job_id: requestedJobId ?? null,
          }
        : updatedEmployee
    );
    if (!employee) {
      return NextResponse.json({ error: "Employee update returned no row" }, { status: 500 });
    }

    // Any status change (deactivation OR reactivation) shifts the active seat
    // count, so resync the Stripe subscription quantity in both directions.
    if (payload.status === "inactive" || payload.status === "active") {
      try {
        const syncResult = await syncStripeQuantityForCompany(companyId);
        if (!syncResult.synced) {
          console.warn("[employees/PATCH] stripe quantity not synced after status change:", syncResult.reason);
        }
      } catch (syncErr) {
        console.error("[employees/PATCH] stripe quantity sync error:", syncErr instanceof Error ? syncErr.message : syncErr);
      }
    }

    return NextResponse.json({ employee });
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
    const employeeId = normalizeId(id);

    const employeeResult = await supabase
      .from("employees")
      .select("id, user_id, email")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .maybeSingle();
    if (employeeResult.error) {
      return NextResponse.json({ error: employeeResult.error.message }, { status: 400 });
    }
    if (!employeeResult.data) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }
    const linkedUserId = String(employeeResult.data.user_id ?? "").trim();

    // Use the service-role client for the destructive writes. The caller is
    // already authorized (requireModuleAccess team_management:edit), and RLS on
    // the memberships table only lets a user delete their OWN row — so deleting
    // another member's membership via the request-scoped client silently
    // affects 0 rows (no error), leaving an orphaned membership that still
    // counts toward billable seats. Admin client guarantees the row is removed.
    const admin = getSupabaseAdmin();
    const writeClient = admin ?? supabase;

    const { error } = await writeClient
      .from("employees")
      .delete()
      .eq("company_id", companyId)
      .eq("id", employeeId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (linkedUserId) {
      const membershipDelete = await writeClient
        .from("memberships")
        .delete()
        .eq("company_id", companyId)
        .eq("user_id", linkedUserId);
      if (membershipDelete.error) {
        return NextResponse.json({ error: membershipDelete.error.message }, { status: 400 });
      }

      const permissionsDelete = await writeClient
        .from("module_permissions")
        .delete()
        .eq("company_id", companyId)
        .eq("user_id", linkedUserId);
      if (permissionsDelete.error && !/column .*user_id.* does not exist|Could not find the 'user_id' column/i.test(permissionsDelete.error.message || "")) {
        return NextResponse.json({ error: permissionsDelete.error.message }, { status: 400 });
      }
    }

    // Employee removed — sync Stripe seat count down.
    try {
      const syncResult = await syncStripeQuantityForCompany(companyId);
      if (!syncResult.synced) {
        console.warn("[employees/DELETE] stripe quantity not synced:", syncResult.reason);
      }
    } catch (syncErr) {
      console.error("[employees/DELETE] stripe quantity sync error:", syncErr instanceof Error ? syncErr.message : syncErr);
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
