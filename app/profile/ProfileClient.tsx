"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

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
  display_name: string;
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

export function ProfileClient({ identity }: { identity: CurrentUserIdentityLite }) {
  const searchParams = useSearchParams();
  const backHref = searchParams.get("onboarding") === "1" ? "/setup" : "/";
  const [form, setForm] = useState<ProfileForm>({
    full_name: identity.fullName || "",
    display_name: identity.displayName || "",
    email: identity.email || "",
    phone: identity.phone || "",
    job_title: identity.jobTitle || "",
    timezone: identity.timezone || "",
    avatar_url: identity.avatarUrl || "",
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const resolvedName = useMemo(
    () => {
      const fullName = String(form.full_name ?? "").trim();
      if (fullName) return fullName;
      const displayName = String(form.display_name ?? "").trim();
      if (displayName) return displayName;
      const email = String(form.email ?? "").trim();
      if (email) return email;
      return "Team Member";
    },
    [form.display_name, form.email, form.full_name]
  );

  const handleAvatarUpload = async (file: File | null) => {
    if (!file) return;
    if (!ALLOWED_AVATAR_TYPES.has(String(file.type).toLowerCase())) {
      setError("Only PNG, JPEG, WEBP, or SVG avatars are supported.");
      return;
    }
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      setError("Avatar file must be 2MB or smaller.");
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
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          display_name: form.display_name.trim(),
          phone: form.phone.trim(),
          job_title: form.job_title.trim(),
          timezone: form.timezone.trim(),
          avatar_url: form.avatar_url.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.item) {
        throw new Error(payload?.error || "Failed to save profile");
      }
      const item = payload.item as ProfileForm;
      setForm((prev) => ({
        ...prev,
        full_name: String(item.full_name ?? "").trim(),
        display_name: String(item.display_name ?? "").trim(),
        email: String(item.email ?? prev.email ?? "").trim(),
        phone: String(item.phone ?? "").trim(),
        job_title: String(item.job_title ?? "").trim(),
        timezone: String(item.timezone ?? "").trim(),
        avatar_url: String(item.avatar_url ?? "").trim(),
      }));
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
              <span className="mb-1 block font-medium text-gray-700">Full Name</span>
              <input
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                value={form.full_name}
                onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Display Name (optional)</span>
              <input
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                value={form.display_name}
                onChange={(event) => setForm((prev) => ({ ...prev, display_name: event.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Email</span>
              <input className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2" value={form.email} disabled />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Phone</span>
              <input
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Job Title (optional)</span>
              <input
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                value={form.job_title}
                onChange={(event) => setForm((prev) => ({ ...prev, job_title: event.target.value }))}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Timezone</span>
              <input
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                value={form.timezone}
                onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
                placeholder="America/New_York"
              />
            </label>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {!error && status && <p className="mt-4 text-sm text-green-700">{status}</p>}

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !form.full_name.trim()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Profile"}
            </button>
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
