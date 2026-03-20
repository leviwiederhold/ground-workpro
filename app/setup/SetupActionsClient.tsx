"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SetupActionsClient({
  canSkipOptionalSteps,
  canCreateWorkspace,
}: {
  canSkipOptionalSteps: boolean;
  canCreateWorkspace: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleCreateWorkspace = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/bootstrap", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(payload?.error || "Failed to create your company workspace."));
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to create your company workspace.");
    } finally {
      setLoading(false);
    }
  };

  const handleSkipOptional = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding/setup-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "skip_optional_steps" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(payload?.error || "Failed to skip remaining setup steps."));
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Failed to skip remaining setup steps.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      {canCreateWorkspace ? (
        <button
          type="button"
          onClick={handleCreateWorkspace}
          disabled={loading}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Creating Workspace..." : "Create Workspace"}
        </button>
      ) : null}
      {canSkipOptionalSteps ? (
        <button
          type="button"
          onClick={handleSkipOptional}
          disabled={loading}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Skipping..." : "Skip Remaining Optional Steps"}
        </button>
      ) : null}
      {!canCreateWorkspace ? (
        <>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Refresh Status
          </button>
          <span className="text-xs text-gray-500">
            Skipped items stay visible later in your checklist and reminders.
          </span>
        </>
      ) : null}
      {error ? <p className="w-full text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
