import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import {
  getOnboardingChecklistItemsForRole,
  type OnboardingChecklistRole,
} from "@/lib/onboarding/checklist";
import { normalizeAppRole } from "@/lib/nav/config";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  key: z.string().min(1),
  completed: z.boolean().optional().default(true),
});

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

function toValidationDetails(error: { issues: ValidationIssue[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const role = await resolveChecklistRole(supabase, companyId, userId);
    const roleItems = getOnboardingChecklistItemsForRole(role);
    const roleItemsMap = new Map(roleItems.map((item) => [item.key, item]));
    const itemDef = roleItemsMap.get(parsedBody.data.key);
    if (!itemDef) {
      return validationError([{ path: "key", message: "Invalid checklist key" }]);
    }

    const completedAt = parsedBody.data.completed ? new Date().toISOString() : null;

    const { data, error } = await supabase
      .from("onboarding_checklist")
      .upsert(
        {
          company_id: companyId,
          key: parsedBody.data.key,
          completed_at: completedAt,
          completed_by: parsedBody.data.completed ? userId : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,key" }
      )
      .select("key, completed_at, completed_by")
      .single();

    if (error || !data) {
      return serverError(error?.message ?? "Failed to update checklist item");
    }

    return okItem({
      key: data.key,
      label: itemDef?.label ?? data.key,
      description: itemDef?.description ?? "",
      view: itemDef?.view ?? "dashboard",
      completed: Boolean(data.completed_at),
      completed_at: data.completed_at,
      completed_by: data.completed_by,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
