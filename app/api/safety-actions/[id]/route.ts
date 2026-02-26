import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem, okSuccess } from "@/lib/http/json";
import { deleteFallbackSafetyAction, updateFallbackSafetyAction } from "@/lib/safety/opsFallbackStore";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  owner_employee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["open", "in_progress", "closed"]).optional(),
  closure_notes: z.string().trim().max(2000).optional(),
});

type ValidationIssue = { path: Array<string | number>; message: string };
const details = (error: { issues: ValidationIssue[] }) =>
  error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

function tenantError(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman"]);
    } catch {
      return forbidden();
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(details(parsedParams.error));

    const parsedBody = patchSchema.safeParse(await request.json());
    if (!parsedBody.success) return validationError(details(parsedBody.error));

    const { supabase, companyId, userId } = await getCompanyId();
    const body = parsedBody.data;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description || null;
    if (body.owner_employee_id !== undefined) updates.owner_employee_id = body.owner_employee_id || null;
    if (body.due_date !== undefined) updates.due_date = body.due_date ? String(body.due_date).slice(0, 10) : null;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.status !== undefined) {
      updates.status = body.status;
      if (body.status === "closed") {
        updates.closed_at = new Date().toISOString();
        updates.closed_by = userId;
      } else {
        updates.closed_at = null;
        updates.closed_by = null;
      }
    }
    if (body.closure_notes !== undefined) updates.closure_notes = body.closure_notes || null;

    const result = await supabase
      .from("safety_actions")
      .update(updates)
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .select("id, safety_log_id, job_id, title, description, owner_employee_id, due_date, status, priority, closed_at, closed_by, closure_notes, created_at, updated_at")
      .single();

    if (result.error) {
      const fallbackUpdated = updateFallbackSafetyAction(companyId, parsedParams.data.id, updates as Record<string, unknown>);
      if (!fallbackUpdated) {
        if (result.error.code === "PGRST116") return notFound("Not found");
        return serverError(result.error.message);
      }
      return okItem(fallbackUpdated);
    }

    return okItem(result.data);
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    try {
      await requireRole(["admin"]);
    } catch {
      return forbidden();
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(details(parsedParams.error));

    const { supabase, companyId } = await getCompanyId();
    const result = await supabase
      .from("safety_actions")
      .delete()
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .select("id")
      .maybeSingle();

    if (result.error || !result.data) {
      const removed = deleteFallbackSafetyAction(companyId, parsedParams.data.id);
      if (!removed) {
        if (result.error) return serverError(result.error.message);
        return notFound("Not found");
      }
    }
    return okSuccess();
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
