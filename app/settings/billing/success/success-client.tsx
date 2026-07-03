"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

type Status = "processing" | "retrying" | "error";

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

async function fetchJson(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export default function BillingSuccessClient({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<Status>("processing");
  const [message, setMessage] = useState("Processing your trial...");
  const [attempt, setAttempt] = useState(0);

  const processCheckout = useCallback(async () => {
    setStatus("processing");
    setMessage("Processing your trial...");

    const sessionResult = await supabaseBrowser().auth.getSession();
    if (!sessionResult.data.session) {
      const refreshed = await supabaseBrowser().auth.refreshSession().catch(() => null);
      if (!refreshed?.data?.session) {
        window.location.replace(`/login${sessionId ? `?checkout=success&session_id=${encodeURIComponent(sessionId)}` : ""}`);
        return;
      }
    }

    const startedAt = Date.now();
    const timeoutMs = 25_000;
    let lastReason = "";

    while (Date.now() - startedAt < timeoutMs) {
      setAttempt((value) => value + 1);

      if (sessionId) {
        const sync = await fetchJson("/api/billing/sync-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        lastReason = String(sync.payload?.reason || sync.payload?.status || "");
        if (
          sync.response.ok &&
          sync.payload?.synced === true &&
          (sync.payload?.active === true || sync.payload?.status === "trialing" || sync.payload?.status === "active")
        ) {
          window.location.replace("/setup?trial=started");
          return;
        }
      }

      const billing = await fetchJson("/api/billing/status");
      if (billing.response.status === 401) {
        const refreshed = await supabaseBrowser().auth.refreshSession().catch(() => null);
        if (!refreshed?.data?.session) {
          window.location.replace(`/login${sessionId ? `?checkout=success&session_id=${encodeURIComponent(sessionId)}` : ""}`);
          return;
        }
      } else if (billing.response.ok && Boolean(billing.payload?.item?.is_active)) {
        const setup = await fetchJson("/api/onboarding/setup-status");
        if (setup.response.status === 401) {
          await supabaseBrowser().auth.refreshSession().catch(() => null);
        } else if (setup.response.ok) {
          const complete = Boolean(
            setup.payload?.item?.required_complete === undefined
              ? setup.payload?.item?.is_complete
              : setup.payload?.item?.required_complete
          );
          window.location.replace(complete ? "/" : "/setup?trial=started");
          return;
        }
      }

      setStatus("retrying");
      setMessage("Processing your trial. This can take a few seconds...");
      await sleep(1500);
    }

    setStatus("error");
    setMessage(
      lastReason
        ? `Stripe confirmed checkout, but billing is still syncing (${lastReason}). Please retry.`
        : "Stripe checkout is still syncing. Please retry."
    );
  }, [sessionId]);

  useEffect(() => {
    void processCheckout();
  }, [processCheckout]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <i className={`fa-solid ${status === "error" ? "fa-triangle-exclamation" : "fa-spinner fa-spin"} text-xl`} />
        </div>
        <h1 className="text-xl font-semibold text-gray-900">
          {status === "error" ? "Trial Still Processing" : "Processing your trial..."}
        </h1>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        {status !== "error" ? <p className="mt-3 text-xs text-gray-400">Attempt {Math.max(attempt, 1)}</p> : null}
        {status === "error" ? (
          <button
            type="button"
            onClick={() => void processCheckout()}
            className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Retry
          </button>
        ) : null}
      </div>
    </main>
  );
}
