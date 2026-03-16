import { getCompanyId } from "@/lib/tenant/getCompanyId";
import { sanitizeProfileFullName } from "@/lib/user/profileFields";

export type CurrentUserIdentity = {
  userId: string;
  email: string;
  fullName: string;
  displayName: string;
  resolvedName: string;
  avatarUrl: string;
  phone: string;
  jobTitle: string;
  timezone: string;
  companyId: string;
  companyName: string;
};

export function resolveDisplayName({
  fullName,
  displayName,
  email,
}: {
  fullName?: unknown;
  displayName?: unknown;
  email?: unknown;
}): string {
  const normalizedFullName = String(fullName ?? "").trim();
  if (normalizedFullName) return normalizedFullName;

  const normalizedDisplayName = String(displayName ?? "").trim();
  if (normalizedDisplayName) return normalizedDisplayName;

  const normalizedEmail = String(email ?? "").trim();
  if (normalizedEmail) return normalizedEmail;

  return "Team Member";
}

export async function getCurrentUserIdentity(): Promise<CurrentUserIdentity> {
  const { supabase, companyId, userId, userEmail } = await getCompanyId();
  let email = String(userEmail ?? "").trim();

  const userResult = await supabase.auth.getUser();
  if (userResult.data?.user?.email) {
    email = String(userResult.data.user.email).trim();
  }

  let profile:
    | {
        full_name?: string | null;
        display_name?: string | null;
        avatar_url?: string | null;
        phone?: string | null;
        job_title?: string | null;
        timezone?: string | null;
      }
    | null = null;

  const profileWithDisplayName = await supabase
    .from("profiles")
    .select("full_name, display_name, avatar_url, phone, job_title, timezone")
    .eq("id", userId)
    .maybeSingle();

  if (!profileWithDisplayName.error) {
    profile = profileWithDisplayName.data;
  } else if (/avatar_url|phone|job_title|timezone|Could not find the '.*' column/i.test(profileWithDisplayName.error.message || "")) {
    const fallbackProfileWithDisplayName = await supabase
      .from("profiles")
      .select("full_name, display_name")
      .eq("id", userId)
      .maybeSingle();
    if (!fallbackProfileWithDisplayName.error) {
      profile = fallbackProfileWithDisplayName.data;
    }
  } else if (
    /display_name|Could not find the 'display_name' column/i.test(
      profileWithDisplayName.error.message || ""
    )
  ) {
    const fallbackProfile = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    if (!fallbackProfile.error) {
      profile = fallbackProfile.data;
    }
  }

  const fullName = sanitizeProfileFullName(profile?.full_name, email);
  const displayName = String(profile?.display_name ?? "").trim();
  const avatarUrl = String(profile?.avatar_url ?? "").trim();
  const phone = String(profile?.phone ?? "").trim();
  const jobTitle = String(profile?.job_title ?? "").trim();
  const timezone = String(profile?.timezone ?? "").trim();

  const companyResult = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();

  const companyName = String(companyResult.data?.name ?? "").trim() || "My Company";

  return {
    userId,
    email,
    fullName,
    displayName,
    resolvedName: resolveDisplayName({ fullName, displayName, email }),
    avatarUrl,
    phone,
    jobTitle,
    timezone,
    companyId,
    companyName,
  };
}
