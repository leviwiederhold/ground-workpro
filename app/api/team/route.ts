import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { normalizeAppRole, type AppRole } from "@/lib/nav/config";

const querySchema = z.object({
  q: z.string().trim().optional().default(""),
  status: z.enum(["all", "active", "inactive"]).optional().default("all"),
  role: z.enum(["all", "admin", "pm", "foreman", "mechanic", "operator"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(50).optional().default(25),
});

const normalizeId = (value: unknown) => String(value ?? "");

const mapEmployeeStatus = (value: unknown): "active" | "inactive" => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "clocked-in" || normalized === "active" || normalized === "on_site" || normalized === "onsite") {
    return "active";
  }
  return "inactive";
};

const mapRoleForOutput = (rawRole: unknown): string => {
  const raw = String(rawRole ?? "").trim();
  if (!raw) return "operator";
  const normalized = normalizeAppRole(raw);
  if (normalized) return normalized;
  return raw.toLowerCase();
};

const isPayVisibleRole = (role: AppRole | null) => role === "admin" || role === "pm";

const toNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseCertifications = (value: unknown): Array<{ name: string; expires: string }> => {
  if (!value) return [];
  if (Array.isArray(value)) return value as Array<{ name: string; expires: string }>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Array<{ name: string; expires: string }>) : [];
    } catch {
      return [];
    }
  }
  return [];
};

