import { z } from "zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { createFallbackSafetyLog, listFallbackSafetyLogs } from "@/lib/safety/fallbackStore";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";
import { getRoleScopedJobIds, resolveMembershipRole } from "@/lib/jobs/roleScope";
import { enqueueNotifications } from "@/lib/notifications/enqueue";

export const dynamic = "force-dynamic";

const createSafetyLogSchema = z.object({
  occurred_on: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  severity: z.enum(["low", "medium", "high"]),
  job_id: z.union([z.string(), z.number()]).nullable().optional(),
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
  if (error.status === 401) {
    return Response.json({ items: [], ...getPaginationMeta(0, 1, 50) });
  }
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

function isMissingSafetyLogsTable(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("safety_logs") && (normalized.includes("does not exist") || normalized.includes("not find"));
}

const severityToLegacyType = {
  low: "toolbox",
  medium: "preop",
  high: "jsa",
};

const severityToLegacyTypeLabel = {
  low: "Toolbox Talk",
  medium: "Pre-Op Inspection",
  high: "JSA",
};

function normalizeSeverity(raw: unknown) {
  const value = String(raw ?? "").toLowerCase();
  if (value === "low" || value === "medium" || value === "high") return value;
  if (value === "toolbox") return "low";
  if (value === "preop") return "medium";
  if (value === "jsa") return "high";
  return "medium";
}

function normalizeSafetyLog(row: Record<string, unknown>) {
  return {
    id: row.id,
    job_id: row.job_id ?? null,
    occurred_on: String(row.occurred_on ?? row.date ?? row.occurredAt ?? ""),
    summary: String(row.summary ?? row.topic ?? row.title ?? row.notes ?? ""),
    severity: normalizeSeverity(row.severity ?? row.type),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function insertSafetyLogWithFallback(
  supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"],
  companyId: string,
  occurredOn: string,
  summary: string,
  severity: "low" | "medium" | "high",
  jobId: string | null
) {
  const attempts = [
    { company_id: companyId, occurred_on: occurredOn, summary, severity, job_id: jobId },
    { company_id: companyId, date: occurredOn, summary, severity, job_id: jobId },
    { company_id: companyId, occurred_on: occurredOn, topic: summary, severity, job_id: jobId },
    { company_id: companyId, date: occurredOn, topic: summary, severity, job_id: jobId },
    { company_id: companyId, date: occurredOn, topic: summary, type: severityToLegacyType[severity], job_id: jobId },
    { company_id: companyId, occurred_on: occurredOn, summary, type: severityToLegacyType[severity], job_id: jobId },
    { company_id: companyId, date: occurredOn, topic: summary, type: severityToLegacyTypeLabel[severity], job_id: jobId },
    {
      company_id: companyId,
      date: occurredOn,
      topic: summary,
      type: severityToLegacyTypeLabel[severity],
      attendees: 0,
      conductor: "System",
      job_id: jobId,
    },
    {
      company_id: companyId,
      occurred_on: occurredOn,
      summary,
      severity,
      attendees: 0,
      conductor: "System",
      job_id: jobId,
    },
  ];

  let lastErrorMessage = "";
  for (const payload of attempts) {
    const { data, error } = await supabase
      .from("safety_logs")
      .insert(payload)
      .select("*")
      .single();
    if (!error && data) {
      return { data, error: null };
    }
    lastErrorMessage = error?.message || lastErrorMessage;
  }

  return {
    data: null,
    error: {
      message: lastErrorMessage || "Insert failed",
    },
  };
}

export async function GET(request: Request) {
  try {
    const { page, pageSize, from, to } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await resolveMembershipRole(supabase, companyId, userId);
    if (!role) {
      return forbidden();
    }

    const scopedJobIds = await getRoleScopedJobIds(supabase, companyId, userId, role);
    if (scopedJobIds && scopedJobIds.length === 0) {
      const pagination = getPaginationMeta(0, page, pageSize);
      return Response.json({ items: [], ...pagination });
    }

    let query = supabase
      .from("safety_logs")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("occurred_on", { ascending: false });

    if (scopedJobIds) {
      query = query.in("job_id", scopedJobIds);
    }

    const { data, error, count } = await query.range(from, to);

    const fallbackItems = listFallbackSafetyLogs(companyId);

    if (error) {
      if (isMissingSafetyLogsTable(error.message)) {
        const pagedFallback = fallbackItems.slice(from, to + 1);
        return Response.json({ items: pagedFallback, ...getPaginationMeta(fallbackItems.length, page, pageSize) });
      }
      const pagedFallback = fallbackItems.slice(from, to + 1);
      return Response.json({ items: pagedFallback, ...getPaginationMeta(fallbackItems.length, page, pageSize) });
    }

    const dbItems = Array.isArray(data)
      ? data.map((row) => normalizeSafetyLog(row as Record<string, unknown>))
      : [];

    const merged = new Map<string, ReturnType<typeof normalizeSafetyLog>>();
    for (const item of dbItems) {
      merged.set(String(item.id), item);
    }
    for (const item of fallbackItems) {
      merged.set(String(item.id), { ...item, job_id: null });
    }

    const sorted = Array.from(merged.values()).sort((a, b) =>
      String(b.occurred_on).localeCompare(String(a.occurred_on))
    );
    const items = sorted.slice(from, to + 1);

    return Response.json({ items, ...getPaginationMeta(count ?? sorted.length, page, pageSize) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    const { page, pageSize } = getPaginationFromUrl(request.url, { defaultPageSize: 50, maxPageSize: 200 });
    return Response.json({ items: [], ...getPaginationMeta(0, page, pageSize) });
  }
}

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman", "operator"]);
    } catch {
      return forbidden();
    }

    const parsedBody = createSafetyLogSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const occurredOn = new Date(parsedBody.data.occurred_on);
    if (Number.isNaN(occurredOn.getTime())) {
      return validationError([
        {
          path: "occurred_on",
          message: "Invalid date",
        },
      ]);
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const role = await resolveMembershipRole(supabase, companyId, userId);
    if (!role) {
      return forbidden();
    }

    const jobId =
      parsedBody.data.job_id === null || parsedBody.data.job_id === undefined || parsedBody.data.job_id === ""
        ? null
        : String(parsedBody.data.job_id);

    if ((role === "foreman" || role === "operator") && !jobId) {
      return validationError([{ path: "job_id", message: "job_id is required" }]);
    }

    if (jobId) {
      const { data: jobRows, error: jobError } = await supabase
        .from("jobs")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", jobId)
        .limit(1);
      if (jobError || !jobRows?.length) {
        return notFound("Job not found");
      }
    }

    if ((role === "foreman" || role === "operator") && jobId) {
      const scopedJobIds = await getRoleScopedJobIds(supabase, companyId, userId, role);
      if (!scopedJobIds?.includes(String(jobId))) {
        return forbidden();
      }
    }

    const { data, error } = await insertSafetyLogWithFallback(
      supabase,
      companyId,
      parsedBody.data.occurred_on,
      parsedBody.data.summary,
      parsedBody.data.severity,
      jobId
    );

    if (error || !data) {
      const fallbackItem = createFallbackSafetyLog({
        companyId,
        occurred_on: parsedBody.data.occurred_on,
        summary: parsedBody.data.summary,
        severity: parsedBody.data.severity,
      });
      return okItem(fallbackItem, 201);
    }

    try {
      const membersResult = await supabase
        .from("memberships")
        .select("user_id, role")
        .eq("company_id", companyId)
        .in("role", ["admin", "pm"]);
      if (!membersResult.error) {
        const recipientIds = (membersResult.data ?? [])
          .map((row) => String(row.user_id ?? ""))
          .filter((id) => Boolean(id) && id !== String(userId));
        if (recipientIds.length > 0) {
          await enqueueNotifications({
            supabase,
            companyId,
            userIds: recipientIds,
            type: "safety_log_created",
            payload: {
              id: String((data as Record<string, unknown>).id ?? ""),
              summary: parsedBody.data.summary,
              severity: parsedBody.data.severity,
              date: parsedBody.data.occurred_on,
              href: "/safety",
            },
          });
        }
      }
    } catch {
      // Non-blocking: safety log persistence succeeds even if notification fanout fails.
    }

    return okItem(normalizeSafetyLog(data as Record<string, unknown>), 201);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
