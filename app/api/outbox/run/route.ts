import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { okItem } from "@/lib/http/json";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { processOutboxEvents } from "@/lib/outbox/queue";
import { gaugeMetric, incrementMetric } from "@/lib/observability/metrics";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
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
    const cronSecret = process.env.OUTBOX_RUN_SECRET;
    const authHeader = request.headers.get("x-outbox-secret");
    const viaSecret = Boolean(cronSecret && authHeader && authHeader === cronSecret);

    if (!viaSecret) {
      try {
        await requireRole(["admin", "pm"]);
      } catch {
        return forbidden();
      }
    }

    const payload = await request.json().catch(() => ({}));
    const parsedBody = bodySchema.safeParse(payload);
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId } = await getCompanyId();
    const result = await processOutboxEvents(supabase, companyId, parsedBody.data.limit);
    gaugeMetric("outbox_queue_claimed", result.claimed, { companyId });
    gaugeMetric("outbox_queue_failed", result.failed, { companyId });
    incrementMetric("outbox_processor_runs_total", { companyId });
    return okItem(result);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
