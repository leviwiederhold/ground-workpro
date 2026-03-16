import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAppRole, type AppRole } from "@/lib/nav/config";
import { upsertFallbackChecklistRow } from "@/lib/onboarding/fallbackStore";

export type SetupStepKey = "finish_profile" | "complete_account_settings" | "complete_company_settings";
export type SetupStepScope = "user" | "company";

export type SetupStep = {
  key: SetupStepKey;
  label: string;
  description: string;
  href: string;
  scope: SetupStepScope;
  required: boolean;
  completed: boolean;
};

type SetupStepDef = Omit<SetupStep, "completed">;

type SetupRole = AppRole;

type SetupStatus = {
  role: SetupRole;
  required_steps: SetupStep[];
  optional_steps: SetupStep[];
  is_complete: boolean;
  next_step_href: string | null;
};

const PROFILE_STEP: SetupStepDef = {
  key: "finish_profile",
  label: "Complete My Profile",
  description: "Add your personal identity details used throughout the app.",
  href: "/profile?onboarding=1",
  scope: "user",
  required: false,
};

const ACCOUNT_STEP: SetupStepDef = {
  key: "complete_account_settings",
  label: "Complete Account Settings",
  description: "Set your user-level preferences such as notifications and timezone.",
  href: "/settings/account?onboarding=1",
  scope: "user",
  required: false,
};

const COMPANY_STEP: SetupStepDef = {
  key: "complete_company_settings",
  label: "Complete Company Settings",
  description: "Configure your company profile defaults and required business details.",
  href: "/settings/company?onboarding=1",
  scope: "company",
  required: true,
};

const isMissingOnboardingTable = (message: string | undefined) =>
  /onboarding_checklist/i.test(String(message || "")) && /does not exist|not find/i.test(String(message || ""));

const isMissingColumnError = (message: string | undefined) =>
  /column|Could not find the/i.test(String(message || "")) && /does not exist|not find/i.test(String(message || ""));

function getRequiredSetupStepDefs(role: SetupRole): SetupStepDef[] {
  if (role === "admin") return [{ ...COMPANY_STEP, required: true }];
  return [{ ...PROFILE_STEP, required: true }];
}

function getOptionalSetupStepDefs(role: SetupRole): SetupStepDef[] {
  if (role === "admin") return [{ ...PROFILE_STEP, required: false }, { ...ACCOUNT_STEP, required: false }];
  return [
    { ...ACCOUNT_STEP, required: false },
  ];
}