const isMissingSchemaError = (message: string | undefined) =>
  /(column .* does not exist|Could not find the '.*' column|relation .* does not exist|Could not find the table)/i.test(
    message ?? ""
  );

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase, companyId } = await getCompanyId();
    const effectiveRole = await getEffectiveRole();
    if (!effectiveRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsedQuery = querySchema.safeParse({
      q: new URL(request.url).searchParams.get("q") ?? undefined,
      status: new URL(request.url).searchParams.get("status") ?? undefined,
      role: new URL(request.url).searchParams.get("role") ?? undefined,
      limit: new URL(request.url).searchParams.get("limit") ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsedQuery.error.issues.map((issue: { path: Array<string | number>; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const queryInput = parsedQuery.data;
    const employeesQuery = supabase
      .from("employees")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(queryInput.limit);

    const normalizedSearch = String(queryInput.q ?? "").trim().toLowerCase();

    let { data: employeeRows, error: employeesError } = await employeesQuery;
    if (employeesError && isMissingSchemaError(employeesError.message)) {
      const fallbackQuery = supabase
        .from("employees")
        .select("*")
        .eq("company_id", companyId)
        .order("id", { ascending: false })
        .limit(queryInput.limit);
      const fallbackResult = await fallbackQuery;
      employeeRows = fallbackResult.data;
      employeesError = fallbackResult.error;
    }
    if (employeesError) {
      return NextResponse.json({ error: employeesError.message }, { status: 400 });
    }

    const employeeJobIdById = new Map<string, string>();
    let items = (employeeRows ?? []).map((row: Record<string, unknown>) => {
      const normalizedRole = mapRoleForOutput(row.role);
      const linkedUserId = row.user_id ? normalizeId(row.user_id) : null;
      const employeeId = normalizeId(row.id);
      const fallbackJobId = normalizeId(row.job_id);
      if (employeeId && fallbackJobId) {
        employeeJobIdById.set(employeeId, fallbackJobId);
      }
      return {
        id: employeeId,
        displayName: String(row.name ?? row.full_name ?? ""),
        role: normalizedRole,
        status: mapEmployeeStatus(row.status),
        userId: linkedUserId,
        accountStatus: linkedUserId ? "active" : "invited",
        assignedToday: null as { jobId: string; jobName: string; href: string } | null,
        hoursThisWeek: 0,
        pay: {
          visible: isPayVisibleRole(effectiveRole),
          hourlyRate: isPayVisibleRole(effectiveRole)
            ? toNumber(row.hourly_rate ?? row.hourlyRate ?? row.pay_rate ?? row.rate)
            : 0,
          loadedHourlyCost: 0,
        },
        email: String(row.email ?? ""),
        phone: String(row.phone ?? ""),
        clockedInAt: row.clocked_in_at ? String(row.clocked_in_at) : null,
        certifications: parseCertifications(row.certifications),
      };
    });

    if (normalizedSearch) {
      items = items.filter((item) =>
        [item.displayName, item.email, item.phone, item.role]
          .map((value) => String(value ?? "").toLowerCase())
          .some((value) => value.includes(normalizedSearch))
      );
    }

    if (queryInput.role !== "all") {
      items = items.filter((item) => {
        const normalized = normalizeAppRole(item.role);
        return item.role === queryInput.role || normalized === queryInput.role;
      });
    }
    if (queryInput.status !== "all") {
      items = items.filter((item) => item.status === queryInput.status);
    }

    const employeeIds = items.map((item) => item.id);
    if (employeeIds.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const pendingInviteResult = await supabase
      .from("pending_invitations")
      .select("employee_id, email, accepted_at, expires_at")
      .eq("company_id", companyId)
      .in("employee_id", employeeIds)
      .order("created_at", { ascending: false });
    let inviteStatusRows: Array<Record<string, unknown>> = (pendingInviteResult.data ??
      []) as Array<Record<string, unknown>>;
    if (pendingInviteResult.error) {
      const inviteStatusResult = await supabase
        .from("invite_tokens")
        .select("employee_id, email, used_at, expires_at")
        .eq("company_id", companyId)
        .in("employee_id", employeeIds)
        .order("created_at", { ascending: false });
      inviteStatusRows = (inviteStatusResult.data ?? []) as Array<Record<string, unknown>>;
      if (inviteStatusResult.error) {
        if (isMissingSchemaError(inviteStatusResult.error.message)) {
          inviteStatusRows = [];
        } else {
          return NextResponse.json({ error: inviteStatusResult.error.message }, { status: 400 });
        }
      }
    }
    const pendingInviteEmployeeIds = new Set<string>();
    const acceptedInviteEmployeeIds = new Set<string>();
    const acceptedInviteEmails = new Set<string>();
    for (const row of inviteStatusRows) {
      const employeeId = normalizeId(row.employee_id);
      if (!employeeId) continue;
      const usedAt = row.used_at ? String(row.used_at) : row.accepted_at ? String(row.accepted_at) : "";
      const expiresAt = row.expires_at ? new Date(String(row.expires_at)).getTime() : Number.POSITIVE_INFINITY;
      if (usedAt) {
        acceptedInviteEmployeeIds.add(employeeId);
        const usedEmail = String(row.email ?? "").trim().toLowerCase();
        if (usedEmail) acceptedInviteEmails.add(usedEmail);
        continue;
      }
      if (expiresAt > Date.now()) {
        pendingInviteEmployeeIds.add(employeeId);
      }
    }

    const employeeEmails = Array.from(
      new Set(
        items
          .map((item) => String(item.email ?? "").trim().toLowerCase())
          .filter(Boolean)
      )
    );
    if (employeeEmails.length > 0) {
      let acceptedByEmailResult = await supabase
        .from("pending_invitations")
        .select("email")
        .eq("company_id", companyId)
        .not("accepted_at", "is", null)
        .in("email", employeeEmails);
      if (acceptedByEmailResult.error) {
        acceptedByEmailResult = await supabase
          .from("invite_tokens")
          .select("email")
          .eq("company_id", companyId)
          .not("used_at", "is", null)
          .in("email", employeeEmails);
      }
      if (!acceptedByEmailResult.error) {
        for (const row of (acceptedByEmailResult.data ?? []) as Array<Record<string, unknown>>) {
          const value = String(row.email ?? "").trim().toLowerCase();
          if (value) acceptedInviteEmails.add(value);
        }
      }
    }

    const companyMemberEmails = new Set<string>();
    const companyUserIdByEmail = new Map<string, string>();
    const membershipRoleByUserId = new Map<string, string>();
    const membershipsResult = await supabase
      .from("memberships")
      .select("user_id, role")
      .eq("company_id", companyId);
    if (!membershipsResult.error) {
      for (const row of (membershipsResult.data ?? []) as Array<Record<string, unknown>>) {
        const membershipUserId = normalizeId(row.user_id);
        if (!membershipUserId) continue;
        const membershipRole = mapRoleForOutput(row.role);
        if (membershipRole) membershipRoleByUserId.set(membershipUserId, membershipRole);
      }
      const memberUserIds = Array.from(
        new Set((membershipsResult.data ?? []).map((row: Record<string, unknown>) => normalizeId(row.user_id)).filter(Boolean))
      );
      if (memberUserIds.length > 0) {
        const profilesResult = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", memberUserIds);
        if (!profilesResult.error) {
          for (const row of (profilesResult.data ?? []) as Array<Record<string, unknown>>) {
            const email = String(row.email ?? "").trim().toLowerCase();
            if (email) companyMemberEmails.add(email);
            const profileUserId = normalizeId(row.id);
            if (email && profileUserId) companyUserIdByEmail.set(email, profileUserId);
          }
        }
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const assignmentResult = await supabase
      .from("schedule_assignments")
      .select("employee_id, job_id, created_at")
      .eq("company_id", companyId)
      .eq("date", today)
      .in("employee_id", employeeIds)
      .order("created_at", { ascending: true });
    let assignmentRows = assignmentResult.data;
    let scheduleAssignmentsMissing = false;
    if (assignmentResult.error) {
      if (isMissingSchemaError(assignmentResult.error.message)) {
        assignmentRows = [];
        scheduleAssignmentsMissing = true;
      } else {
        return NextResponse.json({ error: assignmentResult.error.message }, { status: 400 });
      }
    }

    const assignmentByEmployeeId = new Map<string, { jobId: string }>();
    for (const row of (assignmentRows ?? []) as Array<Record<string, unknown>>) {
      const employeeId = normalizeId(row.employee_id);
      if (!employeeId || assignmentByEmployeeId.has(employeeId)) continue;
      assignmentByEmployeeId.set(employeeId, { jobId: normalizeId(row.job_id) });
    }

    if (scheduleAssignmentsMissing) {
      const jobEmployeesResult = await supabase
        .from("job_employees")
        .select("employee_id, job_id, created_at")
        .eq("company_id", companyId)
        .in("employee_id", employeeIds)
        .order("created_at", { ascending: true });
      if (!jobEmployeesResult.error) {
        for (const row of (jobEmployeesResult.data ?? []) as Array<Record<string, unknown>>) {
          const employeeId = normalizeId(row.employee_id);
          if (!employeeId || assignmentByEmployeeId.has(employeeId)) continue;
          assignmentByEmployeeId.set(employeeId, { jobId: normalizeId(row.job_id) });
        }
      }
    }

    const assignedJobIds = Array.from(
      new Set(
        Array.from(assignmentByEmployeeId.values())
          .map((value) => value.jobId)
          .filter(Boolean)
      )
    );

    let jobNameById = new Map<string, string>();
    if (assignedJobIds.length > 0) {
      const { data: jobs, error: jobsError } = await supabase
        .from("jobs")
        .select("id, name")
        .eq("company_id", companyId)
        .in("id", assignedJobIds);
      if (jobsError) {
        return NextResponse.json({ error: jobsError.message }, { status: 400 });
      }
      jobNameById = new Map(
        (jobs ?? []).map((job: Record<string, unknown>) => [normalizeId(job.id), String(job.name ?? "Job")])
      );
    }

    // Time entries table is not present in current schema; keep deterministic placeholder.
    for (const item of items) {
      const employeeEmail = String(item.email ?? "").trim().toLowerCase();
      const linkedUserId =
        String(item.userId ?? "").trim() ||
        companyUserIdByEmail.get(employeeEmail) ||
        "";
      const membershipRole = linkedUserId ? membershipRoleByUserId.get(linkedUserId) : null;
      if (membershipRole) {
        item.role = membershipRole;
      }
      if (item.userId) {
        item.accountStatus = "active";
      } else if (employeeEmail && companyMemberEmails.has(employeeEmail)) {
        item.accountStatus = "active";
      } else if (employeeEmail && acceptedInviteEmails.has(employeeEmail)) {
        item.accountStatus = "active";
      } else if (acceptedInviteEmployeeIds.has(item.id)) {
        item.accountStatus = "active";
      } else if (pendingInviteEmployeeIds.has(item.id)) {
        item.accountStatus = "pending";
      } else {
        item.accountStatus = "invited";
      }

      const assignment = assignmentByEmployeeId.get(item.id);
      const resolvedJobId = assignment?.jobId || employeeJobIdById.get(item.id) || "";
      if (resolvedJobId) {
        item.assignedToday = {
          jobId: resolvedJobId,
          jobName: jobNameById.get(resolvedJobId) ?? "Job",
          href: `/jobs/${resolvedJobId}`,
        };
      }
      item.hoursThisWeek = 0;
      if (item.pay.visible) {
        const burdenPct = 0;
        item.pay.loadedHourlyCost = Number((item.pay.hourlyRate * (1 + burdenPct)).toFixed(2));
      } else {
        item.pay.hourlyRate = 0;
        item.pay.loadedHourlyCost = 0;
      }
    }

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        displayName: item.displayName,
        role: item.role,
        status: item.status,
        userId: item.userId,
        accountStatus: item.accountStatus,
        assignedToday: item.assignedToday,
        hoursThisWeek: item.hoursThisWeek,
        pay: item.pay,
        email: item.email,
        phone: item.phone,
        clockedInAt: item.clockedInAt,
        certifications: item.certifications,
      })),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
