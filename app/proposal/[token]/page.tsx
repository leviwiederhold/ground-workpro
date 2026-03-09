'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type ProposalResponse = {
  item: {
    proposal: {
      bid_id: string;
      status: string;
      sent_at: string | null;
      accepted_at: string | null;
      project_name: string;
      client_name: string | null;
    };
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      quantity: number;
      unit: string | null;
      unit_price: number;
      total: number;
    }>;
    summary: {
      subtotal: number;
      total: number;
    };
    company: {
      name: string;
    };
  };
};

type ApiErrorResponse = {
  error?: string;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export default function ProposalPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ProposalResponse["item"] | null>(null);

  const loadProposal = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/proposals/${token}`, { cache: "no-store" });
      const raw = await response.text();
      let parsed: ProposalResponse | ApiErrorResponse | null = null;
      try {
        parsed = raw ? (JSON.parse(raw) as ProposalResponse | ApiErrorResponse) : null;
      } catch {
        parsed = null;
      }
      if (!response.ok || !parsed || !("item" in parsed)) {
        setError((parsed && "error" in parsed && parsed.error) || "Proposal not found");
        setPayload(null);
        return;
      }
      setPayload(parsed.item);
    } catch {
      setError("Failed to load proposal");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadProposal();
  }, [loadProposal]);

  const status = useMemo(() => String(payload?.proposal.status ?? "").toLowerCase(), [payload?.proposal.status]);
  const canApprove = status === "sent";

  const handleApprove = async () => {
    if (!token || !canApprove) return;
    setApproving(true);
    setError(null);
    try {
      const response = await fetch(`/api/proposals/${token}/approve`, { method: "POST" });
      const raw = await response.text();
      let parsed: ProposalResponse | ApiErrorResponse | null = null;
      try {
        parsed = raw ? (JSON.parse(raw) as ProposalResponse | ApiErrorResponse) : null;
      } catch {
        parsed = null;
      }

      if (!response.ok || !parsed || !("item" in parsed)) {
        setError((parsed && "error" in parsed && parsed.error) || "Failed to approve proposal");
        return;
      }
      setPayload((current) => ({
        ...(current ?? parsed.item),
        ...parsed.item,
        proposal: {
          ...(current?.proposal ?? parsed.item.proposal),
          ...parsed.item.proposal,
          status: "accepted",
          accepted_at: parsed.item.proposal.accepted_at ?? new Date().toISOString(),
        },
      }));
      void loadProposal();
    } catch {
      setError("Failed to approve proposal");
    } finally {
      setApproving(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        {loading && (
          <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500" data-testid="proposal-loading">
            Loading proposal...
          </div>
        )}

        {!loading && error && (
          <div className="bg-white border border-red-200 rounded-lg p-6 text-sm text-red-600" data-testid="proposal-error">
            {error}
          </div>
        )}

        {!loading && payload && (
          <>
            <section className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-gray-500 mb-1" data-testid="proposal-company">{payload.company.name}</p>
                  <h1 className="text-2xl font-semibold text-gray-900" data-testid="proposal-project">{payload.proposal.project_name}</h1>
                  {payload.proposal.client_name && (
                    <p className="text-sm text-gray-600 mt-1">Client: {payload.proposal.client_name}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 mb-1">Status</p>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                      status === "accepted" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
                    }`}
                    data-testid="proposal-status"
                  >
                    {payload.proposal.status}
                  </span>
                  {status === "accepted" && (
                    <p className="text-xs text-green-700 mt-2" data-testid="proposal-approved-badge">Approved</p>
                  )}
                </div>
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-sm font-semibold text-gray-900">Line Items</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {payload.items.map((item) => (
                  <div key={item.id} className="px-6 py-4 grid grid-cols-1 sm:grid-cols-4 gap-3" data-testid={`proposal-item-${item.id}`}>
                    <div className="sm:col-span-2">
                      <p className="text-sm font-medium text-gray-900">{item.name}</p>
                      {item.description && <p className="text-sm text-gray-500">{item.description}</p>}
                    </div>
                    <div className="text-sm text-gray-600">
                      {item.quantity} {item.unit || ""}
                    </div>
                    <div className="text-sm font-medium text-gray-900 sm:text-right">
                      {currency.format(Number(item.total || 0))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium text-gray-900">{currency.format(Number(payload.summary.subtotal || 0))}</span>
                </div>
                <div className="flex items-center justify-between text-base mt-1">
                  <span className="font-semibold text-gray-900">Total</span>
                  <span className="font-semibold text-gray-900" data-testid="proposal-total">
                    {currency.format(Number(payload.summary.total || 0))}
                  </span>
                </div>
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-lg p-6">
              {canApprove ? (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={approving}
                  className="inline-flex items-center justify-center rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  data-testid="proposal-approve-button"
                >
                  {approving ? "Approving..." : "Approve Proposal"}
                </button>
              ) : (
                <p className="text-sm text-gray-600">
                  {status === "accepted" ? "This proposal has been approved." : "This proposal cannot be approved in its current state."}
                </p>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
