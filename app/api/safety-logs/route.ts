import { z } from "next/dist/compiled/zod";
import { requireRole } from "@/lib/auth/requireRole";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { createFallbackSafetyLog, listFallbackSafetyLogs } from "@/lib/safety/fallbackStore";
import { getPaginationFromUrl, getPaginationMeta } from "@/lib/http/pagination";

export const dynamic = "force-dynamic";

const createSafetyLogSchema = z.object({
  occurred_on: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  severity: z.enum(["low", "medium", "high"]),
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
  severity: "low" | "medium" | "high"
) {
  const attempts = [
    { company_id: companyId, occurred_on: occurredOn, summary, severity },
    { company_id: companyId, date: occurredOn, summary, severity },
    { company_id: companyId, occurred_on: occurredOn, topic: summary, severity },
    { company_id: companyId, date: occurredOn, topic: summary, severity },
    { company_id: companyId, date: occurredOn, topic: summary, type: severityToLegacyType[severity] },
    { company_id: companyId, occurred_on: occurredOn, summary, type: severityToLegacyType[severity] },
    { company_id: companyId, date: occurredOn, topic: summary, type: severityToLegacyTypeLabel[severity] },
    {
      company_id: companyId,
      date: occurredOn,
      topic: summary,
      type: severityToLegacyTypeLabel[severity],
      attendees: 0,
      conductor: "System",
      job_id: null,
    },
    {
      company_id: companyId,
      occurred_on: occurredOn,
      summary,
      severity,
      attendees: 0,
      conductor: "System",
      job_id: null,
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
    const { supabase, companyId } = await getCompanyId();

    const { data, error, count } = await supabase
      .from("safety_logs")
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("occurred_on", { ascending: false })
      .range(from, to);

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
      merged.set(String(item.id), item);
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
    return serverError();
  }
}

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman"]);
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

    const { supabase, companyId } = await getCompanyId();

    const { data, error } = await insertSafetyLogWithFallback(
      supabase,
      companyId,
      parsedBody.data.occurred_on,
      parsedBody.data.summary,
      parsedBody.data.severity
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

    return okItem(normalizeSafetyLog(data as Record<string, unknown>), 201);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
