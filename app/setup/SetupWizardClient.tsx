'use client';

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Prefill = {
  role: "owner" | "employee";
  hasCompany: boolean;
  firstName: string;
  lastName: string;
  phone: string;
  jobTitle: string;
  timezone: string;
  emergencyContact: string;
  company: { name: string; phone: string; address: string; timezone: string } | null;
};

const FIELD =
  "w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm shadow-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand-500";
const LABEL = "mb-1.5 block text-sm font-medium text-gray-700";
const REQ = <span className="text-red-500"> *</span>;

function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export default function SetupWizardClient({ prefill }: { prefill: Prefill }) {
  const router = useRouter();
  const isOwner = prefill.role === "owner";

  // Step labels per role.
  const steps = useMemo(
    () =>
      isOwner
        ? ["Your Profile", "Company", "Preferences"]
        : ["Your Profile", "Work Profile"],
    [isOwner]
  );

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Personal
  const [firstName, setFirstName] = useState(prefill.firstName);
  const [lastName, setLastName] = useState(prefill.lastName);
  const [phone, setPhone] = useState(prefill.phone);
  const [jobTitle, setJobTitle] = useState(prefill.jobTitle);
  const [timezone, setTimezone] = useState(prefill.timezone || guessTimezone());

  // Employee work profile
  const [emergencyContact, setEmergencyContact] = useState(prefill.emergencyContact);

  // Account preferences (owner)
  const [landingPage, setLandingPage] = useState("dashboard");
  const [emailNotif, setEmailNotif] = useState(true);
  const [pushNotif, setPushNotif] = useState(true);

  // Company (owner)
  const [companyName, setCompanyName] = useState(prefill.company?.name ?? "");
  const [companyPhone, setCompanyPhone] = useState(prefill.company?.phone ?? "");
  const [companyAddress, setCompanyAddress] = useState(prefill.company?.address ?? "");
  const [companyTimezone, setCompanyTimezone] = useState(
    prefill.company?.timezone || guessTimezone()
  );

  const isLast = step === steps.length - 1;

  function validateStep(): string {
    if (step === 0) {
      if (!firstName.trim() || !lastName.trim()) return "First and last name are required.";
    }
    if (isOwner && step === 1) {
      if (!companyName.trim()) return "Company name is required.";
      if (!companyTimezone.trim()) return "Company timezone is required.";
    }
    return "";
  }

  async function finish() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim() || undefined,
          job_title: jobTitle.trim() || undefined,
          timezone: timezone.trim() || undefined,
          emergency_contact: emergencyContact.trim() || undefined,
          ...(isOwner
            ? {
                landing_page: landingPage,
                notification_preferences: {
                  email_notifications: emailNotif,
                  push_notifications: pushNotif,
                },
                company_name: companyName.trim() || undefined,
                company_phone: companyPhone.trim() || undefined,
                company_address: companyAddress.trim() || undefined,
                company_timezone: companyTimezone.trim() || undefined,
              }
            : {}),
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload?.error || "Failed to save setup");
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save setup");
      setSaving(false);
    }
  }

  function next() {
    const v = validateStep();
    if (v) {
      setError(v);
      return;
    }
    setError("");
    if (isLast) {
      void finish();
    } else {
      setStep((s) => s + 1);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold text-gray-900">Finish setting up your account</h1>
          <p className="mt-1 text-sm text-gray-500">
            A couple of quick details before you get started.
          </p>
        </div>

        {/* Progress indicator */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {steps.map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  i < step
                    ? "bg-brand-500 text-white"
                    : i === step
                      ? "bg-brand-500 text-white ring-4 ring-brand-100"
                      : "bg-gray-200 text-gray-500"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </div>
              {i < steps.length - 1 && (
                <div className={`h-0.5 w-8 sm:w-12 ${i < step ? "bg-brand-500" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
            Step {step + 1} of {steps.length} · {steps[step]}
          </p>

          {/* STEP 0 — Personal profile (both roles) */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL}>First name{REQ}</label>
                  <input className={FIELD} value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" />
                </div>
                <div>
                  <label className={LABEL}>Last name{REQ}</label>
                  <input className={FIELD} value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" />
                </div>
              </div>
              <div>
                <label className={LABEL}>Phone <span className="text-gray-400">(optional)</span></label>
                <input className={FIELD} value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" />
              </div>
              {isOwner && (
                <div>
                  <label className={LABEL}>Job title <span className="text-gray-400">(optional)</span></label>
                  <input className={FIELD} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Owner" />
                </div>
              )}
            </div>
          )}

          {/* STEP 1 (owner) — Company */}
          {isOwner && step === 1 && (
            <div className="space-y-4">
              <div>
                <label className={LABEL}>Company name{REQ}</label>
                <input className={FIELD} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div>
                <label className={LABEL}>Timezone{REQ}</label>
                <input className={FIELD} value={companyTimezone} onChange={(e) => setCompanyTimezone(e.target.value)} placeholder="e.g. America/New_York" />
              </div>
              <div>
                <label className={LABEL}>Company phone <span className="text-gray-400">(optional)</span></label>
                <input className={FIELD} value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} inputMode="tel" />
              </div>
              <div>
                <label className={LABEL}>Company address <span className="text-gray-400">(optional)</span></label>
                <textarea className={FIELD} rows={2} value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} />
              </div>
            </div>
          )}

          {/* STEP 2 (owner) — Preferences */}
          {isOwner && step === 2 && (
            <div className="space-y-4">
              <div>
                <label className={LABEL}>Preferred landing page <span className="text-gray-400">(optional)</span></label>
                <select className={FIELD} value={landingPage} onChange={(e) => setLandingPage(e.target.value)}>
                  <option value="dashboard">Dashboard</option>
                  <option value="jobs">Jobs</option>
                  <option value="schedule">Schedule</option>
                  <option value="team">Team</option>
                </select>
              </div>
              <div className="space-y-2">
                <p className={LABEL}>Notifications <span className="text-gray-400">(optional)</span></p>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={emailNotif} onChange={(e) => setEmailNotif(e.target.checked)} />
                  Email notifications
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={pushNotif} onChange={(e) => setPushNotif(e.target.checked)} />
                  Push notifications
                </label>
              </div>
            </div>
          )}

          {/* STEP 1 (employee) — Work profile */}
          {!isOwner && step === 1 && (
            <div className="space-y-4">
              <div>
                <label className={LABEL}>
                  Job title{prefill.jobTitle ? REQ : <span className="text-gray-400"> (optional)</span>}
                </label>
                <input className={FIELD} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Foreman" />
                {prefill.jobTitle ? (
                  <p className="mt-1 text-xs text-gray-500">Confirm the title you were invited as.</p>
                ) : null}
              </div>
              <div>
                <label className={LABEL}>Emergency contact <span className="text-gray-400">(optional)</span></label>
                <input className={FIELD} value={emergencyContact} onChange={(e) => setEmergencyContact(e.target.value)} placeholder="Name and phone" />
              </div>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-red-600" role="alert">{error}</p>}

          <div className="mt-7 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0 || saving}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 disabled:opacity-40"
            >
              Back
            </button>
            <button
              type="button"
              onClick={next}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
            >
              {saving ? "Saving…" : isLast ? "Finish & Enter App" : "Save & Continue"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
