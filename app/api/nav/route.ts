import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { NAV_ITEMS, normalizeAppRole, toNavItems, type AppRole } from "@/lib/nav/config";
import {
  applyPermissionOverrideFromCookie,
  hasModuleAccess,
  resolveUserModulePermissions,
  TEST_MODULE_ACCESS_COOKIE,
} from "@/lib/permissions/runtime";
import type { ModulePermissionKey } from "@/lib/permissions/types";
import {
  isMissingLegacyPermissionProfileColumn,
  normalizeCanonicalTeamRole,
} from "@/lib/auth/teamRoles";

export const dynamic = "force-dynamic";

const ACTING_ROLE_COOKIE = "gw_acting_role";
const ROLE_RANK: Record<AppRole, number> = {
  admin: 5,
  pm: 4,
  foreman: 3,
  mechanic: 2,
  operator: 1,
};

async function resolveContext() {
  const supabase = await supabaseServer();
  const userResult = await supabase.auth.getUser();
  if (userResult.error || !userResult.data?.user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const userId = userResult.data.user.id;
  let membershipResult = await supabase
    .from("memberships")
    .select("company_id, role, legacy_permission_profile")
    .eq("user_id", userId)
    .order("company_id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (isMissingLegacyPermissionProfileColumn(membershipResult.error)) {
    membershipResult = await supabase
      .from("memberships")
      .select("company_id, role")
      .eq("user_id", userId)
      .order("company_id", { ascending: true })
      .limit(1)
      .maybeSingle();
  }

  if (membershipResult.error) {
    return { error: NextResponse.json({ error: membershipResult.error.message }, { status: 400 }) };
  }
  if (!membershipResult.data?.company_id) {
    return { error: NextResponse.json({ error: "No company workspace found" }, { status: 403 }) };
  }
  const companyId = String(membershipResult.data.company_id);
  const companyResult = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();
  if (companyResult.error) {
    return { error: NextResponse.json({ error: companyResult.error.message }, { status: 400 }) };
  }
  if (!companyResult.data?.id) {
    return { error: NextResponse.json({ error: "Company workspace not found" }, { status: 403 }) };
  }

  return {
    supabase,
    userId,
    userEmail: String(userResult.data.user.email ?? "").trim().toLowerCase(),
    companyId,
    realRole:
      normalizeAppRole(
        membershipResult.data.role,
        membershipResult.data.legacy_permission_profile
      ) ?? "operator",
    canonicalRole: normalizeCanonicalTeamRole(membershipResult.data.role) ?? "team_member",
  };
}

function clampRole(realRole: AppRole, requestedRole: AppRole): AppRole {
  return ROLE_RANK[requestedRole] <= ROLE_RANK[realRole] ? requestedRole : realRole;
}

const NAV_MODULE_MAP: Partial<Record<string, ModulePermissionKey>> = {
  jobs: "jobs",
  fleet: "fleet",
  maintenance: "maintenance",
  safety: "safety",
  messages: "messages",
  inventory: "inventory",
  reports: "reports",
  vendors: "vendors",
  documents: "documents",
  training: "training",
  finance: "finance",
  team: "team_management",
};

export async function GET() {
  const context = await resolveContext();
  if ("error" in context) return context.error;

  try {
    const cookieStore = await cookies();
    const e2eRole =
      process.env.NODE_ENV !== "production" || process.env.E2E === "true"
        ? normalizeAppRole(cookieStore.get("e2e_role")?.value)
        : null;
    const actingRole = normalizeAppRole(cookieStore.get(ACTING_ROLE_COOKIE)?.value);

    const role = e2eRole ?? (actingRole ? clampRole(context.realRole, actingRole) : context.realRole);
    let modulePermissions = await resolveUserModulePermissions({
      supabase: context.supabase,
      companyId: context.companyId,
      userId: context.userId,
      role,
    });
    if (process.env.NODE_ENV !== "production" || process.env.E2E === "true") {
      modulePermissions = applyPermissionOverrideFromCookie(
        modulePermissions,
        cookieStore.get(TEST_MODULE_ACCESS_COOKIE)?.value
      );
    }

    const roleNavKeys = new Set(toNavItems(role).map((item) => item.key));
    const filteredItems = NAV_ITEMS.filter((item) => {
      const moduleKey = NAV_MODULE_MAP[item.key];
      if (moduleKey) {
        return hasModuleAccess(modulePermissions, moduleKey, "view");
      }
      return roleNavKeys.has(item.key);
    });

    return NextResponse.json({
      items: filteredItems,
      role,
      displayRole: context.canonicalRole,
      canonicalRole: context.canonicalRole,
      realRole: context.realRole,
      canSwitchRoleView: false,
      moduleAccess: modulePermissions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
