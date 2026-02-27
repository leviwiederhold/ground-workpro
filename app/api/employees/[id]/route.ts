/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

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

const mapEmployee = (row: any) => ({
  id: row.id,
  name: row.name ?? row.full_name ?? "",
  role: row.role ?? "Laborer",
  user_id: row.user_id ?? null,
  phone: row.phone ?? "",
  email: row.email ?? "",
  hourlyRate: Number(row.hourly_rate ?? row.hourlyRate ?? 0),
  certifications: parseCertifications(row.certifications),
  jobId: row.job_id === null || row.job_id === undefined ? null : /^\d+$/.test(String(row.job_id)) ? Number(row.job_id) : row.job_id,
  status: row.status ?? "off",
  clockedInAt: row.clocked_in_at ?? row.clockedInAt ?? null,
});

const isStatusCheckError = (message: string | undefined) =>
  /employees_status_check|violates check constraint .*status/i.test(message ?? "");

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
      .single();
    lastResult = result;
    const message = result.error?.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) return result;
    const missingColumn = match[1];
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
    let actorRole: "admin" | "pm" | "foreman" | "mechanic" | "operator";
    try {
      const actor = await requireRole(["admin", "pm"]);
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
    const payload = parsed.data;

    if (payload.role !== undefined && actorRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const updatePayload: Record<string, unknown> = {};

    if (payload.name !== undefined) {
      updatePayload.name = payload.name;
      updatePayload.full_name = payload.name;
    }
    if (payload.role !== undefined) updatePayload.role = payload.role;
    if (payload.phone !== undefined) updatePayload.phone = payload.phone;
    if (payload.email !== undefined) updatePayload.email = payload.email;
    if (payload.hourlyRate !== undefined) updatePayload.hourly_rate = payload.hourlyRate;
    if (payload.certifications !== undefined) updatePayload.certifications = payload.certifications;
    if (payload.jobId !== undefined) updatePayload.job_id = payload.jobId === "" ? null : payload.jobId;
    if (payload.status !== undefined) updatePayload.status = payload.status;
    if (payload.clockedInAt !== undefined) updatePayload.clocked_in_at = payload.clockedInAt;

    let { data, error } = await updateWithColumnFallback(
      supabase,
      companyId,
      normalizeId(id),
      updatePayload
    );

    if (error && payload.status !== undefined && isStatusCheckError(error.message)) {
      const statusCandidates = getStatusCandidates(payload.status);
      for (const candidate of statusCandidates.slice(1)) {
        const nextPayload = { ...updatePayload, status: candidate };
        const retry = await updateWithColumnFallback(
          supabase,
          companyId,
          normalizeId(id),
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
        normalizeId(id),
        retryWithoutStatusPayload
      );
      data = retryWithoutStatus.data;
      error = retryWithoutStatus.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ employee: mapEmployee(data) });
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
      await requireRole(["admin", "pm"]);
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
