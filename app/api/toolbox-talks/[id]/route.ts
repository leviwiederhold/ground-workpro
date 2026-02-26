import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem, okSuccess } from "@/lib/http/json";
import { deleteFallbackToolboxTalk, updateFallbackToolboxTalk } from "@/lib/safety/opsFallbackStore";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const patchSchema = z.object({
  topic: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(2000).optional(),
  occurred_on: z.string().trim().optional(),
  job_id: z.string().uuid().nullable().optional(),
  attendee_employee_ids: z.array(z.string().uuid()).optional(),
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

    const { supabase, companyId } = await getCompanyId();
    const body = parsedBody.data;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.topic !== undefined) updates.topic = body.topic;
    if (body.summary !== undefined) updates.summary = body.summary || null;
    if (body.occurred_on !== undefined) updates.occurred_on = String(body.occurred_on).slice(0, 10);
    if (body.job_id !== undefined) updates.job_id = body.job_id || null;

    const talkUpdate = await supabase
      .from("toolbox_talks")
      .update(updates)
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .select("id, job_id, topic, summary, occurred_on, created_by, created_at, updated_at")
      .single();

    if (talkUpdate.error) {
      const fallbackUpdated = updateFallbackToolboxTalk(companyId, parsedParams.data.id, {
        ...(body.topic !== undefined ? { topic: body.topic } : {}),
        ...(body.summary !== undefined ? { summary: body.summary || null } : {}),
        ...(body.occurred_on !== undefined ? { occurred_on: String(body.occurred_on).slice(0, 10) } : {}),
        ...(body.job_id !== undefined ? { job_id: body.job_id || null } : {}),
        ...(body.attendee_employee_ids ? { attendee_employee_ids: Array.from(new Set(body.attendee_employee_ids)) } : {}),
      });
      if (!fallbackUpdated) {
        if (talkUpdate.error.code === "PGRST116") return notFound("Not found");
        return serverError(talkUpdate.error.message);
      }
      return okItem(fallbackUpdated);
    }

    if (body.attendee_employee_ids) {
      await supabase
        .from("toolbox_talk_attendees")
        .delete()
        .eq("company_id", companyId)
        .eq("toolbox_talk_id", parsedParams.data.id);

      const uniqueIds = Array.from(new Set(body.attendee_employee_ids));
      if (uniqueIds.length > 0) {
        const rows = uniqueIds.map((employeeId) => ({
          company_id: companyId,
          toolbox_talk_id: parsedParams.data.id,
          employee_id: employeeId,
        }));
        const insertResult = await supabase
          .from("toolbox_talk_attendees")
          .insert(rows);
        if (insertResult.error) return serverError(insertResult.error.message);
      }
    }

    const attendeeResult = await supabase
      .from("toolbox_talk_attendees")
      .select("employee_id")
      .eq("company_id", companyId)
      .eq("toolbox_talk_id", parsedParams.data.id);
    if (attendeeResult.error) return serverError(attendeeResult.error.message);

    return okItem({
      ...talkUpdate.data,
      attendee_employee_ids: (attendeeResult.data ?? []).map((row) => String(row.employee_id)),
      attendees_count: (attendeeResult.data ?? []).length,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return forbidden();
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) return validationError(details(parsedParams.error));

    const { supabase, companyId } = await getCompanyId();
    const result = await supabase
      .from("toolbox_talks")
      .delete()
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .select("id")
      .maybeSingle();

    if (result.error || !result.data) {
      const removed = deleteFallbackToolboxTalk(companyId, parsedParams.data.id);
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
