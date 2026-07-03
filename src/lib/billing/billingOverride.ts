// Pure domain logic for company billing overrides. Kept side-effect free so it
// can be reused by the access check, the billing status route, and the admin UI.

export const BILLING_OVERRIDE_TYPES = [
  "none",
  "free_lifetime",
  "free_until",
  "percent_discount",
  "fixed_discount",
] as const;
export type BillingOverrideType = (typeof BILLING_OVERRIDE_TYPES)[number];

export type BillingOverrideRow = {
  billing_override_type?: string | null;
  billing_override_value?: number | string | null;
  billing_override_until?: string | null;
  billing_override_reason?: string | null;
  billing_override_created_by?: string | null;
  billing_override_created_at?: string | null;
  billing_override_updated_at?: string | null;
};

export type BillingOverrideEvaluation = {
  type: BillingOverrideType;
  // A complimentary override that grants access WITHOUT a Stripe subscription.
  grantsFreeAccess: boolean;
  // True when the override is a discount (metadata only; still needs Stripe).
  isDiscount: boolean;
  // True when an until-bounded override has passed its expiration.
  isExpired: boolean;
  until: string | null;
  discountPercent: number | null;
  discountAmountCents: number | null;
  reason: string | null;
};

function normalizeType(value: unknown): BillingOverrideType {
  const raw = String(value ?? "none").trim().toLowerCase();
  return (BILLING_OVERRIDE_TYPES as readonly string[]).includes(raw)
    ? (raw as BillingOverrideType)
    : "none";
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Evaluate an override at a point in time. Only free_lifetime and an UNEXPIRED
// free_until grant access on their own; discounts never do; an expired
// free_until grants nothing (company falls back to Stripe status).
export function evaluateBillingOverride(
  row: BillingOverrideRow | null | undefined,
  now: Date = new Date()
): BillingOverrideEvaluation {
  const type = normalizeType(row?.billing_override_type);
  const value = toNumber(row?.billing_override_value);
  const until = row?.billing_override_until ?? null;
  const reason = row?.billing_override_reason ?? null;

  const untilMs = until ? Date.parse(until) : NaN;
  const hasUntil = Number.isFinite(untilMs);
  const isExpired = (type === "free_until") && hasUntil ? untilMs <= now.getTime() : false;

  let grantsFreeAccess = false;
  if (type === "free_lifetime") grantsFreeAccess = true;
  else if (type === "free_until") grantsFreeAccess = hasUntil && untilMs > now.getTime();

  const isDiscount = type === "percent_discount" || type === "fixed_discount";

  return {
    type,
    grantsFreeAccess,
    isDiscount,
    isExpired,
    until,
    discountPercent: type === "percent_discount" ? value : null,
    discountAmountCents: type === "fixed_discount" ? value : null,
    reason,
  };
}

// Human-readable status shown in the company Billing UI. Complimentary states
// win over the raw Stripe status; discounts annotate an otherwise-normal status.
// NOTE: never include the internal reason/notes here — this is employee-facing.
export function readableBillingStatus(params: {
  subscriptionStatus: string;
  override: BillingOverrideEvaluation;
  untilLabel?: (iso: string) => string;
}): string {
  const { subscriptionStatus, override } = params;
  const fmt = params.untilLabel ?? ((iso: string) => iso);

  if (override.type === "free_lifetime") return "Complimentary";
  if (override.type === "free_until" && override.grantsFreeAccess) {
    return override.until ? `Complimentary until ${fmt(override.until)}` : "Complimentary";
  }

  const base =
    {
      trialing: "Trialing",
      active: "Active",
      past_due: "Past due",
      canceled: "Canceled",
      unpaid: "Unpaid",
      incomplete: "Incomplete",
      inactive: "Inactive",
    }[String(subscriptionStatus).toLowerCase()] ?? subscriptionStatus;

  if (override.type === "percent_discount" && override.discountPercent != null) {
    return `${base} · Discounted ${override.discountPercent}%`;
  }
  if (override.type === "fixed_discount" && override.discountAmountCents != null) {
    return `${base} · Discounted $${(override.discountAmountCents / 100).toFixed(2)}`;
  }
  return base;
}

export const BILLING_OVERRIDE_SELECT_COLUMNS =
  "billing_override_type, billing_override_value, billing_override_until, billing_override_reason, billing_override_created_by, billing_override_created_at, billing_override_updated_at";
