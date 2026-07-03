"use client";

import { useCallback, useEffect, useState } from "react";

type OverrideInfo = {
  type: string;
  value: number | null;
  until: string | null;
  is_expired: boolean;
  reason: string | null;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type CompanyRow = {
  company_id: string;
  name: string;
  email: string;
  subscription_status: string;
  plan_type: string;
  stripe_active: boolean;
  grants_free_access: boolean;
  display_status: string;
  override: OverrideInfo;
};

const OVERRIDE_TYPES = [
  { value: "none", label: "None (use Stripe)" },
  { value: "free_lifetime", label: "Free — lifetime" },
  { value: "free_until", label: "Free — until date" },
  { value: "percent_discount", label: "Percent discount (metadata)" },
  { value: "fixed_discount", label: "Fixed discount (metadata)" },
];

export function BillingOverridesClient() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<CompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CompanyRow | null>(null);

  const load = useCallback(async (search: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/billing-overrides?q=${encodeURIComponent(search)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to load companies");
      setRows(json?.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load companies");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  const refreshRow = (updated: CompanyRow) => {
    setRows((prev) => prev.map((r) => (r.company_id === updated.company_id ? updated : r)));
    setSelected((s) => (s && s.company_id === updated.company_id ? updated : s));
  };

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Billing Overrides</h1>
          <p className="mt-1 text-sm text-gray-500">
            Platform-admin only. Grant complimentary or discounted access without changing Stripe. Free overrides bypass
            the paywall; discounts are internal metadata (no Stripe changes) until wired to coupons in a later change.
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            load(q.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search company by name or email"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600">
            Search
          </button>
        </form>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Stripe status</th>
                <th className="px-4 py-3">Effective status</th>
                <th className="px-4 py-3">Override</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500">No companies found.</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.company_id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{row.name || "(unnamed)"}</div>
                      <div className="text-xs text-gray-500">{row.email}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{row.subscription_status}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.grants_free_access ? "bg-purple-100 text-purple-800" : row.stripe_active ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
                        {row.display_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {row.override.type === "none" ? "—" : row.override.type}
                      {row.override.is_expired && <span className="ml-1 text-xs text-red-600">(expired)</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setSelected(row)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                        Manage
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <OverrideDrawer company={selected} onClose={() => setSelected(null)} onSaved={refreshRow} />}
    </main>
  );
}

function OverrideDrawer({
  company,
  onClose,
  onSaved,
}: {
  company: CompanyRow;
  onClose: () => void;
  onSaved: (row: CompanyRow) => void;
}) {
  const [type, setType] = useState(company.override.type || "none");
  const [percent, setPercent] = useState(company.override.type === "percent_discount" ? String(company.override.value ?? "") : "");
  const [amount, setAmount] = useState(company.override.type === "fixed_discount" && company.override.value != null ? String(company.override.value / 100) : "");
  const [until, setUntil] = useState(company.override.until ? company.override.until.slice(0, 10) : "");
  const [reason, setReason] = useState(company.override.reason ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const save = async (removeOverride = false) => {
    setSaving(true);
    setErr("");
    try {
      let res: Response;
      if (removeOverride) {
        res = await fetch(`/api/admin/billing-overrides/${company.company_id}`, { method: "DELETE" });
      } else {
        const payload: Record<string, unknown> = { type, reason: reason.trim() || null };
        if (type === "percent_discount") payload.value = Number(percent);
        if (type === "fixed_discount") payload.value = Math.round(Number(amount) * 100);
        if (type === "free_until") payload.until = until ? new Date(`${until}T23:59:59.000Z`).toISOString() : null;
        res = await fetch(`/api/admin/billing-overrides/${company.company_id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error || "Failed to save override");
      onSaved(json.item);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save override");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{company.name || "(unnamed)"}</h2>
            <p className="text-xs text-gray-500">{company.email}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <dl className="mt-4 space-y-1 rounded-lg bg-gray-50 p-3 text-sm">
          <div className="flex justify-between"><dt className="text-gray-500">Stripe status</dt><dd className="font-medium">{company.subscription_status}</dd></div>
          <div className="flex justify-between"><dt className="text-gray-500">Effective</dt><dd className="font-medium">{company.display_status}</dd></div>
        </dl>

        {err && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">Override type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              {OVERRIDE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          {type === "free_until" && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Free until</span>
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
          )}
          {type === "percent_discount" && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Percent off (1–100)</span>
              <input type="number" min={1} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <span className="mt-1 block text-xs text-gray-500">Metadata only — does not change Stripe or grant access.</span>
            </label>
          )}
          {type === "fixed_discount" && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Amount off (USD)</span>
              <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <span className="mt-1 block text-xs text-gray-500">Stored as cents. Metadata only — does not change Stripe or grant access.</span>
            </label>
          )}

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Reason / note (internal)</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Beta partner through Q3" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <div className="flex gap-2 pt-2">
            <button onClick={() => save(false)} disabled={saving} className="flex-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60">
              {saving ? "Saving…" : "Save override"}
            </button>
            <button onClick={() => save(true)} disabled={saving || company.override.type === "none"} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-40">
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
