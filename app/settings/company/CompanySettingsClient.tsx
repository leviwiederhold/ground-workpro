"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type CompanySettings = {
  company_name: string;
  timezone: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  industry: string;
  employee_count: number | null;
  default_work_hours: string;
  currency: string;
  date_format: string;
  company_logo: string;
};

const EMPTY_SETTINGS: CompanySettings = {
  company_name: "",
  timezone: "",
  phone: "",
  email: "",
  address: "",
  website: "",
  industry: "",
  employee_count: null,
  default_work_hours: "",
  currency: "USD",
  date_format: "MM/DD/YYYY",
  company_logo: "",
};

const TIMEZONE_OPTIONS = [
  { label: "Eastern Time (ET)", value: "America/New_York" },
  { label: "Central Time (CT)", value: "America/Chicago" },
  { label: "Mountain Time (MT)", value: "America/Denver" },
  { label: "Pacific Time (PT)", value: "America/Los_Angeles" },
] as const;

const initialsFromName = (name: string) => {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "CO";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");
};

export function CompanySettingsClient() {
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get("onboarding") === "1";
  const backHref = isOnboarding ? "/setup" : "/";
  const [settings, setSettings] = useState<CompanySettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const getFieldClassName = (field: keyof CompanySettings) =>
    `w-full rounded-lg px-3 py-2 ${fieldErrors[field] ? "border border-red-400 bg-red-50" : "border border-gray-300"}`;

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/company/settings", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(payload?.error || "Failed to load company settings."));
        return;
      }
      const item = payload?.item ?? {};
      setSettings({
        company_name: String(item.company_name ?? ""),
        timezone: String(item.timezone ?? ""),
        phone: String(item.phone ?? ""),
        email: String(item.email ?? ""),
        address: String(item.address ?? ""),
        website: String(item.website ?? ""),
        industry: String(item.industry ?? ""),
        employee_count:
          item.employee_count === null || item.employee_count === undefined || item.employee_count === ""
            ? null
            : Number(item.employee_count),
        default_work_hours: String(item.default_work_hours ?? ""),
        currency: String(item.currency ?? "USD") || "USD",
        date_format: String(item.date_format ?? "MM/DD/YYYY") || "MM/DD/YYYY",
        company_logo: String(item.company_logo ?? ""),
      });
    } catch {
      setError("Failed to load company settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const logoInitials = useMemo(() => initialsFromName(settings.company_name), [settings.company_name]);

  const onSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    setFieldErrors({});
    try {
      const nextFieldErrors: Record<string, string> = {};
      if (!settings.company_name.trim()) nextFieldErrors.company_name = "Company name is required.";
      if (isOnboarding && !settings.timezone.trim()) nextFieldErrors.timezone = "Please select a timezone.";
      if (Object.keys(nextFieldErrors).length > 0) {
        setFieldErrors(nextFieldErrors);
        setError("Please fix the highlighted fields.");
        return;
      }
      const response = await fetch("/api/company/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = Array.isArray(payload?.details) ? payload.details : [];
        if (details.length > 0) {
          const nextFieldErrors: Record<string, string> = {};
          for (const detail of details) {
            const key = String(detail?.path ?? "").trim();
            if (!key || nextFieldErrors[key]) continue;
            nextFieldErrors[key] = String(detail?.message ?? "Invalid value");
          }
          setFieldErrors(nextFieldErrors);
          setError("Please fix the highlighted fields.");
          return;
        }
        setError(String(payload?.error || "Failed to save settings."));
        return;
      }
      const item = payload?.item ?? settings;
      setSettings((prev) => ({
        ...prev,
        ...item,
        employee_count:
          item.employee_count === null || item.employee_count === undefined || item.employee_count === ""
            ? null
            : Number(item.employee_count),
      }));
      setSuccess("Company settings saved.");
    } catch {
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const onLogoSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setUploadingLogo(true);
    setError("");
    setSuccess("");
    try {
      const formData = new FormData();
      formData.set("logo", file);
      const response = await fetch("/api/company/settings/logo", { method: "POST", body: formData });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(String(payload?.error || "Failed to upload logo."));
        return;
      }
      const companyLogo = String(payload?.item?.company_logo ?? "").trim();
      setSettings((prev) => ({ ...prev, company_logo: companyLogo }));
      setSuccess("Company logo uploaded.");
    } catch {
      setError("Failed to upload logo.");
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <Link href={backHref} className="inline-flex items-center text-sm font-medium text-brand-600 hover:text-brand-700">
          {backHref === "/setup" ? "← Back to Setup" : "← Back to Dashboard"}
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900">Company Settings</h1>
        <p className="mt-2 text-sm text-gray-600">
          Configure company profile defaults, branding, and formatting preferences.
        </p>
      </div>

      <form onSubmit={onSave} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-gray-500">Loading company settings...</p>
        ) : (
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="h-16 w-16 overflow-hidden rounded-full border border-gray-200 bg-gray-100">
                {settings.company_logo ? (
                  <Image
                    src={settings.company_logo}
                    alt="Company logo"
                    className="h-full w-full object-cover"
                    width={64}
                    height={64}
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-gray-700">
                    {logoInitials}
                  </div>
                )}
              </div>
              <div>
                <label className="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                  {uploadingLogo ? "Uploading..." : "Upload Company Logo"}
                  <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml" className="hidden" onChange={onLogoSelect} />
                </label>
                <p className="mt-2 text-xs text-gray-500">PNG, JPG, WEBP, or SVG up to 2MB.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Company Name <span className="text-red-500">*</span></span>
                <input
                  className={getFieldClassName("company_name")}
                  value={settings.company_name}
                  onChange={(event) => setSettings((prev) => ({ ...prev, company_name: event.target.value }))}
                  required
                  aria-invalid={fieldErrors.company_name ? "true" : "false"}
                />
                {fieldErrors.company_name ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.company_name}</span> : null}
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Timezone {isOnboarding ? <span className="text-red-500">*</span> : <span className="text-gray-400">(optional)</span>}</span>
                <select
                  className={getFieldClassName("timezone")}
                  value={settings.timezone}
                  onChange={(event) => setSettings((prev) => ({ ...prev, timezone: event.target.value }))}
                  aria-invalid={fieldErrors.timezone ? "true" : "false"}
                >
                  <option value="">Select timezone</option>
                  {TIMEZONE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {fieldErrors.timezone ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.timezone}</span> : null}
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Phone (optional)</span>
                <input
                  className={getFieldClassName("phone")}
                  value={settings.phone}
                  onChange={(event) => setSettings((prev) => ({ ...prev, phone: event.target.value }))}
                  aria-invalid={fieldErrors.phone ? "true" : "false"}
                />
                {fieldErrors.phone ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.phone}</span> : null}
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Email (optional)</span>
                <input
                  type="email"
                  className={getFieldClassName("email")}
                  value={settings.email}
                  onChange={(event) => setSettings((prev) => ({ ...prev, email: event.target.value }))}
                  aria-invalid={fieldErrors.email ? "true" : "false"}
                />
                {fieldErrors.email ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.email}</span> : null}
              </label>

              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block text-gray-600">Address (optional)</span>
                <input
                  className={getFieldClassName("address")}
                  value={settings.address}
                  onChange={(event) => setSettings((prev) => ({ ...prev, address: event.target.value }))}
                  aria-invalid={fieldErrors.address ? "true" : "false"}
                />
                {fieldErrors.address ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.address}</span> : null}
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Website (optional)</span>
                <input
                  className={getFieldClassName("website")}
                  value={settings.website}
                  onChange={(event) => setSettings((prev) => ({ ...prev, website: event.target.value }))}
                  placeholder="https://example.com"
                  aria-invalid={fieldErrors.website ? "true" : "false"}
                />
                {fieldErrors.website ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.website}</span> : null}
              </label>

              {!isOnboarding ? (
                <label className="text-sm">
                  <span className="mb-1 block text-gray-600">Industry / Trade</span>
                  <input
                    className={getFieldClassName("industry")}
                    value={settings.industry}
                    onChange={(event) => setSettings((prev) => ({ ...prev, industry: event.target.value }))}
                    aria-invalid={fieldErrors.industry ? "true" : "false"}
                  />
                  {fieldErrors.industry ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.industry}</span> : null}
                </label>
              ) : null}

              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Employee Count (optional)</span>
                <input
                  type="number"
                  min={0}
                  className={getFieldClassName("employee_count")}
                  value={settings.employee_count ?? ""}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      employee_count: event.target.value === "" ? null : Number(event.target.value),
                    }))
                  }
                  aria-invalid={fieldErrors.employee_count ? "true" : "false"}
                />
                {fieldErrors.employee_count ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.employee_count}</span> : null}
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Default Work Hours (optional)</span>
                <input
                  className={getFieldClassName("default_work_hours")}
                  value={settings.default_work_hours}
                  onChange={(event) => setSettings((prev) => ({ ...prev, default_work_hours: event.target.value }))}
                  placeholder="7:00 AM - 3:30 PM"
                  aria-invalid={fieldErrors.default_work_hours ? "true" : "false"}
                />
                {fieldErrors.default_work_hours ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.default_work_hours}</span> : null}
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Currency (optional)</span>
                <input
                  className={getFieldClassName("currency")}
                  value={settings.currency}
                  onChange={(event) => setSettings((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))}
                  placeholder="USD"
                  aria-invalid={fieldErrors.currency ? "true" : "false"}
                />
                {fieldErrors.currency ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.currency}</span> : null}
              </label>

              <label className="text-sm">
                <span className="mb-1 block text-gray-600">Date Format (optional)</span>
                <input
                  className={getFieldClassName("date_format")}
                  value={settings.date_format}
                  onChange={(event) => setSettings((prev) => ({ ...prev, date_format: event.target.value }))}
                  placeholder="MM/DD/YYYY"
                  aria-invalid={fieldErrors.date_format ? "true" : "false"}
                />
                {fieldErrors.date_format ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.date_format}</span> : null}
              </label>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && <p className="text-sm text-emerald-600">{success}</p>}

            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={saving || loading}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {saving ? "Saving..." : "Save Company Settings"}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
