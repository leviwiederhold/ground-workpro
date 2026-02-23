import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { ONBOARDING_DISMISSED_KEY } from "@/lib/onboarding/checklist";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  dismissed: z.boolean(),
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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsedBody = bodySchema.safeParse(body);
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const completedAt = parsedBody.data.dismissed ? new Date().toISOString() : null;
    const nowIso = new Date().toISOString();

    const existingResult = await supabase
      .from("onboarding_checklist")
      .select("id")
      .eq("company_id", companyId)
      .eq("key", ONBOARDING_DISMISSED_KEY)
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (existingResult.error && existingResult.error.code !== "PGRST116") {
      return serverError(existingResult.error.message);
    }

    const mutationPayload = {
      company_id: companyId,
      user_id: userId,
      key: ONBOARDING_DISMISSED_KEY,
      completed_at: completedAt,
      completed_by: parsedBody.data.dismissed ? userId : null,
      updated_at: nowIso,
    };

    const mutationQuery = existingResult.data?.id
      ? supabase.from("onboarding_checklist").update(mutationPayload).eq("id", existingResult.data.id)
      : supabase.from("onboarding_checklist").insert(mutationPayload);

    const { data, error } = await mutationQuery.select("key, completed_at").single();
    if (error || !data) {
      return serverError(error?.message ?? "Failed to update dismissal state");
    }

    return okItem({
      dismissed: Boolean(data.completed_at),
      dismissed_at: data.completed_at,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
