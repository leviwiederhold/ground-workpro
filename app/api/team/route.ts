import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireModuleAccess } from "@/lib/auth/requireRole";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { normalizeAppRole } from "@/lib/nav/config";
import { getTimeEntrySummaryByUser } from "@/lib/time-clock/summary";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { chunkValues } from "@/lib/db/chunk";
import {
  isMissingLegacyPermissionProfileColumn,
  normalizeCanonicalTeamRole,
  normalizeLegacyPermissionProfile,
  type LegacyPermissionProfile,
} from "@/lib/auth/teamRoles";

const querySchema = z.object({
  q: z.string().trim().optional().default(""),
  status: z.enum(["all", "active", "inactive"]).optional().default("all"),
  role: z.enum([
    "all",
    "owner",
    "administrator",
    "manager",
    "crew_lead",
    "team_member",
    "admin",
    "pm",
    "foreman",
    "mechanic",
    "operator",
    "fieldstaff",
  ]).optional().default("all"),
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
  return normalizeCanonicalTeamRole(rawRole) ?? "team_member";
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
        jobTitle: String(row.job_title ?? ""),
        accessProfile: normalizeLegacyPermissionProfile(
          row.role,
          row.legacy_permission_profile
        ) ?? "operator",
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
        recordSource: "employee",
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

    const adminDb = getSupabaseAdmin() ?? supabase;

    let inviteStatusRows: Array<Record<string, unknown>> = [];
    if (employeeIds.length > 0) {
      const pendingInviteResult = await adminDb
        .from("pending_invitations")
        .select("employee_id, email, role, accepted_at, accepted_user_id, expires_at")
        .eq("company_id", companyId)
        .in("employee_id", employeeIds)
        .order("created_at", { ascending: false });
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
    const memberEmailByUserId = new Map<string, string>();
    const membershipRoleByUserId = new Map<string, string>();
    const membershipProfileByUserId = new Map<string, LegacyPermissionProfile>();
    const profileDisplayNameByUserId = new Map<string, string>();
    const profileAvatarByUserId = new Map<string, string>();
    const preferredMembershipsResult = await adminDb
      .from("memberships")
      .select("user_id, role, legacy_permission_profile")
      .eq("company_id", companyId);
    let membershipRows = preferredMembershipsResult.data;
    let membershipsError = preferredMembershipsResult.error;
    if (isMissingLegacyPermissionProfileColumn(membershipsError)) {
      const legacyMembershipsResult = await adminDb
        .from("memberships")
        .select("user_id, role")
        .eq("company_id", companyId);
      membershipRows = (legacyMembershipsResult.data ?? []).map((row) => ({
        ...row,
        legacy_permission_profile: null,
      }));
      membershipsError = legacyMembershipsResult.error;
    }
    if (!membershipsError) {
      for (const [email, acceptedUserId] of acceptedInviteUserIdByEmail) {
        companyUserIdByEmail.set(email, acceptedUserId);
      }
      for (const row of (membershipRows ?? []) as Array<Record<string, unknown>>) {
        const membershipUserId = normalizeId(row.user_id);
        if (!membershipUserId) continue;
        const membershipRole = mapRoleForOutput(row.role);
        if (membershipRole) membershipRoleByUserId.set(membershipUserId, membershipRole);
        const membershipProfile = normalizeLegacyPermissionProfile(
          row.role,
          row.legacy_permission_profile
        );
        if (membershipProfile) membershipProfileByUserId.set(membershipUserId, membershipProfile);
      }
      const memberUserIds = Array.from(
        new Set((membershipRows ?? []).map((row: Record<string, unknown>) => normalizeId(row.user_id)).filter(Boolean))
      );
      if (memberUserIds.length > 0) {
        for (const memberUserIdChunk of chunkValues(memberUserIds)) {
          const acceptedInvitesByUserResult = await adminDb
            .from("pending_invitations")
            .select("accepted_user_id, role")
            .eq("company_id", companyId)
            .not("accepted_at", "is", null)
            .in("accepted_user_id", memberUserIdChunk);
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
      }
      if (memberUserIds.length > 0) {
        const profileRows: Array<Record<string, unknown>> = [];
        for (const memberUserIdChunk of chunkValues(memberUserIds)) {
          const profilesResult = await adminDb
            .from("profiles")
            .select("id, full_name, display_name, avatar_url")
            .in("id", memberUserIdChunk);
          let chunkProfileRows: Array<Record<string, unknown>> = (profilesResult.data ?? []) as Array<Record<string, unknown>>;
          let profilesError = profilesResult.error;
          if (profilesError && /display_name|Could not find the 'display_name' column/i.test(profilesError.message || "")) {
            const fallbackProfilesWithAvatar = await adminDb
              .from("profiles")
              .select("id, full_name, avatar_url")
              .in("id", memberUserIdChunk);
            chunkProfileRows = (fallbackProfilesWithAvatar.data ?? []) as Array<Record<string, unknown>>;
            profilesError = fallbackProfilesWithAvatar.error;
            if (profilesError && /avatar_url|Could not find the 'avatar_url' column/i.test(profilesError.message || "")) {
              const fallbackProfiles = await adminDb
                .from("profiles")
                .select("id, full_name")
                .in("id", memberUserIdChunk);
              chunkProfileRows = (fallbackProfiles.data ?? []) as Array<Record<string, unknown>>;
              profilesError = fallbackProfiles.error;
            }
          } else if (profilesError && /avatar_url|Could not find the 'avatar_url' column/i.test(profilesError.message || "")) {
            const fallbackProfilesWithDisplay = await adminDb
              .from("profiles")
              .select("id, full_name, display_name")
              .in("id", memberUserIdChunk);
            chunkProfileRows = (fallbackProfilesWithDisplay.data ?? []) as Array<Record<string, unknown>>;
            profilesError = fallbackProfilesWithDisplay.error;
          }
          if (profilesError) {
            return NextResponse.json({ error: profilesError.message }, { status: 400 });
          }
          profileRows.push(...chunkProfileRows);
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
              if (authEmail) {
                authEmailByUserId.set(authUserId, authEmail);
                memberEmailByUserId.set(authUserId, authEmail);
              }
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

      // A company membership is the authoritative access record. Some owner or
      // admin accounts predate employee rows, but they must still appear in the
      // Team roster as active members instead of becoming invisible.
      const representedUserIds = new Set(
        items.map((item) => String(item.userId ?? "").trim()).filter(Boolean)
      );
      for (const item of items) {
        const mappedUserId = companyUserIdByEmail.get(String(item.email ?? "").trim().toLowerCase());
        if (mappedUserId) representedUserIds.add(mappedUserId);
      }
      for (const row of (membershipRows ?? []) as Array<Record<string, unknown>>) {
        const membershipUserId = normalizeId(row.user_id);
        if (!membershipUserId || representedUserIds.has(membershipUserId)) continue;
        const membershipRole = mapRoleForOutput(row.role);
        const email = memberEmailByUserId.get(membershipUserId) ?? "";
        items.push({
          id: `membership:${membershipUserId}`,
          displayName:
            profileDisplayNameByUserId.get(membershipUserId) || email || "Active Team Member",
          role: membershipRole,
          jobTitle: "",
          accessProfile:
            normalizeLegacyPermissionProfile(row.role, row.legacy_permission_profile) ?? "operator",
          status: "inactive",
          userId: membershipUserId,
          accountStatus: "active",
          assignedToday: null,
          hoursThisWeek: 0,
          pay: { visible: false },
          email,
          phone: "",
          avatarUrl: profileAvatarByUserId.get(membershipUserId) ?? "",
          clockedInAt: null,
          certifications: [],
          recordSource: "membership",
        });
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    let assignmentRows: Array<Record<string, unknown>> | null = [];
    let scheduleAssignmentsMissing = false;
    if (employeeIds.length > 0) {
      const assignmentResult = await supabase
        .from("schedule_assignments")
        .select("employee_id, job_id, created_at")
        .eq("company_id", companyId)
        .eq("date", today)
        .in("employee_id", employeeIds)
        .order("created_at", { ascending: true });
      assignmentRows = assignmentResult.data as Array<Record<string, unknown>> | null;
      if (assignmentResult.error) {
        if (isMissingSchemaError(assignmentResult.error.message)) {
          assignmentRows = [];
          scheduleAssignmentsMissing = true;
        } else {
          return NextResponse.json({ error: assignmentResult.error.message }, { status: 400 });
        }
      }
    }

    const assignmentByEmployeeId = new Map<string, { jobId: string }>();
    for (const row of (assignmentRows ?? []) as Array<Record<string, unknown>>) {
      const employeeId = normalizeId(row.employee_id);
      if (!employeeId || assignmentByEmployeeId.has(employeeId)) continue;
      assignmentByEmployeeId.set(employeeId, { jobId: normalizeId(row.job_id) });
    }

    if (scheduleAssignmentsMissing && employeeIds.length > 0) {
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
      if (linkedUserId && membershipProfileByUserId.has(linkedUserId)) {
        item.accessProfile = membershipProfileByUserId.get(linkedUserId) ?? item.accessProfile;
      }
      if (fieldStaffEmployeeIds.has(item.id) || fieldStaffEmails.has(employeeEmail) || (linkedUserId && fieldStaffUserIds.has(linkedUserId))) {
        item.role = "team_member";
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
    }

    if (queryInput.status !== "all") {
      items = items.filter((item) => item.status === queryInput.status);
    }

    return NextResponse.json({
      items: items.map((item) => ({
        id: item.id,
        displayName: item.displayName,
        role: item.role,
        jobTitle: item.jobTitle,
        accessProfile: item.accessProfile,
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
        recordSource: item.recordSource ?? "employee",
      })),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
