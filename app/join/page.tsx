"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isNativeAppRuntime } from "@/lib/runtime/isNativeApp";

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
}
export default function JoinCompanyPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    setNative(isNativeAppRuntime());
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/join/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.item?.valid) {
        throw new Error(payload?.error || "Unable to validate company code");
      }
      router.push(`/signup?join=1&code=${encodeURIComponent(code)}`);
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Unable to validate company code");
    } finally {
      setLoading(false);
    }
  }

  const loginHref = code.length === 6
    ? `/login?join=1&code=${encodeURIComponent(code)}`
    : "/login";

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-7 shadow-sm">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <i className="fa-solid fa-people-group text-xl" aria-hidden="true" />
        </div>
        <h1 className="text-center text-2xl font-semibold text-gray-900">Join your company</h1>
        <p className="mt-2 text-center text-sm text-gray-600">
          Enter the 6-character employee code from your company owner.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="company-code" className="mb-1.5 block text-sm font-medium text-gray-700">
              Company code
            </label>
            <input
              id="company-code"
              data-testid="employee-join-code-input"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              value={code}
              onChange={(event) => setCode(normalizeCode(event.target.value))}
              placeholder="ABC123"
              maxLength={6}
              required
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-center font-mono text-2xl font-semibold tracking-[0.3em] text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
            />
          </div>
          {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
          <button
            type="submit"
            data-testid="employee-join-code-submit"
            disabled={loading || code.length !== 6}
            className="w-full rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Checking code…" : "Continue"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href={loginHref} className="font-medium text-brand-600 hover:text-brand-700">
            Sign in to join
          </Link>
        </p>
        {!native ? (
          <p className="mt-3 text-center text-xs text-gray-400">
            Employee accounts use the Groundwork Pro mobile app after joining.
          </p>
        ) : null}
      </div>
    </main>
  );
}
