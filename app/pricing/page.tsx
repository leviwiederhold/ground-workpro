"use client";

import { MarketingChrome } from "@/app/components/marketing/MarketingChrome";
import { isIosNativeAppRuntime } from "@/lib/runtime/isNativeApp";
import Link from "next/link";
import { useEffect, useState } from "react";

const plans = [
  {
    name: "Starter",
    price: "$49",
    period: "/user/mo",
    bullets: ["Core modules", "Basic scheduling", "Fleet tracking", "Mobile access"],
  },
  {
    name: "Professional",
    price: "$79",
    period: "/user/mo",
    bullets: ["Everything in Starter", "Advanced scheduling", "Job costing", "Priority support"],
    popular: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    bullets: ["Dedicated success", "Custom integrations", "SLA support", "API workflows"],
  },
];

export default function PricingPage() {
  const [mounted, setMounted] = useState(false);
  const [iosAppRuntime, setIosAppRuntime] = useState(false);

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
      subtitle="Transparent plans that scale from small crews to multi-division operations."
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={`rounded-xl border p-6 ${plan.popular ? "bg-dark-900 border-dark-900 text-white" : "bg-white border-gray-200"}`}
          >
            {plan.popular && (
              <span className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-brand-500 text-white mb-3">
                Most Popular
              </span>
            )}
            <h2 className={`text-2xl font-bold ${plan.popular ? "text-white" : "text-gray-900"}`}>{plan.name}</h2>
            <p className={`mt-2 ${plan.popular ? "text-gray-300" : "text-gray-600"}`}>
              <span className="text-3xl font-bold">{plan.price}</span> {plan.period}
            </p>
            <ul className="mt-5 space-y-2">
              {plan.bullets.map((bullet) => (
                <li key={bullet} className={`text-sm flex items-center gap-2 ${plan.popular ? "text-gray-200" : "text-gray-700"}`}>
                  <i className="fa-solid fa-check text-brand-500"></i>
                  {bullet}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className={`mt-6 inline-flex w-full items-center justify-center rounded-lg py-2.5 text-sm font-semibold ${
                plan.popular ? "bg-brand-500 text-white hover:bg-brand-600" : "bg-gray-100 text-gray-900 hover:bg-gray-200"
              }`}
            >
              Start Free Trial
            </Link>
          </div>
        ))}
      </div>
    </MarketingChrome>
  );
}
