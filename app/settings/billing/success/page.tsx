'use server';

import { redirect } from "next/navigation";
import { Suspense } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import BillingSuccessClient from "./BillingSuccessClient";

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

interface PageProps {
  searchParams: Promise<{ session_id?: string }>;
}

export default async function BillingSuccessPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const sessionId = params.session_id;

  // The server receives HTTP cookies from Stripe's GET redirect — these survive
  // cross-site redirects perfectly. If the user has a valid session here, we can
  // sync and redirect without any client-side auth dance.
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (user && sessionId) {
    // Sync the Stripe session server-side before redirecting.
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
      await fetch(`${baseUrl}/api/billing/sync-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
    } catch (err) {
      // Non-fatal: webhook handles eventual consistency.
      console.warn("[billing/success] server-side sync-session failed:", err);
    }
    redirect("/?trial=started");
  }

  if (user) {
    // No session_id but valid user — just go to dashboard.
    redirect("/?trial=started");
  }

  // No server-side session found — fall back to client component which will
  // attempt refreshSession() and show recovery UI if needed.
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <BillingSuccessClient sessionId={sessionId} />
    </Suspense>
  );
}
