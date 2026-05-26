import type { ReactNode } from "react";
import Link from "next/link";
import { StartTrialButton } from "@/app/components/marketing/StartTrialButton";

type MarketingChromeProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function MarketingChrome({ title, subtitle, children }: MarketingChromeProps) {
  return (
    <main className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 min-w-0">
              <div className="w-9 h-9 bg-brand-500 rounded-lg flex items-center justify-center">
                <i className="fa-solid fa-mountain text-white text-sm"></i>
              </div>
              <div className="min-w-0">
                <span className="font-dozer text-xl text-gray-900 tracking-wide">GROUNDWORK</span>
                <span className="text-brand-500 font-dozer text-xl tracking-wide">PRO</span>
              </div>
            </Link>
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-700">
              <Link href="/" className="hover:text-gray-900">Home</Link>
              <Link href="/features" className="hover:text-gray-900">Features</Link>
              <Link href="/pricing" className="hover:text-gray-900">Pricing</Link>
              <Link href="/testimonials" className="hover:text-gray-900">Testimonials</Link>
            </nav>
            <div className="flex items-center gap-2">
              <Link href="/login" className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900">Log In</Link>
              <StartTrialButton
                label="Start Free Trial"
                className="px-4 py-2 text-sm bg-brand-500 text-white rounded-lg hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-70"
              />
            </div>
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-4xl font-bold text-gray-900">{title}</h1>
        <p className="text-lg text-gray-600 mt-2">{subtitle}</p>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        {children}
      </section>
    </main>
  );
}