async function resolveRole(
  supabase: SupabaseClient,
  companyId: string,
  userId: string
): Promise<SetupRole> {
  const membershipResult = await supabase
    .from("memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  const normalized = normalizeAppRole(membershipResult.data?.role);
  return normalized ?? "operator";
}

async function loadProfileForSetup(supabase: SupabaseClient, userId: string) {
  let profile = await supabase
    .from("profiles")
    .select("full_name,display_name,phone,job_title,timezone,avatar_url,appearance_preference,notification_preferences")
    .eq("id", userId)
    .maybeSingle();
  if (profile.error && isMissingColumnError(profile.error.message)) {
    profile = await supabase
      .from("profiles")
      .select("full_name,display_name,phone,job_title,timezone,avatar_url")
      .eq("id", userId)
      .maybeSingle();
  }
  if (profile.error && /display_name|Could not find the 'display_name' column/i.test(profile.error.message || "")) {
    profile = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  }
  return profile.data ?? null;
}

async function loadCompanyForSetup(supabase: SupabaseClient, companyId: string) {
  let company = await supabase
    .from("companies")
    .select("name,timezone,phone,email,address,industry,currency,date_format")
    .eq("id", companyId)
    .maybeSingle();
  if (company.error && isMissingColumnError(company.error.message)) {
    company = await supabase.from("companies").select("name").eq("id", companyId).maybeSingle();
  }
  return company.data ?? null;
}

function hasTruthy(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function isProfileDerivedComplete(profile: Record<string, unknown> | null, fallbackEmail: string) {
  const email = String(fallbackEmail || "").trim().toLowerCase();
  const fullName = String(profile?.full_name ?? "").trim();
  const displayName = String(profile?.display_name ?? "").trim();
  const phone = String(profile?.phone ?? "").trim();
  const jobTitle = String(profile?.job_title ?? "").trim();
  const avatar = String(profile?.avatar_url ?? "").trim();
  const timezone = String(profile?.timezone ?? "").trim();

  if (displayName) return true;
  if (phone || jobTitle || avatar || timezone) return true;
  if (!fullName) return false;
  return fullName.toLowerCase() !== email;
}

function isAccountDerivedComplete(profile: Record<string, unknown> | null) {
  const timezone = String(profile?.timezone ?? "").trim();
  const appearance = String(profile?.appearance_preference ?? "").trim();
  const notificationPrefs =
    profile?.notification_preferences && typeof profile.notification_preferences === "object"
      ? profile.notification_preferences
      : null;
  return Boolean(timezone || appearance || (notificationPrefs && Object.keys(notificationPrefs).length > 0));
}

function isCompanyDerivedComplete(company: Record<string, unknown> | null) {
  if (!company) return false;
  return hasTruthy(company.name) && hasTruthy(company.timezone);
}

function isStepCompletedByRecord(
  checklistRows: Array<{ key: string | null; user_id: string | null; completed_at: string | null }>,
  key: SetupStepKey,
  scope: SetupStepScope,
  userId: string
) {
  const row = checklistRows.find((entry) => {
    if (String(entry.key ?? "") !== key) return false;
    if (scope === "company") return !entry.user_id;
    return String(entry.user_id ?? "") === userId;
  });
  return Boolean(row?.completed_at);
}

export async function getSetupStatusForUser(input: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  userEmail: string;
}): Promise<SetupStatus> {
  const { supabase, companyId, userId, userEmail } = input;
  const role = await resolveRole(supabase, companyId, userId);
  const requiredDefs = getRequiredSetupStepDefs(role);
  const optionalDefs = getOptionalSetupStepDefs(role);
  const requiredKeys = [...new Set([...requiredDefs, ...optionalDefs].map((step) => step.key))];

  const checklistResult = await supabase
    .from("onboarding_checklist")
    .select("key,user_id,completed_at")
    .eq("company_id", companyId)
    .in("key", requiredKeys as string[]);

  const checklistRows = checklistResult.error
    ? isMissingOnboardingTable(checklistResult.error.message)
      ? []
      : []
    : checklistResult.data ?? [];

  const [profile, company] = await Promise.all([
    loadProfileForSetup(supabase, userId),
    role === "admin" ? loadCompanyForSetup(supabase, companyId) : Promise.resolve(null),
  ]);

  const mapStep = (def: SetupStepDef) => {
    const byRecord = isStepCompletedByRecord(
      checklistRows as Array<{ key: string | null; user_id: string | null; completed_at: string | null }>,
      def.key,
      def.scope,
      userId
    );
    const byDerived =
      def.key === "finish_profile"
        ? isProfileDerivedComplete(profile as Record<string, unknown> | null, userEmail)
        : def.key === "complete_account_settings"
          ? isAccountDerivedComplete(profile as Record<string, unknown> | null)
          : isCompanyDerivedComplete(company as Record<string, unknown> | null);
    return {
      ...def,
      completed: byRecord || byDerived,
    };
  };

  const required_steps = requiredDefs.map(mapStep);
  const optional_steps = optionalDefs.map(mapStep);

  const firstIncomplete = required_steps.find((step) => !step.completed) ?? null;
  return {
    role,
    required_steps,
    optional_steps,
    is_complete: !firstIncomplete,
    next_step_href: firstIncomplete?.href ?? null,
  };
}

export async function markSetupStepCompleted(input: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  key: SetupStepKey;
  scope: SetupStepScope;
}) {
  const rowUserId = input.scope === "company" ? null : input.userId;
  const nowIso = new Date().toISOString();

  const existingQuery = input.supabase
    .from("onboarding_checklist")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("key", input.key)
    .limit(1);

  const existingResult = rowUserId
    ? await existingQuery.eq("user_id", rowUserId).maybeSingle()
    : await existingQuery.is("user_id", null).maybeSingle();

  if (existingResult.error && isMissingOnboardingTable(existingResult.error.message)) {
    upsertFallbackChecklistRow({
      companyId: input.companyId,
      userId: rowUserId,
      key: input.key,
      completedAt: nowIso,
      completedBy: input.userId,
    });
    return;
  }

  if (existingResult.error) return;

  const payload = {
    company_id: input.companyId,
    user_id: rowUserId,
    key: input.key,
    completed_at: nowIso,
    completed_by: input.userId,
    updated_at: nowIso,
  };

  if (existingResult.data?.id) {
    await input.supabase.from("onboarding_checklist").update(payload).eq("id", existingResult.data.id);
    return;
  }
  await input.supabase.from("onboarding_checklist").insert(payload);
}
