export type OnboardingChecklistKey =
  | "company_profile"
  | "invite_teammate"
  | "first_job"
  | "add_equipment_or_inventory"
  | "create_bid"
  | "send_proposal"
  | "upload_attachment"
  | "first_safety_log";

export type OnboardingChecklistItemDef = {
  key: OnboardingChecklistKey;
  label: string;
  description: string;
  view: string;
};

export const ONBOARDING_DISMISSED_KEY = "__card_dismissed__";

export type OnboardingChecklistRole = "admin" | "pm" | "foreman" | "mechanic" | "operator";

type OnboardingChecklistRoleItemDef = OnboardingChecklistItemDef & {
  roles: OnboardingChecklistRole[];
};

const ONBOARDING_CHECKLIST_ITEMS_BY_ROLE: OnboardingChecklistRoleItemDef[] = [
  {
    key: "company_profile",
    label: "Create company profile",
    description: "Set your company details and branding.",
    view: "dashboard",
    roles: ["admin", "pm"],
  },
  {
    key: "invite_teammate",
    label: "Invite a teammate",
    description: "Bring at least one teammate into your workspace.",
    view: "team",
    roles: ["admin", "pm", "foreman"],
  },
  {
    key: "first_job",
    label: "Add first job",
    description: "Create your first project record.",
    view: "jobs",
    roles: ["admin", "pm", "foreman"],
  },
  {
    key: "add_equipment_or_inventory",
    label: "Add equipment (or inventory)",
    description: "Create your first fleet asset or inventory item.",
    view: "fleet",
    roles: ["admin", "pm", "mechanic"],
  },
  {
    key: "create_bid",
    label: "Create a bid",
    description: "Build your first bid in the system.",
    view: "bids",
    roles: ["admin", "pm"],
  },
  {
    key: "send_proposal",
    label: "Send proposal",
    description: "Send your first bid/proposal to a customer.",
    view: "bids",
    roles: ["admin", "pm"],
  },
  {
    key: "upload_attachment",
    label: "Upload attachment",
    description: "Upload at least one file to a job/report/work order.",
    view: "jobs",
    roles: ["admin", "pm", "foreman", "mechanic", "operator"],
  },
  {
    key: "first_safety_log",
    label: "Create first safety log",
    description: "Log your first safety event.",
    view: "safety",
    roles: ["admin", "pm", "foreman", "mechanic", "operator"],
  },
];

export const ONBOARDING_CHECKLIST_ITEMS: OnboardingChecklistItemDef[] = ONBOARDING_CHECKLIST_ITEMS_BY_ROLE.map(
  (item) => ({
    key: item.key,
    label: item.label,
    description: item.description,
    view: item.view,
  })
);

const CHECKLIST_KEY_SET = new Set(ONBOARDING_CHECKLIST_ITEMS_BY_ROLE.map((item) => item.key));

export function isOnboardingChecklistKey(value: string): value is OnboardingChecklistKey {
  return CHECKLIST_KEY_SET.has(value as OnboardingChecklistKey);
}

export function getOnboardingChecklistItemsForRole(role: OnboardingChecklistRole): OnboardingChecklistItemDef[] {
  return ONBOARDING_CHECKLIST_ITEMS_BY_ROLE
    .filter((item) => item.roles.includes(role))
    .map((item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      view: item.view,
    }));
}
