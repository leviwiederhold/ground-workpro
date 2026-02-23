export type OnboardingChecklistKey =
  | "invite_teammate"
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
  scope: "company" | "user";
};

export const ONBOARDING_DISMISSED_KEY = "__card_dismissed__";

export type OnboardingChecklistRole = "admin" | "pm" | "foreman" | "mechanic" | "operator";

type OnboardingChecklistRoleItemDef = OnboardingChecklistItemDef & {
  roles: OnboardingChecklistRole[];
};

const ONBOARDING_CHECKLIST_ITEMS_BY_ROLE: OnboardingChecklistRoleItemDef[] = [
  {
    key: "invite_teammate",
    label: "Invite a teammate",
    description: "Bring at least one teammate into your workspace.",
    view: "team",
    scope: "company",
    roles: ["admin", "pm"],
  },
  {
    key: "create_first_job",
    label: "Create first job",
    description: "Create your first project record.",
    view: "jobs",
    scope: "company",
    roles: ["admin", "pm"],
  },
  {
    key: "create_first_bid",
    label: "Create first bid",
    description: "Build your first bid in the system.",
    view: "bids",
    scope: "company",
    roles: ["admin", "pm"],
  },
  {
    key: "send_first_proposal",
    label: "Send first proposal",
    description: "Send your first bid/proposal to a customer.",
    view: "bids",
    scope: "company",
    roles: ["admin", "pm"],
  },
  {
    key: "add_first_equipment",
    label: "Add first equipment",
    description: "Create your first fleet asset.",
    view: "fleet",
    scope: "company",
    roles: ["admin", "pm"],
  },
  {
    key: "create_first_po",
    label: "Create first PO",
    description: "Create a purchase order in procurement.",
    view: "vendors",
    scope: "company",
    roles: ["admin", "pm"],
  },
  {
    key: "submit_first_daily_report",
    label: "Submit first daily report",
    description: "Submit your first daily field report.",
    view: "reports",
    scope: "user",
    roles: ["foreman", "operator"],
  },
  {
    key: "submit_first_safety_log",
    label: "Submit first safety log",
    description: "Log your first safety event.",
    view: "safety",
    scope: "user",
    roles: ["foreman"],
  },
  {
    key: "upload_first_photo",
    label: "Upload first photo",
    description: "Upload your first job photo/attachment.",
    view: "documents",
    scope: "user",
    roles: ["operator"],
  },
  {
    key: "close_first_work_order",
    label: "Close first work order",
    description: "Complete and close a maintenance work order.",
    view: "maintenance",
    scope: "user",
    roles: ["mechanic"],
  },
];

export const ONBOARDING_CHECKLIST_ITEMS: OnboardingChecklistItemDef[] = ONBOARDING_CHECKLIST_ITEMS_BY_ROLE.map(
  (item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      view: item.view,
      scope: item.scope,
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
      scope: item.scope,
    }));
}
