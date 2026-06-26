"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function SessionRecoveryScreen({ nextPath = "/" }: { nextPath?: string }) {
  const [message, setMessage] = useState("Restoring your session...");

  useEffect(() => {
    let active = true;
    const recover = async () => {
      const first = await supabaseBrowser().auth.getSession().catch(() => null);
      if (first?.data?.session) {
        window.location.replace(nextPath);
        return;
      }
      const refreshed = await supabaseBrowser().auth.refreshSession().catch(() => null);
      if (refreshed?.data?.session) {
        window.location.replace(nextPath);
        return;
      }
      if (!active) return;
      setMessage("Session expired. Redirecting to sign in...");
      window.setTimeout(() => window.location.replace("/login"), 600);
    };
    void recover();
    return () => {
      active = false;
    };
  }, [nextPath]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm">
        <div className="text-sm font-medium text-gray-700">{message}</div>
      </div>
    </main>
  );
}
