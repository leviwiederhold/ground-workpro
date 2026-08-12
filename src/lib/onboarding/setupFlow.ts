import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAppRole, type AppRole } from "@/lib/nav/config";
import { upsertFallbackChecklistRow } from "@/lib/onboarding/fallbackStore";
import { isMissingColumnError, selectProfileColumns } from "@/lib/user/profileRecord";
import { isMissingLegacyPermissionProfileColumn } from "@/lib/auth/teamRoles";

export type SetupStepKey = "finish_profile" | "complete_account_settings" | "complete_company_settings";
export type SetupStepScope = "user" | "company";
export const SETUP_OPTIONAL_STEPS_SKIPPED_KEY = "__setup_optional_steps_skipped__";

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
  company_id: string | null;
  has_company: boolean;
  required_steps: SetupStep[];
  optional_steps: SetupStep[];
  required_complete: boolean;
  optional_complete: boolean;
  optional_steps_skipped: boolean;
  is_complete: boolean;
  next_step_href: string | null;
  next_optional_step_href: string | null;
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

function getRequiredSetupStepDefsForContext(role: SetupRole, hasCompany: boolean): SetupStepDef[] {
  if (!hasCompany) {
    return [
      { ...PROFILE_STEP, required: true },
      {
        ...COMPANY_STEP,
        label: "Create Company Workspace",
        description: "Create your company workspace so your account can finish setup and enter the app.",
        href: "/setup?create-company=1",
        required: true,
      },
    ];
  }
  return getRequiredSetupStepDefs(role);
}

async function resolveRole(
  supabase: SupabaseClient,
  companyId: string | null,
  userId: string
): Promise<SetupRole> {
  if (!companyId) return "admin";
  let membershipResult = await supabase
    .from("memberships")
    .select("role, legacy_permission_profile")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (isMissingLegacyPermissionProfileColumn(membershipResult.error)) {
    const legacyResult = await supabase
      .from("memberships")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    membershipResult = {
      ...legacyResult,
      data: legacyResult.data
        ? { ...legacyResult.data, legacy_permission_profile: null }
        : null,
    } as typeof membershipResult;
  }
  const normalized = normalizeAppRole(
    membershipResult.data?.role,
    membershipResult.data?.legacy_permission_profile
  );
  return normalized ?? "operator";
}

