"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function WebAccessRestrictedPage() {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/logout", { method: "POST" }).catch(() => null);
      await supabaseBrowser().auth.signOut().catch(() => null);
    } finally {
      window.location.replace("/login");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <i className="fa-solid fa-mobile-screen-button text-2xl" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Use the Groundwork Pro mobile app</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Your employee account is set up for the Groundwork Pro mobile app. The web dashboard is available only to company owners and co-owners.
        </p>
        <p className="mt-3 text-sm text-gray-500">
          Open the mobile app and sign in with this same account.
        </p>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="mt-6 w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </main>
  );
}
