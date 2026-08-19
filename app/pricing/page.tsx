"use client";

import { MarketingChrome } from "@/app/components/marketing/MarketingChrome";
import { StartTrialButton } from "@/app/components/marketing/StartTrialButton";
import { isIosNativeAppRuntime } from "@/lib/runtime/isNativeApp";
import Link from "next/link";
import { useEffect, useState } from "react";

const plan = {
  name: "Groundwork Pro",
  price: "$49.99",
  period: "/month per active member",
  bullets: [
    "All core modules included",
    "Jobs, Equipment, Scheduling, Safety, Finance",
    "Team messaging & daily reports",
    "Mobile app access",
    "7-Day free trial — card required",
  ],
};

export default function PricingPage() {
  const [mounted, setMounted] = useState(false);
  const [iosAppRuntime, setIosAppRuntime] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");

  useEffect(() => {
    setMounted(true);
    setIosAppRuntime(isIosNativeAppRuntime());
  }, []);

  if (!mounted) return null;

  if (iosAppRuntime) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">Company Workspace</h1>
          <p className="mt-2 text-sm text-gray-600">Advanced company administration is available on the web portal.</p>
          <Link href="/" className="mt-5 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
            Return to Groundwork Pro
          </Link>
        </div>
      </main>
    );
  }

  return (
    <MarketingChrome
      title="Pricing"
      subtitle="Start Groundwork Pro with one simple subscription for your crew."
    >
      <div className="mx-auto max-w-md">
        <div className="rounded-xl border border-gray-200 bg-white p-7 shadow-sm">
          <h2 className="text-2xl font-bold text-gray-900">{plan.name}</h2>
          <p className="mt-2 text-gray-600">
            <span className="text-4xl font-bold text-gray-900">{plan.price}</span> {plan.period}
          </p>
          <ul className="mt-6 space-y-3">
            {plan.bullets.map((bullet) => (
              <li key={bullet} className="flex items-center gap-2 text-sm text-gray-700">
                <i className="fa-solid fa-check text-brand-500"></i>
                {bullet}
              </li>
            ))}
          </ul>
          <StartTrialButton
            onError={setCheckoutError}
            className="mt-7 inline-flex w-full items-center justify-center rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-70"
          />
        </div>
      </div>
      {checkoutError && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {checkoutError}
        </p>
      )}
    </MarketingChrome>
  );
}
