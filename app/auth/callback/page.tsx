'use client';

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import ExcavatorLoader from "@/components/loading/ExcavatorLoader";

function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const ranRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    async function run() {
      const supabase = supabaseBrowser();
      try {
        const providerError = params.get("error_description") || params.get("error");
        if (providerError) {
          throw new Error("We couldn't complete sign-in. Please try again.");
        }
        // Exchange the OAuth/PKCE code in the URL for a session. The browser
        // client persists it (cookies + localStorage).
        const code = params.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw new Error("We couldn't complete sign-in. Please try again.");
          }
        }

        let { data } = await supabase.auth.getSession();
        if (!data.session) {
          const refreshed = await supabase.auth.refreshSession();
          data = refreshed.data as typeof data;
        }
        if (!data.session) {
          setError("We couldn't complete sign-in. Please try again.");
          setTimeout(() => router.replace("/login"), 1500);
          return;
        }

        // Preserve invite context if the user started from an invite link.
        const invite = params.get("invite") === "1";
        const token = params.get("token") || undefined;
        if (invite && token) {
          const accept = await fetch("/api/invite/accept", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          if (!accept.ok) {
            const payload = await accept.json().catch(() => ({}));
            throw new Error(payload?.error || "Unable to accept the workspace invite.");
          }
        }

        // Hand off to the app. Root/App then enforces the existing routing:
        // workspace check, native Continue-on-Web, and setup-wizard gating.
        router.replace("/");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Sign-in failed.");
        setTimeout(() => router.replace("/login"), 1500);
      }
    }

    run();
  }, [params, router]);

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-gray-700">{error}</p>
        </div>
      </main>
    );
  }

  return <ExcavatorLoader />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<ExcavatorLoader />}>
      <CallbackInner />
    </Suspense>
  );
}
