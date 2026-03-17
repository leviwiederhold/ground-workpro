const SPA_VIEW_BY_PREFIX: Array<{ prefix: string; view: string }> = [
  { prefix: "/jobs", view: "jobs" },
  { prefix: "/maintenance", view: "maintenance" },
  { prefix: "/safety", view: "safety" },
  { prefix: "/messages", view: "messages" },
  { prefix: "/inventory", view: "inventory" },
  { prefix: "/schedule", view: "schedule" },
  { prefix: "/fleet", view: "fleet" },
  { prefix: "/team", view: "team" },
  { prefix: "/reports", view: "reports" },
  { prefix: "/vendors", view: "vendors" },
  { prefix: "/bids", view: "bids" },
  { prefix: "/documents", view: "documents" },
  { prefix: "/finance", view: "finance" },
  { prefix: "/integrations", view: "integrations" },
];

function normalizeHref(rawHref: unknown) {
  return String(rawHref ?? "").trim();
}

export function getNotificationSpaView(href: unknown) {
  const normalized = normalizeHref(href);
  if (!normalized.startsWith("/")) return null;
  const [path] = normalized.split("?");
  const match = SPA_VIEW_BY_PREFIX.find((entry) => path === entry.prefix || path.startsWith(`${entry.prefix}/`));
  return match?.view ?? null;
}

export function isNotificationExternalHref(href: unknown) {
  return /^https?:\/\//i.test(normalizeHref(href));
}

export function navigateNotificationHref(params: {
  href: unknown;
  setCurrentView?: (view: string) => void;
  closeOverlay?: () => void;
}) {
  const href = normalizeHref(params.href);
  if (!href) return false;

  const spaView = getNotificationSpaView(href);
  if (spaView && params.setCurrentView) {
    window.localStorage.setItem("app.currentView", spaView);
    params.setCurrentView(spaView);
    params.closeOverlay?.();
    return true;
  }

  if (spaView) {
    window.localStorage.setItem("app.currentView", spaView);
    window.location.assign("/");
    return true;
  }

  params.closeOverlay?.();
  window.location.assign(href);
  return true;
}
