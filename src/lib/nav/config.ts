export type AppRole = "admin" | "pm" | "foreman" | "mechanic" | "operator";
export type DisplayAppRole = AppRole | "fieldstaff";

export type NavItem = {
  key: string;
  label: string;
  href: string;
  iconKey?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/", iconKey: "table-cells-large" },
  { key: "schedule", label: "Schedule", href: "/schedule", iconKey: "calendar-week" },
  { key: "jobs", label: "Jobs", href: "/jobs", iconKey: "briefcase" },
  { key: "team", label: "Team", href: "/team", iconKey: "people-group" },
  { key: "fleet", label: "Fleet", href: "/fleet", iconKey: "truck-field" },
  { key: "messages", label: "Messages", href: "/messages", iconKey: "comments" },
  { key: "maintenance", label: "Maintenance", href: "/maintenance", iconKey: "toolbox" },
  { key: "inventory", label: "Inventory", href: "/inventory", iconKey: "warehouse" },
  { key: "safety", label: "Safety", href: "/safety", iconKey: "shield-heart" },
  { key: "reports", label: "Reports", href: "/reports", iconKey: "chart-line" },
  { key: "bids", label: "Bids", href: "/bids", iconKey: "file-contract" },
  { key: "vendors", label: "Vendors", href: "/vendors", iconKey: "handshake" },
  { key: "documents", label: "Documents", href: "/documents", iconKey: "folder-open" },
  { key: "training", label: "Training", href: "/training", iconKey: "chalkboard-user" },
  { key: "finance", label: "Finance", href: "/finance", iconKey: "landmark" },
  { key: "subscribe", label: "Subscribe", href: "/subscribe", iconKey: "credit-card" },
];

export const ROLE_NAV_KEYS: Record<AppRole, string[]> = {
  admin: [
    "dashboard",
    "jobs",
    "bids",
    "vendors",
    "inventory",
    "fleet",
    "maintenance",
    "safety",
    "messages",
    "finance",
    "reports",
    "subscribe",
    "documents",
    "team",
    "training",
    "schedule",
  ],
  pm: [
    "dashboard",
    "jobs",
    "bids",
    "vendors",
    "inventory",
    "fleet",
    "safety",
    "messages",
    "reports",
    "finance",
    "documents",
    "team",
    "training",
    "schedule",
  ],
  foreman: [
    "dashboard",
    "messages",
    "schedule",
    "jobs",
    "reports",
    "safety",
  ],
  mechanic: [
    "dashboard",
    "messages",
    "fleet",
    "maintenance",
    "inventory",
    "safety",
  ],
  operator: ["dashboard", "messages", "schedule", "safety", "documents"],
};

export const ROUTE_GUARDS: Record<string, AppRole[]> = {
  "/messages": ["admin", "pm", "foreman", "mechanic", "operator"],
  "/schedule": ["admin", "pm", "foreman", "mechanic", "operator"],
  "/jobs": ["admin", "pm", "foreman"],
  "/fleet": ["admin", "pm", "foreman", "mechanic"],
  "/team": ["admin", "pm"],
  "/maintenance": ["admin", "pm", "mechanic"],
  "/training": ["admin", "pm", "foreman", "mechanic"],
  "/safety": ["admin", "pm", "foreman", "mechanic", "operator"],
  "/bids": ["admin", "pm"],
  "/vendors": ["admin", "pm"],
  "/reports": ["admin", "pm", "foreman"],
  "/inventory": ["admin", "pm", "mechanic"],
  "/finance": ["admin", "pm"],
  "/documents": ["admin", "pm", "foreman", "mechanic", "operator"],
  "/settings": ["admin", "pm"],
  "/subscribe": ["admin"],
};

export function toNavItems(role: AppRole): NavItem[] {
  const allowed = new Set(ROLE_NAV_KEYS[role]);
  return NAV_ITEMS.filter((item) => allowed.has(item.key));
}

export function normalizeAppRole(rawRole: unknown): AppRole | null {
  const normalized = String(rawRole ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z]/g, "");

  if (!normalized) return null;
  if (normalized.includes("admin") || normalized.includes("executive") || normalized.includes("ceo")) return "admin";
  if (normalized === "pm" || normalized.includes("operations") || normalized.includes("projectmanager")) return "pm";
  if (normalized.includes("foreman")) return "foreman";
  if (normalized.includes("mechanic")) return "mechanic";
  if (normalized.includes("operator") || normalized.includes("field")) return "operator";
  return null;
}
