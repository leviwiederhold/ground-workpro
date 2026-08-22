import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { normalizeAppRole } from "@/lib/nav/config";
import { getTimeEntrySummaryByUser } from "@/lib/time-clock/summary";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isEmployeeRoleReviewPending } from "@/lib/team/roleReview";
import { resolveStoredInvitationRole } from "@/lib/permissions/access";
import type { ModulePermissionRow } from "@/lib/permissions/types";

const querySchema = z.object({
  q: z.string().trim().optional().default(""),
  status: z.enum(["all", "active", "inactive"]).optional().default("all"),
  role: z.enum(["all", "admin", "pm", "foreman", "mechanic", "operator", "fieldstaff"]).optional().default("all"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
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
  if (/fieldstaff|field_staff|field staff/i.test(raw)) return "fieldstaff";
  const normalized = normalizeAppRole(raw);
  if (normalized) return normalized;
  return raw.toLowerCase();
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
    try {
      await requireModuleAccess("team_management", "view");
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { supabase, companyId } = await getCompanyId();
    if (!(await getEffectiveRole())) {
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
        storedRole: normalizedRole,
        status: mapEmployeeStatus(row.status),
        userId: linkedUserId,
        accountStatus: linkedUserId ? "active" : "invited",
        assignedToday: null as { jobId: string; jobName: string; href: string } | null,
        hoursThisWeek: 0,
        pay: { visible: false },
        email: String(row.email ?? ""),
        phone: String(row.phone ?? ""),
        avatarUrl: "",
        clockedInAt: row.clocked_in_at ? String(row.clocked_in_at) : null,
        certifications: parseCertifications(row.certifications),
        joinedViaCompanyCodeAt: row.joined_via_company_code_at
          ? String(row.joined_via_company_code_at)
          : null,
        roleReviewedAt: row.role_reviewed_at ? String(row.role_reviewed_at) : null,
        roleReviewPending: false,
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

    const employeeIds = items.map((item) => item.id);
    if (employeeIds.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const adminDb = getSupabaseAdmin() ?? supabase;

    const pendingInviteResult = await adminDb
      .from("pending_invitations")
      .select("employee_id, email, role, accepted_at, accepted_user_id, expires_at")
      .eq("company_id", companyId)
      .in("employee_id", employeeIds)
      .order("created_at", { ascending: false });
    let inviteStatusRows: Array<Record<string, unknown>> = [];
    if (!pendingInviteResult.error) {
      inviteStatusRows = (pendingInviteResult.data ?? []) as Array<Record<string, unknown>>;
    } else if (!isMissingSchemaError(pendingInviteResult.error.message)) {
      return NextResponse.json({ error: pendingInviteResult.error.message }, { status: 400 });
    }

    const inviteStatusResult = await adminDb
      .from("invite_tokens")
      .select("employee_id, email, role, used_at, expires_at")
      .eq("company_id", companyId)
      .in("employee_id", employeeIds)
      .order("created_at", { ascending: false });
    if (!inviteStatusResult.error) {
      inviteStatusRows.push(...((inviteStatusResult.data ?? []) as Array<Record<string, unknown>>));
    } else if (!isMissingSchemaError(inviteStatusResult.error.message)) {
      return NextResponse.json({ error: inviteStatusResult.error.message }, { status: 400 });
    }
    const pendingInviteEmployeeIds = new Set<string>();
    const acceptedInviteEmployeeIds = new Set<string>();
    const acceptedInviteEmails = new Set<string>();
    const acceptedInviteUserIdByEmployeeId = new Map<string, string>();
    const acceptedInviteUserIdByEmail = new Map<string, string>();
    const fieldStaffEmployeeIds = new Set<string>();
    const fieldStaffEmails = new Set<string>();
    const fieldStaffUserIds = new Set<string>();
    for (const row of inviteStatusRows) {
      const employeeId = normalizeId(row.employee_id);
      if (!employeeId) continue;
      const inviteRole = String(row.role ?? "").trim().toLowerCase();
      const inviteEmail = String(row.email ?? "").trim().toLowerCase();
      if (inviteRole.includes("fieldstaff") || inviteRole.includes("field_staff") || inviteRole.includes("field staff")) {
        fieldStaffEmployeeIds.add(employeeId);
        if (inviteEmail) fieldStaffEmails.add(inviteEmail);
      }
      const usedAt = row.used_at ? String(row.used_at) : row.accepted_at ? String(row.accepted_at) : "";
      const acceptedUserId = String(row.accepted_user_id ?? "").trim();
      const expiresAt = row.expires_at ? new Date(String(row.expires_at)).getTime() : Number.POSITIVE_INFINITY;
      if (usedAt) {
        acceptedInviteEmployeeIds.add(employeeId);
        if (acceptedUserId) acceptedInviteUserIdByEmployeeId.set(employeeId, acceptedUserId);
        if (inviteEmail) acceptedInviteEmails.add(inviteEmail);
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
      let acceptedByEmailResult: {
        data: Array<Record<string, unknown>> | null;
        error: { message?: string } | null;
      } = await supabase
        .from("pending_invitations")
        .select("email, role, accepted_user_id")
        .eq("company_id", companyId)
        .not("accepted_at", "is", null)
        .in("email", employeeEmails);
      if (acceptedByEmailResult.error) {
        acceptedByEmailResult = await supabase
          .from("invite_tokens")
          .select("email, role")
          .eq("company_id", companyId)
          .not("used_at", "is", null)
          .in("email", employeeEmails);
      }
      if (!acceptedByEmailResult.error) {
        for (const row of (acceptedByEmailResult.data ?? []) as Array<Record<string, unknown>>) {
          const value = String(row.email ?? "").trim().toLowerCase();
          if (value) acceptedInviteEmails.add(value);
          const acceptedUserId = String(row.accepted_user_id ?? "").trim();
          if (value && acceptedUserId) acceptedInviteUserIdByEmail.set(value, acceptedUserId);
          const inviteRole = String(row.role ?? "").trim().toLowerCase();
          if (value && (inviteRole.includes("fieldstaff") || inviteRole.includes("field_staff") || inviteRole.includes("field staff"))) {
            fieldStaffEmails.add(value);
          }
        }
      }
    }

    const companyMemberEmails = new Set<string>();
    const companyUserIdByEmail = new Map<string, string>();
    const membershipRoleByUserId = new Map<string, string>();
    const profileDisplayNameByUserId = new Map<string, string>();
    const profileAvatarByUserId = new Map<string, string>();
    const membershipsResult = await adminDb
      .from("memberships")
      .select("user_id, role")
      .eq("company_id", companyId);
    if (!membershipsResult.error) {
      for (const [email, acceptedUserId] of acceptedInviteUserIdByEmail) {
        companyUserIdByEmail.set(email, acceptedUserId);
      }
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
        const acceptedInvitesByUserResult = await adminDb
          .from("pending_invitations")
          .select("accepted_user_id, role")
          .eq("company_id", companyId)
          .not("accepted_at", "is", null)
          .in("accepted_user_id", memberUserIds);
        if (!acceptedInvitesByUserResult.error) {
          for (const row of (acceptedInvitesByUserResult.data ?? []) as Array<Record<string, unknown>>) {
            const acceptedUserId = String(row.accepted_user_id ?? "").trim();
            const inviteRole = String(row.role ?? "").trim().toLowerCase();
            if (
              acceptedUserId &&
              (inviteRole.includes("fieldstaff") || inviteRole.includes("field_staff") || inviteRole.includes("field staff"))
            ) {
              fieldStaffUserIds.add(acceptedUserId);
            }
          }
        }
      }
      if (memberUserIds.length > 0) {
        const memberPermissionRows: Array<Record<string, unknown>> = [];
        let memberPermissionsFailed = false;
        // Large established companies can exceed PostgREST URL limits when all
        // membership IDs are placed in one `in` filter.
        for (let offset = 0; offset < memberUserIds.length; offset += 100) {
          const memberPermissionsResult = await adminDb
            .from("module_permissions")
            .select("user_id, module_key, access_level")
            .eq("company_id", companyId)
            .in("user_id", memberUserIds.slice(offset, offset + 100));
          if (memberPermissionsResult.error) {
            memberPermissionsFailed = true;
            break;
          }
          memberPermissionRows.push(
            ...((memberPermissionsResult.data ?? []) as Array<Record<string, unknown>>)
          );
        }
        if (!memberPermissionsFailed) {
          const permissionsByUserId = new Map<string, ModulePermissionRow[]>();
          for (const row of memberPermissionRows) {
            const permissionUserId = String(row.user_id ?? "").trim();
            const moduleKey = String(row.module_key ?? "") as ModulePermissionRow["module_key"];
            const accessLevel = String(row.access_level ?? "") as ModulePermissionRow["access_level"];
            if (!permissionUserId || !moduleKey || !accessLevel) continue;
            const current = permissionsByUserId.get(permissionUserId) ?? [];
            current.push({ module_key: moduleKey, access_level: accessLevel });
            permissionsByUserId.set(permissionUserId, current);
          }
          for (const [permissionUserId, permissions] of permissionsByUserId) {
            if (
              membershipRoleByUserId.get(permissionUserId) === "operator" &&
              resolveStoredInvitationRole("team_member", permissions) === "fieldstaff"
            ) {
              fieldStaffUserIds.add(permissionUserId);
            }
          }
        }
      }
      if (memberUserIds.length > 0) {
        const profilesResult = await adminDb
          .from("profiles")
          .select("id, full_name, display_name, avatar_url")
          .in("id", memberUserIds);
        let profileRows: Array<Record<string, unknown>> = (profilesResult.data ?? []) as Array<Record<string, unknown>>;
        if (profilesResult.error && /display_name|Could not find the 'display_name' column/i.test(profilesResult.error.message || "")) {
          const fallbackProfilesWithAvatar = await adminDb
            .from("profiles")
            .select("id, full_name, avatar_url")
            .in("id", memberUserIds);
          profileRows = (fallbackProfilesWithAvatar.data ?? []) as Array<Record<string, unknown>>;
          if (fallbackProfilesWithAvatar.error && /avatar_url|Could not find the 'avatar_url' column/i.test(fallbackProfilesWithAvatar.error.message || "")) {
            const fallbackProfiles = await adminDb
              .from("profiles")
              .select("id, full_name")
              .in("id", memberUserIds);
            profileRows = (fallbackProfiles.data ?? []) as Array<Record<string, unknown>>;
          }
        } else if (profilesResult.error && /avatar_url|Could not find the 'avatar_url' column/i.test(profilesResult.error.message || "")) {
          const fallbackProfilesWithDisplay = await adminDb
            .from("profiles")
            .select("id, full_name, display_name")
            .in("id", memberUserIds);
          profileRows = (fallbackProfilesWithDisplay.data ?? []) as Array<Record<string, unknown>>;
        }
        const authEmailByUserId = new Map<string, string>();
        const admin = getSupabaseAdmin();
        if (admin) {
          const listUsersResult = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          if (!listUsersResult.error) {
            for (const authUser of listUsersResult.data.users ?? []) {
              const authUserId = String(authUser.id ?? "").trim();
              if (!authUserId || !memberUserIds.includes(authUserId)) continue;
              const authEmail = String(authUser.email ?? "").trim().toLowerCase();
              if (authEmail) authEmailByUserId.set(authUserId, authEmail);
            }
          }
        }
        for (const row of profileRows) {
          const profileUserId = normalizeId(row.id);
          const email = authEmailByUserId.get(profileUserId) ?? "";
          if (email) companyMemberEmails.add(email);
          if (email && profileUserId) companyUserIdByEmail.set(email, profileUserId);
          if (profileUserId) {
            const fullName = String(row.full_name ?? "").trim();
            const displayName = String(row.display_name ?? "").trim();
            const resolvedDisplayName = fullName || displayName || (email ? email : "");
            if (resolvedDisplayName) profileDisplayNameByUserId.set(profileUserId, resolvedDisplayName);
            const avatarUrl = String(row.avatar_url ?? "").trim();
            if (avatarUrl) profileAvatarByUserId.set(profileUserId, avatarUrl);
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

    const userIdsForHours = Array.from(
      new Set(
        items
          .map((item) => String(item.userId ?? "").trim() || companyUserIdByEmail.get(String(item.email ?? "").trim().toLowerCase()) || "")
          .filter(Boolean)
      )
    );
    const timeSummary = await getTimeEntrySummaryByUser({
      supabase,
      companyId,
      userIds: userIdsForHours,
    });

    for (const item of items) {
      const employeeEmail = String(item.email ?? "").trim().toLowerCase();
      const linkedUserId =
        String(item.userId ?? "").trim() ||
        acceptedInviteUserIdByEmployeeId.get(item.id) ||
        companyUserIdByEmail.get(employeeEmail) ||
        "";
      const membershipRole = linkedUserId ? membershipRoleByUserId.get(linkedUserId) : null;
      if (membershipRole) {
        item.role = membershipRole;
      }
      if (
        item.storedRole === "fieldstaff" ||
        fieldStaffEmployeeIds.has(item.id) ||
        fieldStaffEmails.has(employeeEmail) ||
        (linkedUserId && fieldStaffUserIds.has(linkedUserId))
      ) {
        item.role = "fieldstaff";
      }
      if (linkedUserId && !item.userId) {
        item.userId = linkedUserId;
      }
      if (!String(item.displayName ?? "").trim() && linkedUserId) {
        item.displayName = profileDisplayNameByUserId.get(linkedUserId) ?? item.displayName;
      }
      if (linkedUserId) {
        item.avatarUrl = profileAvatarByUserId.get(linkedUserId) ?? "";
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
        item.status = "active";
      }
      item.hoursThisWeek = linkedUserId ? Number(timeSummary.weekHoursByUserId.get(linkedUserId) ?? 0) : 0;
      const activeShiftStart = linkedUserId ? timeSummary.activeShiftStartByUserId.get(linkedUserId) : null;
      if (activeShiftStart) {
        item.clockedInAt = activeShiftStart;
        item.status = "active";
      }
      item.roleReviewPending = isEmployeeRoleReviewPending({
        joinedViaCompanyCodeAt: item.joinedViaCompanyCodeAt,
        roleReviewedAt: item.roleReviewedAt,
        currentRole: item.role,
      });
    }

    if (queryInput.status !== "all") {
      items = items.filter((item) => item.status === queryInput.status);
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
        avatarUrl: item.avatarUrl,
        clockedInAt: item.clockedInAt,
        certifications: item.certifications,
        joinedViaCompanyCode: Boolean(item.joinedViaCompanyCodeAt),
        joinedAt: item.joinedViaCompanyCodeAt,
        roleReviewPending: item.roleReviewPending,
      })),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
