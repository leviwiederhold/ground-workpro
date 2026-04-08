import { checkModuleAccessLevel } from "@/lib/permissions/access";
import type { ModuleAccessLevel, ModulePermissionKey, ModulePermissionMap } from "@/lib/permissions/types";
import { ROUTE_GUARDS, type AppRole } from "@/lib/nav/config";

export type OnboardingChecklistKey =
  | "complete_company_settings"
  | "upload_company_logo"
  | "set_company_timezone"
  | "invite_teammate"
  | "configure_permissions"
  | "finish_profile"
  | "complete_account_settings"
  | "create_first_job"
  | "create_first_bid"
  | "send_first_proposal"
  | "add_first_equipment"
  | "create_first_po"
  | "submit_first_daily_report"
  | "submit_first_safety_log"
  | "upload_first_photo"
  | "close_first_work_order";

export type OnboardingChecklistItemDef = {
  key: OnboardingChecklistKey;
  label: string;
  description: string;
  view: string;
  href: string;
  scope: "company" | "user";
};

export const ONBOARDING_DISMISSED_KEY = "__card_dismissed__";

type OnboardingChecklistRoleItemDef = OnboardingChecklistItemDef & {
  roles: AppRole[];
  requiredModule?: ModulePermissionKey;
  requiredAccess?: ModuleAccessLevel;
  available?: boolean;
};

const ONBOARDING_CHECKLIST_ITEMS_BY_ROLE: OnboardingChecklistRoleItemDef[] = [
  {
    key: "complete_company_settings",
    label: "Complete company settings",
    description: "Fill out key company profile details and defaults.",
    view: "settings",
    href: "/settings/company?onboarding=1",
    scope: "company",
    roles: ["admin"],
  },
  {
    key: "upload_company_logo",
    label: "Upload company logo",
    description: "Add your company logo for branded header/profile display.",
    view: "settings",
    href: "/settings/company?onboarding=1",
    scope: "company",
    roles: ["admin"],
  },
  {
    key: "set_company_timezone",
    label: "Set timezone",
    description: "Set your primary company timezone for scheduling.",
    view: "settings",
    href: "/settings/company?onboarding=1",
    scope: "company",
    roles: ["admin"],
  },
  {
    key: "invite_teammate",
    label: "Invite a teammate",
    description: "Bring at least one teammate into your workspace.",
    view: "team",
    href: "/team?onboarding=1",
    scope: "company",
    roles: ["admin", "pm"],
    requiredModule: "team_management",
    requiredAccess: "edit",
  },
  {
    key: "configure_permissions",
    label: "Configure permissions",
    description: "Review module permissions for your team roles.",
    view: "team",
    href: "/team?onboarding=1",
    scope: "company",
    roles: ["admin", "pm"],
    requiredModule: "team_management",
    requiredAccess: "edit",
  },
  {
    key: "finish_profile",
    label: "Finish profile",
    description: "Complete your personal profile details.",
    view: "settings",
    href: "/profile?onboarding=1",
    scope: "user",
    roles: ["admin", "pm", "foreman", "mechanic", "operator"],
  },
  {
    key: "complete_account_settings",
    label: "Complete account settings",
    description: "Set your notification and account preferences.",
    view: "settings",
    href: "/settings/account?onboarding=1",
    scope: "user",
    roles: ["admin", "pm", "foreman", "mechanic", "operator"],
  },
  {
    key: "create_first_job",
    label: "Create first job",
    description: "Create your first project record.",
    view: "jobs",
    href: "/jobs",
    scope: "company",
    roles: ["admin", "pm"],
    requiredModule: "jobs",
    requiredAccess: "edit",
  },
  {
    key: "create_first_bid",
    label: "Create first bid",
    description: "Build your first bid in the system.",
    view: "bids",
    href: "/bids",
    scope: "company",
    roles: ["admin", "pm"],
  },
  {
    key: "send_first_proposal",
    label: "Send first proposal",
    description: "Send your first bid/proposal to a customer.",
    view: "bids",
    href: "/bids",
    scope: "company",
    roles: ["admin", "pm"],
  },
  {
    key: "add_first_equipment",
    label: "Add first equipment",
    description: "Create your first fleet asset.",
    view: "fleet",
    href: "/fleet",
    scope: "company",
    roles: ["admin", "pm"],
    requiredModule: "fleet",
    requiredAccess: "edit",
  },
  {
    key: "create_first_po",
    label: "Create first PO",
    description: "Create a purchase order in procurement.",
    view: "vendors",
    href: "/vendors",
    scope: "company",
    roles: ["admin", "pm"],
  },
  {
    key: "submit_first_daily_report",
    label: "Submit first daily report",
    description: "Submit your first daily field report.",
    view: "reports",
    href: "daily-report",
    scope: "user",
    roles: ["foreman", "operator"],
    requiredModule: "daily_reports",
    requiredAccess: "edit",
  },
  {
    key: "submit_first_safety_log",
    label: "Submit first safety log",
    description: "Log your first safety event.",
    view: "safety",
    href: "/safety",
    scope: "user",
    roles: ["foreman"],
    requiredModule: "safety",
    requiredAccess: "edit",
  },
  {
    key: "upload_first_photo",
    label: "Upload first photo",
    description: "Upload your first job photo/attachment.",
    view: "documents",
    href: "/documents",
    scope: "user",
    roles: ["operator"],
    requiredModule: "documents",
    requiredAccess: "edit",
  },
  {
    key: "close_first_work_order",
    label: "Close first work order",
    description: "Complete and close a maintenance work order.",
    view: "maintenance",
    href: "/maintenance",
    scope: "user",
    roles: ["mechanic"],
    requiredModule: "maintenance",
    requiredAccess: "edit",
  },
];

export const ONBOARDING_CHECKLIST_ITEMS: OnboardingChecklistItemDef[] = ONBOARDING_CHECKLIST_ITEMS_BY_ROLE.map(
  (item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      view: item.view,
      href: item.href,
      scope: item.scope,
    })
);

const CHECKLIST_KEY_SET = new Set(ONBOARDING_CHECKLIST_ITEMS_BY_ROLE.map((item) => item.key));

export function isOnboardingChecklistKey(value: string): value is OnboardingChecklistKey {
  return CHECKLIST_KEY_SET.has(value as OnboardingChecklistKey);
}

function canAccessChecklistHref(role: AppRole, href: string) {
  if (!href.startsWith("/")) return true;
  const [path] = href.split("?");
  const allowedRoles = ROUTE_GUARDS[path];
  if (!allowedRoles) return true;
  return allowedRoles.includes(role);
}

export function getOnboardingChecklistItemsForRole(
  role: AppRole,
  options?: { permissions?: ModulePermissionMap }
): OnboardingChecklistItemDef[] {
  return ONBOARDING_CHECKLIST_ITEMS_BY_ROLE
    .filter((item) => item.roles.includes(role))
    .filter((item) => item.available !== false)
    .filter((item) => canAccessChecklistHref(role, item.href))
    .filter((item) => {
      if (!item.requiredModule) return true;
      if (!options?.permissions) return true;
      return checkModuleAccessLevel(options.permissions, item.requiredModule, item.requiredAccess ?? "view");
    })
    .map((item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      view: item.view,
      href: item.href,
      scope: item.scope,
    }));
}
