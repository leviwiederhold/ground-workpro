import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem, okItems } from "@/lib/http/json";
import { createFallbackSafetyAction, listFallbackSafetyActions } from "@/lib/safety/opsFallbackStore";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["open", "in_progress", "closed", "all"]).optional().default("all"),
  job_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const createSchema = z.object({
  safety_log_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(""),
  owner_employee_id: z.string().uuid().optional().nullable(),
  due_date: z.string().optional().nullable(),
  priority: z.enum(["low", "medium", "high"]).optional().default("medium"),
  job_id: z.string().uuid().optional().nullable(),
});

type ValidationIssue = { path: Array<string | number>; message: string };
const details = (error: { issues: ValidationIssue[] }) =>
  error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

function tenantError(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function GET(request: Request) {
  try {
    const { supabase, companyId } = await getCompanyId();
    const parsed = querySchema.safeParse({
      status: new URL(request.url).searchParams.get("status") ?? undefined,
      job_id: new URL(request.url).searchParams.get("job_id") ?? undefined,
      limit: new URL(request.url).searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return validationError(details(parsed.error));

    let query = supabase
      .from("safety_actions")
      .select("id, safety_log_id, job_id, title, description, owner_employee_id, due_date, status, priority, closed_at, closed_by, closure_notes, created_at, updated_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(parsed.data.limit);

    if (parsed.data.status !== "all") query = query.eq("status", parsed.data.status);
    if (parsed.data.job_id) query = query.eq("job_id", parsed.data.job_id);

    const result = await query;
    if (result.error) {
      return okItems(listFallbackSafetyActions(companyId));
    }

    const dbItems = result.data ?? [];
    const fallbackItems = listFallbackSafetyActions(companyId);
    const merged = new Map<string, Record<string, unknown>>();
    for (const item of fallbackItems) merged.set(String(item.id), item as unknown as Record<string, unknown>);
    for (const item of dbItems) merged.set(String(item.id), item as unknown as Record<string, unknown>);
    return okItems(Array.from(merged.values()));
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman", "operator"]);
    } catch {
      return forbidden();
    }

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(details(parsed.error));

    const { supabase, companyId } = await getCompanyId();

    const logCheck = await supabase
      .from("safety_logs")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", parsed.data.safety_log_id)
      .maybeSingle();
    if (logCheck.error || !logCheck.data) {
      const fallback = createFallbackSafetyAction({
        company_id: companyId,
        safety_log_id: parsed.data.safety_log_id,
        job_id: parsed.data.job_id || null,
        title: parsed.data.title,
        description: parsed.data.description || null,
        owner_employee_id: parsed.data.owner_employee_id || null,
        due_date: parsed.data.due_date ? String(parsed.data.due_date).slice(0, 10) : null,
        status: "open",
        priority: parsed.data.priority,
        closed_at: null,
        closed_by: null,
        closure_notes: null,
      });
      return okItem(fallback, 201);
    }

    const { data, error } = await supabase
      .from("safety_actions")
      .insert({
        company_id: companyId,
        safety_log_id: parsed.data.safety_log_id,
        title: parsed.data.title,
        description: parsed.data.description || null,
        owner_employee_id: parsed.data.owner_employee_id || null,
        due_date: parsed.data.due_date ? String(parsed.data.due_date).slice(0, 10) : null,
        priority: parsed.data.priority,
        job_id: parsed.data.job_id || null,
      })
      .select("id, safety_log_id, job_id, title, description, owner_employee_id, due_date, status, priority, closed_at, closed_by, closure_notes, created_at, updated_at")
      .single();

    if (error || !data) {
      const fallback = createFallbackSafetyAction({
        company_id: companyId,
        safety_log_id: parsed.data.safety_log_id,
        job_id: parsed.data.job_id || null,
        title: parsed.data.title,
        description: parsed.data.description || null,
        owner_employee_id: parsed.data.owner_employee_id || null,
        due_date: parsed.data.due_date ? String(parsed.data.due_date).slice(0, 10) : null,
        status: "open",
        priority: parsed.data.priority,
        closed_at: null,
        closed_by: null,
        closure_notes: null,
      });
      return okItem(fallback, 201);
    }
    return okItem(data, 201);
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
