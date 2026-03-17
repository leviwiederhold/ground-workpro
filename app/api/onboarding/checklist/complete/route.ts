import { z } from "zod";
import { cookies } from "next/headers";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import {
  getOnboardingChecklistItemsForRole,
} from "@/lib/onboarding/checklist";
import { normalizeAppRole, type AppRole } from "@/lib/nav/config";
import { upsertFallbackChecklistRow } from "@/lib/onboarding/fallbackStore";
import {
  applyPermissionOverrideFromCookie,
  resolveUserModulePermissions,
  TEST_MODULE_ACCESS_COOKIE,
} from "@/lib/permissions/runtime";

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

function isMissingOnboardingTable(message: string | undefined) {
  return /onboarding_checklist/i.test(String(message || "")) && /does not exist|not find/i.test(String(message || ""));
}

async function resolveChecklistRole(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  userId: string
): Promise<AppRole> {
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
    const cookieStore = await cookies();
    let modulePermissions = await resolveUserModulePermissions({
      supabase,
      companyId,
      userId,
      role,
    });
    if (process.env.NODE_ENV !== "production" || process.env.E2E === "true") {
      modulePermissions = applyPermissionOverrideFromCookie(
        modulePermissions,
        cookieStore.get(TEST_MODULE_ACCESS_COOKIE)?.value
      );
    }
    const roleItems = getOnboardingChecklistItemsForRole(role, { permissions: modulePermissions });
    const roleItemsMap = new Map(roleItems.map((item) => [item.key, item]));
    const key = parsedBody.data.key as (typeof roleItems)[number]["key"];
    const itemDef = roleItemsMap.get(key);
    if (!itemDef) {
      return validationError([{ path: "key", message: "Invalid checklist key" }]);
    }

    const completedAt = parsedBody.data.completed ? new Date().toISOString() : null;
    const rowUserId = itemDef.scope === "company" ? null : userId;
    const nowIso = new Date().toISOString();

    const existingQuery = supabase
      .from("onboarding_checklist")
      .select("id")
      .eq("company_id", companyId)
      .eq("key", key)
      .limit(1);

    const existingResult = rowUserId
      ? await existingQuery.eq("user_id", rowUserId).maybeSingle()
      : await existingQuery.is("user_id", null).maybeSingle();

    if (existingResult.error && !isMissingOnboardingTable(existingResult.error.message)) {
      return serverError(existingResult.error.message);
    }

    if (existingResult.error && isMissingOnboardingTable(existingResult.error.message)) {
      const fallback = upsertFallbackChecklistRow({
        companyId,
        userId: rowUserId,
        key,
        completedAt,
        completedBy: parsedBody.data.completed ? userId : null,
      });
      return okItem({
        key: fallback.key,
        label: itemDef?.label ?? fallback.key,
        description: itemDef?.description ?? "",
        view: itemDef?.view ?? "dashboard",
        href: itemDef?.href ?? "/",
        completed: Boolean(fallback.completed_at),
        completed_at: fallback.completed_at,
        completed_by: fallback.completed_by,
      });
    }

    const mutationPayload = {
      company_id: companyId,
      user_id: rowUserId,
      key,
      completed_at: completedAt,
      completed_by: parsedBody.data.completed ? userId : null,
      updated_at: nowIso,
    };

    const mutationQuery = existingResult.data?.id
      ? supabase
          .from("onboarding_checklist")
          .update(mutationPayload)
          .eq("id", existingResult.data.id)
      : supabase.from("onboarding_checklist").insert(mutationPayload);

    const { data, error } = await mutationQuery
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
      href: itemDef?.href ?? "/",
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
