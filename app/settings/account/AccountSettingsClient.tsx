"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { normalizeTimezoneOption, PROFILE_TIMEZONE_OPTIONS } from "@/lib/user/profileFields";
import {
  normalizeAppearancePreference,
  setAppearancePreference,
} from "@/lib/theme/appearance";

type AccountSettingsItem = {
  email: string;
  full_name: string;
  display_name: string;
  timezone: string;
  appearance: "system" | "light" | "dark";
  notification_preferences: {
    email_notifications: boolean;
    push_notifications: boolean;
    message_notifications: boolean;
    calendar_notifications: boolean;
  };
};

const defaultSettings: AccountSettingsItem = {
  email: "",
  full_name: "",
  display_name: "",
  timezone: "",
  appearance: "system",
  notification_preferences: {
    email_notifications: true,
    push_notifications: true,
    message_notifications: true,
    calendar_notifications: true,
  },
};

export function AccountSettingsClient() {
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get("onboarding") === "1";
  const backHref = isOnboarding ? "/setup" : "/";
  const [settings, setSettings] = useState<AccountSettingsItem>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/account-settings", { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.item) {
          throw new Error(payload?.error || "Failed to load account settings");
        }
        if (cancelled) return;
        setSettings({
          ...defaultSettings,
          ...payload.item,
          timezone: normalizeTimezoneOption(payload.item.timezone),
          appearance: normalizeAppearancePreference(payload.item.appearance),
          notification_preferences: {
            ...defaultSettings.notification_preferences,
            ...(payload.item.notification_preferences || {}),
          },
        });
        setAppearancePreference(normalizeAppearancePreference(payload.item.appearance));
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load account settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus("");
    setError("");
    setFieldErrors({});
    try {
      const response = await fetch("/api/account-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: normalizeTimezoneOption(settings.timezone),
          appearance: settings.appearance,
          notification_preferences: settings.notification_preferences,
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
        throw new Error(payload?.error || "Failed to save account settings");
      }
      setSettings((prev) => ({
        ...prev,
        ...payload.item,
        timezone: normalizeTimezoneOption(payload.item.timezone ?? prev.timezone),
        appearance: normalizeAppearancePreference(payload.item.appearance ?? prev.appearance),
        notification_preferences: {
          ...defaultSettings.notification_preferences,
          ...(payload.item.notification_preferences || {}),
        },
      }));
      setAppearancePreference(normalizeAppearancePreference(payload.item.appearance ?? settings.appearance));
      setStatus("Account settings saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save account settings");
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    setStatus("");
    setError("");
    if (!settings.email) {
      setError("No email found for this account.");
      return;
    }
    const { error: resetError } = await supabaseBrowser().auth.resetPasswordForEmail(settings.email, {
      redirectTo: `${window.location.origin}/login`,
    });
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setStatus("Password reset email sent.");
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-2xl rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-600">Loading account settings...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-900">Account Settings</h1>
          <p className="mt-2 text-sm text-gray-600">Manage your personal preferences and security entry points.</p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block font-medium text-gray-700">Account Email</span>
              <input className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2" value={settings.email} disabled />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Timezone</span>
              <select
                className={`w-full rounded-lg px-3 py-2 ${fieldErrors.timezone ? "border border-red-400 bg-red-50" : "border border-gray-300"}`}
                value={normalizeTimezoneOption(settings.timezone)}
                onChange={(event) => setSettings((prev) => ({ ...prev, timezone: normalizeTimezoneOption(event.target.value) }))}
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
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Appearance</span>
              <select
                className={`w-full rounded-lg px-3 py-2 ${fieldErrors.appearance ? "border border-red-400 bg-red-50" : "border border-gray-300"}`}
                value={settings.appearance}
                onChange={(event) =>
                  {
                    const nextAppearance = normalizeAppearancePreference(event.target.value);
                    setSettings((prev) => ({
                      ...prev,
                      appearance: nextAppearance,
                    }));
                    setAppearancePreference(nextAppearance);
                  }
                }
                aria-invalid={fieldErrors.appearance ? "true" : "false"}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
              {fieldErrors.appearance ? <span className="mt-1 block text-xs text-red-600">{fieldErrors.appearance}</span> : null}
            </label>
          </div>

          <div className="mt-6 rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900">Notification Preferences</h2>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ["email_notifications", "Email notifications"],
                ["push_notifications", "Push notifications"],
                ["message_notifications", "Message alerts"],
                ["calendar_notifications", "Calendar reminders"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.notification_preferences[key as keyof AccountSettingsItem["notification_preferences"]])}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        notification_preferences: {
                          ...prev.notification_preferences,
                          [key]: event.target.checked,
                        },
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900">Security</h2>
            <p className="mt-1 text-sm text-gray-600">Use Supabase password reset for credential updates.</p>
            <button
              type="button"
              onClick={handlePasswordReset}
              className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Send Password Reset Email
            </button>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {!error && status && <p className="mt-4 text-sm text-green-700">{status}</p>}

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Account Settings"}
            </button>
            {isOnboarding ? (
              <Link
                href="/"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Skip for now
              </Link>
            ) : null}
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
