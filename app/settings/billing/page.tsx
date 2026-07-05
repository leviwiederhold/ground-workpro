"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isIosNativeAppRuntime } from "@/lib/runtime/isNativeApp";

type BillingStatus = {
  plan_type: string;
  subscription_status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  is_active: boolean;
  // Override-aware fields (employee-safe; no internal reason/notes).
  display_status?: string;
  effective_display_status?: string;
  override_display_status?: string | null;
  is_complimentary?: boolean;
  override_type?: string;
  override_until?: string | null;
  discount_percent?: number | null;
  discount_amount_cents?: number | null;
};


const PRICE_PER_SEAT = 49.99;

function fmt(dateStr: string | null | undefined): string {
  if (!dateStr) return "Not available";
  try {
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "Not available";
  }
}

function StatusBadge({ billing }: { billing: BillingStatus | null }) {
  const status = billing?.subscription_status ?? "inactive";
  const map: Record<string, { label: string; cls: string }> = {
    trialing: { label: "Trialing", cls: "bg-blue-100 text-blue-800" },
    active: { label: "Active", cls: "bg-green-100 text-green-800" },
    past_due: { label: "Past Due", cls: "bg-red-100 text-red-800" },
    canceled: { label: "Canceled", cls: "bg-gray-100 text-gray-700" },
    unpaid: { label: "Unpaid", cls: "bg-red-100 text-red-800" },
    incomplete: { label: "Incomplete", cls: "bg-amber-100 text-amber-800" },
    inactive: { label: "Inactive", cls: "bg-gray-100 text-gray-700" },
  };
  // Complimentary access (free_lifetime / free_until) takes visual priority; the
  // server-provided display_status already renders the human-readable label,
  // including any "· Discounted x%" annotation.
  if (billing?.is_complimentary) {
    return (
      <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-800">
        {billing.display_status || "Complimentary"}
      </span>
    );
  }
  const fallback = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-700" };
  const label = billing?.effective_display_status || billing?.override_display_status || billing?.display_status || fallback.label;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${fallback.cls}`}>
      {label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

export default function BillingSettingsPage() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState("");
  const [error, setError] = useState("");
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(isIosNativeAppRuntime());
  }, []);

  useEffect(() => {
    if (isNative) return;
    async function load() {
      try {
        // The authoritative billable seat count comes from /api/billing/sync-seats
        // (getActiveBillableSeatCount = active employees ∪ owners, distinct). This
        // is the SAME source as the Stripe quantity, so the displayed number and
        // Stripe stay in agreement. We do NOT count company-members membership
        // rows here — lingering memberships from deleted employees would inflate it.
        const [syncRes, statusRes] = await Promise.all([
          fetch("/api/billing/sync-seats", { method: "POST" }),
          fetch("/api/billing/status", { cache: "no-store" }),
        ]);

        if (statusRes.ok) {
          const payload = await statusRes.json();
          setBilling(payload?.item ?? null);
        } else {
          setError("Failed to load billing status.");
        }

        if (syncRes.ok) {
          const payload = await syncRes.json();
          const seatCount = Number(payload?.seatCount);
          if (Number.isFinite(seatCount) && seatCount > 0) {
            console.log(`[billing/page] activeSeats source=sync-seats count=${seatCount}`);
            setMemberCount(seatCount);
          }
        }
      } catch {
        setError("Failed to load billing information.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isNative]);

  async function handleManageBilling() {
    setPortalLoading(true);
    setPortalError("");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPortalError(payload?.error || "Failed to open billing portal.");
        return;
      }
      if (payload?.url) {
        window.location.href = payload.url;
      } else {
        setPortalError("No portal URL returned.");
      }
    } catch {
      setPortalError("Failed to open billing portal.");
    } finally {
      setPortalLoading(false);
    }
  }

  // Native iOS app must not expose billing/payment UI per App Store guidelines.
  if (isNative) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">Company Administration</h1>
          <p className="mt-2 text-sm text-gray-600">
            Company administration is managed on the web dashboard.
          </p>
          <Link href="/" className="mt-5 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            Return to Dashboard
          </Link>
        </div>
      </main>
    );
  }

  const seats = memberCount ?? 0;
  const estimatedMonthly = seats * PRICE_PER_SEAT;

  const statusLower = billing?.subscription_status ?? "inactive";
  const isTrialing = statusLower === "trialing";
  const isCanceled = statusLower === "canceled" || statusLower === "inactive";

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            <i className="fa-solid fa-arrow-left text-xs" />
            Back to Dashboard
          </Link>
          <h1 className="mt-3 text-2xl font-semibold text-gray-900">Billing</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your Groundwork Pro subscription and billing details.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Subscription card */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Subscription</h2>
            {!loading && billing && <StatusBadge billing={billing} />}
          </div>

          {loading ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
              Loading billing details…
            </div>
          ) : (
            <div className="px-6 py-2">
              <Row label="Plan" value="Groundwork Pro" />
              <Row label="Status" value={<StatusBadge billing={billing} />} />
              <Row label="Price" value="$49.99 / active member / month" />
              {isTrialing && (
                <Row
                  label="Trial ends"
                  value={fmt(billing?.trial_ends_at)}
                />
              )}
              {!isCanceled && !isTrialing && (
                <Row
                  label="Next renewal"
                  value={fmt(billing?.current_period_end)}
                />
              )}
            </div>
          )}
        </div>

        {/* Seat usage card */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Seat Usage</h2>
          </div>
          <div className="px-6 py-2">
            <Row
              label="Active billable members"
              value={loading ? "—" : memberCount !== null ? memberCount.toString() : "Not available"}
            />
            <Row
              label="Price per member"
              value={`$${PRICE_PER_SEAT.toFixed(2)} / month`}
            />
            <Row
              label="Estimated monthly total"
              value={
                loading || memberCount === null
                  ? "—"
                  : `$${estimatedMonthly.toFixed(2)} / month`
              }
            />
          </div>
          {!loading && memberCount !== null && (
            <div className="mx-6 mb-3 rounded-lg bg-gray-50 px-4 py-3 text-center text-sm font-medium text-gray-700">
              {memberCount} active {memberCount === 1 ? "seat" : "seats"} × ${PRICE_PER_SEAT.toFixed(2)} ={" "}
              <span className="text-gray-900">${estimatedMonthly.toFixed(2)}</span>/month
            </div>
          )}
          <p className="px-6 pb-4 text-xs text-gray-400">
            One company subscription, billed once based on active members at the
            end of each billing period.
          </p>
        </div>

        {/* Manage billing */}
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="text-base font-semibold text-gray-900">Manage Billing</h2>
          </div>
          <div className="px-6 py-5 space-y-3">
            <p className="text-sm text-gray-600">
              Update your payment method, download invoices, or cancel your subscription
              through the Stripe customer portal.
            </p>
            {portalError && (
              <p className="text-sm text-red-600">{portalError}</p>
            )}
            <button
              onClick={handleManageBilling}
              disabled={portalLoading || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {portalLoading ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Opening portal…
                </>
              ) : (
                <>
                  <i className="fa-solid fa-arrow-up-right-from-square text-xs" />
                  Manage Billing
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
