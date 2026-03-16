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
  type IdentityProfileRow = {
    full_name?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
    phone?: string | null;
    job_title?: string | null;
    timezone?: string | null;
  };

  const userResult = await supabase.auth.getUser();
  if (userResult.data?.user?.email) {
    email = String(userResult.data.user.email).trim();
  }

  let profile: IdentityProfileRow | null = null;

  const parseMissingColumn = (message: string | undefined) => {
    if (!message) return null;
    const quoted = message.match(/Could not find the '([^']+)' column/i);
    if (quoted?.[1]) return quoted[1];
    const generic = message.match(/column\s+"?([a-zA-Z0-9_]+)"?\s+does not exist/i);
    if (generic?.[1]) return generic[1];
    return null;
  };

  const selectColumns = ["full_name", "display_name", "avatar_url", "phone", "job_title", "timezone"];
  for (let attempt = 0; attempt < selectColumns.length; attempt += 1) {
    const profileResult = await supabase
      .from("profiles")
      .select(selectColumns.join(", "))
      .eq("id", userId)
      .maybeSingle<IdentityProfileRow>();
    if (!profileResult.error) {
      profile = profileResult.data;
      break;
    }
    const missingColumn = parseMissingColumn(profileResult.error.message);
    if (!missingColumn || !selectColumns.includes(missingColumn)) {
      break;
    }
    selectColumns.splice(selectColumns.indexOf(missingColumn), 1);
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
