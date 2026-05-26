'use client';

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

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

function BillingSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id") ?? undefined;
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    async function finish() {
      const supabase = supabaseBrowser();
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        const loginUrl = `/login?checkout=success${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : ""}`;
        router.replace(loginUrl);
        return;
      }

      // Sync the Stripe session → company billing record.
      // Uses admin client internally so auth cookies are not required.
      if (sessionId) {
        try {
          const res = await fetch("/api/billing/sync-session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!payload?.synced) {
            // Sync didn't complete — webhook will handle it. Log for debugging.
            console.warn("[billing/success] sync-session did not sync:", payload?.reason);
          }
        } catch (err) {
          // Non-fatal — proceed to dashboard; webhook handles eventual consistency.
          console.warn("[billing/success] sync-session fetch failed:", err);
        }
      }

      // Always redirect to dashboard. If sync failed, the webhook will update the
      // subscription status asynchronously. Pass trial=started so the app knows to
      // re-check billing status on arrival.
      router.replace("/?trial=started");
    }

    finish();
  }, [router, sessionId]);

  return <LoadingSpinner />;
}

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <BillingSuccessInner />
    </Suspense>
  );
}
