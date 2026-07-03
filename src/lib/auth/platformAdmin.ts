import { supabaseServer } from "@/lib/supabase/server";

// Platform ("super") admins operate ACROSS companies (e.g. granting a company
// complimentary access). This is distinct from a company's own admin/CEO role,
// which is scoped to a single tenant. A company CEO is NOT a platform admin and
// can never grant themselves free access.
//
// Membership is controlled OUT of band from company roles via env allowlists
// (no hardcoded emails in source):
//   - PLATFORM_ADMIN_USER_IDS : comma-separated auth user ids (preferred)
//   - PLATFORM_ADMIN_EMAILS   : comma-separated emails (case-insensitive)
// If neither is set, there are no platform admins and the admin console/API are
// inaccessible to everyone.
function parseList(value: string | undefined): string[] {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function allowedUserIds(): Set<string> {
  return new Set(parseList(process.env.PLATFORM_ADMIN_USER_IDS));
}

function allowedEmails(): Set<string> {
  return new Set(parseList(process.env.PLATFORM_ADMIN_EMAILS));
}

export function isPlatformAdminIdentity(
  userId: string | null | undefined,
  email: string | null | undefined
): boolean {
  const normalizedId = String(userId ?? "").trim();
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (normalizedId && allowedUserIds().has(normalizedId.toLowerCase())) return true;
  if (normalizedEmail && allowedEmails().has(normalizedEmail)) return true;
  return false;
}

export class PlatformAdminError extends Error {
  status: number;
  constructor(message = "Forbidden") {
    super(message);
    this.status = 403;
  }
}

export type PlatformAdminContext = { userId: string; email: string };

// Resolve the current session and confirm it is a platform admin. Throws
// PlatformAdminError (401 if unauthenticated, 403 if not authorized). Used by
// both the admin API routes and the admin page (server-side enforcement — never
// rely on UI hiding alone).
export async function getPlatformAdmin(): Promise<PlatformAdminContext> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user?.id) {
    const err = new PlatformAdminError("Not authenticated");
    err.status = 401;
    throw err;
  }
  const email = String(user.email ?? "").trim().toLowerCase();
  if (!isPlatformAdminIdentity(user.id, email)) {
    throw new PlatformAdminError();
  }
  return { userId: user.id, email };
}

export async function isCurrentUserPlatformAdmin(): Promise<boolean> {
  try {
    await getPlatformAdmin();
    return true;
  } catch {
    return false;
  }
}
