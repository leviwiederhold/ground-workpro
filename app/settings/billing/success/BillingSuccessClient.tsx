'use client';

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import Link from "next/link";

function LoadingSpinner() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600 text-sm font-medium">Setting up your workspace…</p>
      </div>
    </main>
  );
}

function RecoveryScreen({ sessionId }: { sessionId?: string }) {
  const continueUrl = `/login?checkout=success${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ""}`;
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <i className="fa-solid fa-check text-green-600 text-xl" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Payment Successful!</h1>
        <p className="text-sm text-gray-600 mb-6">
          Your Groundwork Pro workspace is ready. Sign in to continue.
        </p>
        <Link
          href={continueUrl}
          className="inline-flex w-full items-center justify-center rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Continue to Dashboard
        </Link>
      </div>
    </main>
  );
}

interface Props {
  sessionId?: string;
}

export default function BillingSuccessClient({ sessionId }: Props) {
  const router = useRouter();
  const ranRef = useRef(false);
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    async function finish() {
      const supabase = supabaseBrowser();

      // 1. Try existing browser session (localStorage / cookies).
      let { data } = await supabase.auth.getSession();

      // 2. Attempt a session refresh — may succeed if server cookies were set.
      if (!data.session) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        data = refreshed as typeof data;
      }

      // 3. Still no session — show recovery screen with "Continue to Dashboard" link
      //    that goes to /login?checkout=success (pre-filled success state).
      if (!data.session) {
        setShowRecovery(true);
        return;
      }

      // 4. Sync the Stripe session → company billing record.
      if (sessionId) {
        try {
          const res = await fetch("/api/billing/sync-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!payload?.synced) {
            console.warn("[billing/success] sync-session did not sync:", payload?.reason);
          }
        } catch (err) {
          console.warn("[billing/success] sync-session fetch failed:", err);
        }
      }

      router.replace("/?trial=started");
    }

    finish();
  }, [router, sessionId]);

  if (showRecovery) {
    return <RecoveryScreen sessionId={sessionId} />;
  }

  return <LoadingSpinner />;
}
