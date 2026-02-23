import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError } from "@/lib/http/errors";
import {
  ONBOARDING_DISMISSED_KEY,
  getOnboardingChecklistItemsForRole,
  type OnboardingChecklistRole,
} from "@/lib/onboarding/checklist";
import { normalizeAppRole } from "@/lib/nav/config";

export const dynamic = "force-dynamic";

type ChecklistRow = {
  key: string;
  user_id: string | null;
  completed_at: string | null;
  completed_by: string | null;
};

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

async function resolveChecklistRole(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  userId: string
): Promise<OnboardingChecklistRole> {
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", userId)
    .limit(1);

  if (error) {
    throw new TenantResolverError("Forbidden", 403);
  }

  const normalizedRole = normalizeAppRole(data?.[0]?.role);
  if (!normalizedRole) {
    throw new TenantResolverError("Forbidden", 403);
  }

  return normalizedRole;
}

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await resolveChecklistRole(supabase, companyId, userId);

    const { data, error } = await supabase
      .from("onboarding_checklist")
      .select("key, user_id, completed_at, completed_by")
      .eq("company_id", companyId);

    if (error) {
      return serverError(error.message);
    }

    const rows = (data ?? []) as ChecklistRow[];
    const completedMap = new Map(
      rows.map((row) => [`${row.key}::${row.user_id ?? "__company__"}`, row])
    );
    const dismissed = Boolean(completedMap.get(`${ONBOARDING_DISMISSED_KEY}::${userId}`)?.completed_at);
    const checklistItems = getOnboardingChecklistItemsForRole(role);

    const items = checklistItems.map((item) => {
      const mapKey = `${item.key}::${item.scope === "company" ? "__company__" : userId}`;
      const completion = completedMap.get(mapKey);
      return {
        key: item.key,
        label: item.label,
        scope: item.scope,
        description: item.description,
        view: item.view,
        completed: Boolean(completion?.completed_at),
        completed_at: completion?.completed_at ?? null,
        completed_by: completion?.completed_by ?? null,
      };
    });

    return NextResponse.json({
      items,
      dismissed,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