export async function loadProfileForSetup(supabase: SupabaseClient, userId: string) {
  const profile = await selectProfileColumns(supabase, userId, [
    "full_name",
    "phone",
    "job_title",
    "timezone",
    "avatar_url",
    "appearance_preference",
    "notification_preferences",
    "setup_completed_at",
  ]);
  return profile.error ? null : profile.data ?? null;
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

export function isProfileDerivedComplete(profile: Record<string, unknown> | null, fallbackEmail: string) {
  const email = String(fallbackEmail || "").trim().toLowerCase();
  const fullName = String(profile?.full_name ?? "").trim();
  const phone = String(profile?.phone ?? "").trim();
  const jobTitle = String(profile?.job_title ?? "").trim();
  const avatar = String(profile?.avatar_url ?? "").trim();
  const timezone = String(profile?.timezone ?? "").trim();

  if (phone || jobTitle || avatar || timezone) return true;
  if (!fullName) return false;
  return fullName.toLowerCase() !== email;
}

export function isAccountDerivedComplete(profile: Record<string, unknown> | null) {
  const timezone = String(profile?.timezone ?? "").trim();
  const appearance = String(profile?.appearance_preference ?? "").trim();
  const notificationPrefs =
    profile?.notification_preferences && typeof profile.notification_preferences === "object"
      ? profile.notification_preferences
      : null;
  return Boolean(timezone || appearance || (notificationPrefs && Object.keys(notificationPrefs).length > 0));
}

export function isCompanyDerivedComplete(company: Record<string, unknown> | null) {
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

function hasOptionalStepsSkippedRecord(
  checklistRows: Array<{ key: string | null; user_id: string | null; completed_at: string | null }>,
  userId: string
) {
  return checklistRows.some((entry) => {
    if (String(entry.key ?? "") !== SETUP_OPTIONAL_STEPS_SKIPPED_KEY) return false;
    return String(entry.user_id ?? "") === userId && Boolean(entry.completed_at);
  });
}

export async function getSetupStatusForUser(input: {
  supabase: SupabaseClient;
  companyId: string | null;
  userId: string;
  userEmail: string;
}): Promise<SetupStatus> {
  const { supabase, companyId, userId, userEmail } = input;
  const hasCompany = Boolean(companyId);
  const role = await resolveRole(supabase, companyId, userId);
  const requiredDefs = getRequiredSetupStepDefsForContext(role, hasCompany);
  const optionalDefs = getOptionalSetupStepDefs(role);
  const requiredKeys = [...new Set([...requiredDefs, ...optionalDefs].map((step) => step.key))];
  const checklistRows = companyId
    ? (() => {
        const checklistResult = supabase
          .from("onboarding_checklist")
          .select("key,user_id,completed_at")
          .eq("company_id", companyId)
          .in("key", requiredKeys as string[]);
        return checklistResult;
      })()
    : Promise.resolve({ data: [], error: null });

  const checklistResult = await checklistRows;
  const checklistData = checklistResult.error
    ? isMissingOnboardingTable(checklistResult.error.message)
      ? []
      : []
    : checklistResult.data ?? [];

  const [profile, company] = await Promise.all([
    loadProfileForSetup(supabase, userId),
    role === "admin" && companyId ? loadCompanyForSetup(supabase, companyId) : Promise.resolve(null),
  ]);

  const mapStep = (def: SetupStepDef) => {
    const byRecord = isStepCompletedByRecord(
      checklistData as Array<{ key: string | null; user_id: string | null; completed_at: string | null }>,
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

  // Authoritative flag: once the wizard stamps profiles.setup_completed_at, the
  // user is done — never route them back to /setup automatically.
  const wizardCompleted = hasTruthy((profile as Record<string, unknown> | null)?.setup_completed_at);

  const firstIncomplete = required_steps.find((step) => !step.completed) ?? null;
  const firstIncompleteOptional = optional_steps.find((step) => !step.completed) ?? null;
  const required_complete = wizardCompleted || !firstIncomplete;
  const optional_complete = optional_steps.every((step) => step.completed);
  const optional_steps_skipped = hasOptionalStepsSkippedRecord(
    checklistData as Array<{ key: string | null; user_id: string | null; completed_at: string | null }>,
    userId
  );
  return {
    role,
    company_id: companyId,
    has_company: hasCompany,
    required_steps,
    optional_steps,
    required_complete,
    optional_complete,
    optional_steps_skipped,
    is_complete: wizardCompleted || (required_complete && (optional_complete || optional_steps_skipped)),
    next_step_href: firstIncomplete?.href ?? firstIncompleteOptional?.href ?? null,
    next_optional_step_href: firstIncompleteOptional?.href ?? null,
  };
}

export async function markSetupStepCompleted(input: {
  supabase: SupabaseClient;
  companyId: string | null;
  userId: string;
  key: SetupStepKey;
  scope: SetupStepScope;
}) {
  if (!input.companyId) return;
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

export async function markOptionalSetupStepsSkipped(input: {
  supabase: SupabaseClient;
  companyId: string | null;
  userId: string;
}) {
  if (!input.companyId) return;
  const nowIso = new Date().toISOString();
  const existingResult = await input.supabase
    .from("onboarding_checklist")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("user_id", input.userId)
    .eq("key", SETUP_OPTIONAL_STEPS_SKIPPED_KEY)
    .limit(1)
    .maybeSingle();

  if (existingResult.error && isMissingOnboardingTable(existingResult.error.message)) {
    upsertFallbackChecklistRow({
      companyId: input.companyId,
      userId: input.userId,
      key: SETUP_OPTIONAL_STEPS_SKIPPED_KEY,
      completedAt: nowIso,
      completedBy: input.userId,
    });
    return;
  }

  if (existingResult.error) return;

  const payload = {
    company_id: input.companyId,
    user_id: input.userId,
    key: SETUP_OPTIONAL_STEPS_SKIPPED_KEY,
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
