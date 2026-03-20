import { getOptionalCompanyId } from "@/lib/tenant/getCompanyId";
import { sanitizeProfileFullName } from "@/lib/user/profileFields";
import { selectProfileColumns, type ProfileRecord } from "@/lib/user/profileRecord";

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
  companyId: string | null;
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
  const { supabase, companyId, userId, userEmail } = await getOptionalCompanyId();
  let email = String(userEmail ?? "").trim();

  const userResult = await supabase.auth.getUser();
  if (userResult.data?.user?.email) {
    email = String(userResult.data.user.email).trim();
  }

  const profileResult = await selectProfileColumns<ProfileRecord>(supabase, userId, [
    "full_name",
    "avatar_url",
    "phone",
    "job_title",
    "timezone",
  ]);
  const profile = profileResult.error ? null : profileResult.data;

  const fullName = sanitizeProfileFullName(profile?.full_name, email);
  const avatarUrl = String(profile?.avatar_url ?? "").trim();
  const phone = String(profile?.phone ?? "").trim();
  const jobTitle = String(profile?.job_title ?? "").trim();
  const timezone = String(profile?.timezone ?? "").trim();

  const companyResult = companyId
    ? await supabase
        .from("companies")
        .select("name")
        .eq("id", companyId)
        .maybeSingle()
    : { data: null };
  const companyName = String(companyResult.data?.name ?? "").trim() || "My Company";

  return {
    userId,
    email,
    fullName,
    displayName: "",
    resolvedName: resolveDisplayName({ fullName, email }),
    avatarUrl,
    phone,
    jobTitle,
    timezone,
    companyId,
    companyName,
  };
}
