import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { okItem } from "@/lib/http/json";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { claimBgJobsParamsSchema, getNextRunAt } from "@/lib/bg-jobs/queue";
import {
  claimBgJobsFallback,
  isMissingBgJobsSchema,
  markBgJobCompletedFallback,
  markBgJobRetryFallback,
  moveBgJobToDlqFallback,
  setAllQueuedDueFallback,
} from "@/lib/bg-jobs/fallbackStore";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
  force_due: z.boolean().optional().default(false),
});

type ValidationIssue = {
  path: Array<string | number>;
  message: string;
};

type BgJobRow = {
  id: string;
  type: string;
  company_id: string;
  payload: Record<string, unknown>;
  status: string;
  run_at: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
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

async function executeJob(job: BgJobRow): Promise<void> {
  if (job.type !== "stub.sync") {
    throw new Error(`Unsupported job type: ${job.type}`);
  }

  const shouldFail = job.payload?.shouldFail === true;
  const failUntilAttemptRaw = job.payload?.failUntilAttempt;
  const failUntilAttempt =
    typeof failUntilAttemptRaw === "number" && Number.isFinite(failUntilAttemptRaw)
      ? failUntilAttemptRaw
      : null;

  if (shouldFail) {
    throw new Error("Stub job forced failure");
  }

  if (failUntilAttempt !== null && job.attempts <= failUntilAttempt) {
    throw new Error(`Stub job failure until attempt ${failUntilAttempt}`);
  }
}

export async function POST(request: Request) {
  try {
    const cronSecret = process.env.BG_JOBS_RUN_SECRET;
    const authHeader = request.headers.get("x-bg-jobs-secret");
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

    let useFallback = false;

    if (parsedBody.data.force_due) {
      const { error: forceDueError } = await supabase
        .from("bg_jobs")
        .update({ run_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("status", "queued");
      if (forceDueError && isMissingBgJobsSchema(forceDueError.message || "")) {
        useFallback = true;
        setAllQueuedDueFallback(companyId);
      } else if (forceDueError) {
        return serverError();
      }
    }

    const parsedClaimParams = claimBgJobsParamsSchema.safeParse({ limit: parsedBody.data.limit });
    if (!parsedClaimParams.success) {
      return validationError(toValidationDetails(parsedClaimParams.error));
    }

    let claimed: BgJobRow[] = [];
    if (useFallback) {
      claimed = claimBgJobsFallback(companyId, parsedClaimParams.data.limit) as BgJobRow[];
    } else {
      const { data: claimedRows, error: claimError } = await supabase.rpc("claim_bg_jobs", {
        p_company_id: companyId,
        p_limit: parsedClaimParams.data.limit,
      });

      if (claimError) {
        if (isMissingBgJobsSchema(claimError.message || "")) {
          useFallback = true;
          claimed = claimBgJobsFallback(companyId, parsedClaimParams.data.limit) as BgJobRow[];
        } else {
          return serverError();
        }
      } else {
        claimed = (Array.isArray(claimedRows) ? claimedRows : []) as BgJobRow[];
      }
    }

    let processed = 0;
    let completed = 0;
    let retried = 0;
    let dlq = 0;

    for (const job of claimed) {
      processed += 1;
      try {
        await executeJob(job);
        if (useFallback) {
          markBgJobCompletedFallback(companyId, job.id);
        } else {
          const { error } = await supabase
            .from("bg_jobs")
            .update({ status: "completed", last_error: null, updated_at: new Date().toISOString() })
            .eq("id", job.id)
            .eq("company_id", companyId);
          if (error) {
            throw new Error(error.message);
          }
        }
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Job execution failed";
        if (job.attempts >= job.max_attempts) {
          if (useFallback) {
            moveBgJobToDlqFallback(companyId, job.id, message);
            dlq += 1;
          } else {
            const { error: dlqInsertError } = await supabase.from("bg_jobs_dlq").insert({
              bg_job_id: job.id,
              type: job.type,
              company_id: companyId,
              payload: job.payload ?? {},
              attempts: job.attempts,
              last_error: message,
            });
            if (!dlqInsertError) {
              await supabase.from("bg_jobs").delete().eq("id", job.id).eq("company_id", companyId);
              dlq += 1;
            } else {
              await supabase
                .from("bg_jobs")
                .update({ status: "failed", last_error: message, updated_at: new Date().toISOString() })
                .eq("id", job.id)
                .eq("company_id", companyId);
            }
          }
        } else {
          const nextRunAt = getNextRunAt(job.attempts);
          if (useFallback) {
            markBgJobRetryFallback(companyId, job.id, nextRunAt, message);
          } else {
            await supabase
              .from("bg_jobs")
              .update({
                status: "queued",
                run_at: nextRunAt,
                last_error: message,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id)
              .eq("company_id", companyId);
          }
          retried += 1;
        }
      }
    }

    return okItem({
      claimed: claimed.length,
      processed,
      completed,
      retried,
      dlq,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
