"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  extractUsPhoneDigits,
  formatUsPhoneInput,
  normalizeTimezoneOption,
  PROFILE_TIMEZONE_OPTIONS,
  sanitizeProfileFullName,
} from "@/lib/user/profileFields";

type CurrentUserIdentityLite = {
  fullName: string;
  displayName: string;
  email: string;
  phone: string;
  jobTitle: string;
  timezone: string;
  avatarUrl: string;
};

const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"]);

type ProfileForm = {
  full_name: string;
  email: string;
  phone: string;
  job_title: string;
  timezone: string;
  avatar_url: string;
};

async function toDataUrl(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function firstInvalidFieldKey(fieldErrors: Record<string, string>) {
  const orderedFields: Array<keyof ProfileForm> = ["avatar_url", "full_name", "phone", "job_title", "timezone"];
  return orderedFields.find((field) => fieldErrors[field]) ?? null;
}

export function ProfileClient({ identity }: { identity: CurrentUserIdentityLite }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get("onboarding") === "1";
  const backHref = isOnboarding ? "/setup" : "/";
  const [form, setForm] = useState<ProfileForm>({
    full_name: sanitizeProfileFullName(identity.fullName, identity.email),
    email: identity.email || "",
    phone: formatUsPhoneInput(identity.phone || ""),
    job_title: identity.jobTitle || "",
    timezone: normalizeTimezoneOption(identity.timezone || ""),
    avatar_url: identity.avatarUrl || "",
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const getFieldClassName = (field: keyof ProfileForm) =>
    `w-full rounded-lg px-3 py-2 ${fieldErrors[field] ? "border border-red-500 bg-red-50 ring-1 ring-red-200" : "border border-gray-300"}`;

  const resolvedName = useMemo(
    () => {
      const fullName = String(form.full_name ?? "").trim();
      if (fullName) return fullName;
      const email = String(form.email ?? "").trim();
      if (email) return email;
      return "Team Member";
    },
    [form.email, form.full_name]
  );

  const handleAvatarUpload = async (file: File | null) => {
    if (!file) return;
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next.avatar_url;
      return next;
    });
    if (!ALLOWED_AVATAR_TYPES.has(String(file.type).toLowerCase())) {
      setFieldErrors((prev) => ({ ...prev, avatar_url: "Only PNG, JPEG, WEBP, or SVG avatars are supported." }));
      setError("Please fix the highlighted fields.");
      return;
    }
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      setFieldErrors((prev) => ({ ...prev, avatar_url: "Avatar file must be 2MB or smaller." }));
      setError("Please fix the highlighted fields.");
      return;
    }
    const dataUrl = await toDataUrl(file);
    setForm((prev) => ({ ...prev, avatar_url: dataUrl }));
    setError("");
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus("");
    setError("");
    setFieldErrors({});
    try {
      if (!form.full_name.trim()) {
        setFieldErrors({ full_name: "Full name is required." });
        setError("Please fix the highlighted fields.");
        return;
      }
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          phone: extractUsPhoneDigits(form.phone),
          job_title: form.job_title.trim(),
          timezone: normalizeTimezoneOption(form.timezone),
          avatar_url: form.avatar_url.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.item) {
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
        throw new Error(payload?.error || "Failed to save profile");
      }
      const item = payload.item as ProfileForm;
      setForm((prev) => ({
        ...prev,
        full_name: Object.prototype.hasOwnProperty.call(item, "full_name")
          ? sanitizeProfileFullName(item.full_name, item.email ?? prev.email)
          : prev.full_name,
        email: Object.prototype.hasOwnProperty.call(item, "email")
          ? String(item.email ?? prev.email ?? "").trim()
          : prev.email,
        phone: Object.prototype.hasOwnProperty.call(item, "phone")
          ? formatUsPhoneInput(item.phone)
          : prev.phone,
        job_title: Object.prototype.hasOwnProperty.call(item, "job_title")
          ? String(item.job_title ?? "").trim()
          : prev.job_title,
        timezone: Object.prototype.hasOwnProperty.call(item, "timezone")
          ? normalizeTimezoneOption(item.timezone)
          : prev.timezone,
        avatar_url: Object.prototype.hasOwnProperty.call(item, "avatar_url")
          ? String(item.avatar_url ?? "").trim()
          : prev.avatar_url,
      }));
      if (isOnboarding) {
        router.push("/setup");
        router.refresh();
        return;
      }
      setStatus("Profile saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const initials = resolvedName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const inlineErrorSummary = useMemo(() => {
    const key = firstInvalidFieldKey(fieldErrors);
    if (!key) return "";
    return fieldErrors[key] ?? "";
  }, [fieldErrors]);

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">My Profile</h1>
          <p className="mt-2 text-sm text-gray-600">
            Update your identity details used across Team, Messages, and meeting pickers.
          </p>

          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="h-20 w-20 overflow-hidden rounded-full border border-gray-200 bg-gray-100">
              {form.avatar_url ? (
                <img src={form.avatar_url} alt={resolvedName} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-gray-600">
                  {initials || "TM"}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Upload profile photo
                <input
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/svg+xml"
                  onChange={(event) => {
                    void handleAvatarUpload(event.target.files?.[0] ?? null);
                  }}
                />
              </label>
              {fieldErrors.avatar_url ? <p className="text-xs text-red-600">{fieldErrors.avatar_url}</p> : null}
              {form.avatar_url && (
                <button
                  type="button"
                  className="block text-sm font-medium text-red-600 hover:text-red-700"
                  onClick={() => setForm((prev) => ({ ...prev, avatar_url: "" }))}
                >
                  Remove photo
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Full Name <span className="text-red-500">*</span></span>
              <input
                className={getFieldClassName("full_name")}
                value={form.full_name}
                onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
                aria-invalid={fieldErrors.full_name ? "true" : "false"}
              />
              {fieldErrors.full_name ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.full_name}</span> : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Email</span>
              <input className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2" value={form.email} disabled />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Phone</span>
              <input
                className={getFieldClassName("phone")}
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: formatUsPhoneInput(event.target.value) }))}
                inputMode="tel"
                maxLength={14}
                placeholder="(555) 123-4567"
                aria-invalid={fieldErrors.phone ? "true" : "false"}
              />
              {fieldErrors.phone ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.phone}</span> : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Job Title (optional)</span>
              <input
                className={getFieldClassName("job_title")}
                value={form.job_title}
                onChange={(event) => setForm((prev) => ({ ...prev, job_title: event.target.value }))}
                aria-invalid={fieldErrors.job_title ? "true" : "false"}
              />
              {fieldErrors.job_title ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.job_title}</span> : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Timezone (optional)</span>
              <select
                className={getFieldClassName("timezone")}
                value={form.timezone}
                onChange={(event) => setForm((prev) => ({ ...prev, timezone: normalizeTimezoneOption(event.target.value) }))}
                aria-invalid={fieldErrors.timezone ? "true" : "false"}
              >
                <option value="">Select timezone</option>
                {PROFILE_TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {fieldErrors.timezone ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.timezone}</span> : null}
            </label>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{inlineErrorSummary || error}</p>}
          {!error && status && <p className="mt-4 text-sm text-green-700">{status}</p>}

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Profile"}
            </button>
            {isOnboarding ? (
              <Link
                href="/setup"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Skip for now
              </Link>
            ) : null}
            <p className="text-xs text-gray-500">Display fallback: full name, display name, email, Team Member.</p>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <Link href={backHref} className="text-sm font-medium text-brand-600 hover:text-brand-700">
            {backHref === "/setup" ? "Back to Setup" : "Back to Dashboard"}
          </Link>
        </div>
      </div>
    </main>
  );
}
