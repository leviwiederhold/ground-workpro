import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { forbidden, serverError, validationError } from "@/lib/http/errors";
import { okItem, okItems } from "@/lib/http/json";
import { createFallbackToolboxTalk, listFallbackToolboxTalks } from "@/lib/safety/opsFallbackStore";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  job_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const createSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).optional().default(""),
  occurred_on: z.string().trim().min(1),
  job_id: z.string().uuid().optional().nullable(),
  attendee_employee_ids: z.array(z.string().uuid()).optional().default([]),
});

type ValidationIssue = { path: Array<string | number>; message: string };
const details = (error: { issues: ValidationIssue[] }) =>
  error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

function tenantError(error: TenantResolverError) {
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function GET(request: Request) {
  try {
    const parsed = querySchema.safeParse({
      job_id: new URL(request.url).searchParams.get("job_id") ?? undefined,
      limit: new URL(request.url).searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) return validationError(details(parsed.error));

    const { supabase, companyId } = await getCompanyId();
    let talksQuery = supabase
      .from("toolbox_talks")
      .select("id, job_id, topic, summary, occurred_on, created_by, created_at, updated_at")
      .eq("company_id", companyId)
      .order("occurred_on", { ascending: false })
      .limit(parsed.data.limit);

    if (parsed.data.job_id) talksQuery = talksQuery.eq("job_id", parsed.data.job_id);

    const talksResult = await talksQuery;
    if (talksResult.error) return okItems(listFallbackToolboxTalks(companyId));

    const talkIds = (talksResult.data ?? []).map((row) => String(row.id));
    if (talkIds.length === 0) return okItems([]);

    const attendeeResult = await supabase
      .from("toolbox_talk_attendees")
      .select("toolbox_talk_id, employee_id, acknowledged_at")
      .eq("company_id", companyId)
      .in("toolbox_talk_id", talkIds);
    if (attendeeResult.error) return okItems(listFallbackToolboxTalks(companyId));

    const attendeesByTalk = new Map<string, Array<{ employee_id: string; acknowledged_at: string | null }>>();
    for (const row of attendeeResult.data ?? []) {
      const key = String(row.toolbox_talk_id);
      const current = attendeesByTalk.get(key) ?? [];
      current.push({ employee_id: String(row.employee_id), acknowledged_at: row.acknowledged_at });
      attendeesByTalk.set(key, current);
    }

    return okItems(
      (talksResult.data ?? []).map((row) => ({
        ...row,
        attendee_employee_ids: (attendeesByTalk.get(String(row.id)) ?? []).map((item) => item.employee_id),
        attendees_count: (attendeesByTalk.get(String(row.id)) ?? []).length,
      }))
    );
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

    const { supabase, companyId, userId } = await getCompanyId();

    const occurredOn = String(parsed.data.occurred_on).slice(0, 10);

    const talkInsert = await supabase
      .from("toolbox_talks")
      .insert({
        company_id: companyId,
        topic: parsed.data.topic,
        summary: parsed.data.summary || null,
        occurred_on: occurredOn,
        job_id: parsed.data.job_id || null,
        created_by: userId,
      })
      .select("id, job_id, topic, summary, occurred_on, created_by, created_at, updated_at")
      .single();

    if (talkInsert.error || !talkInsert.data) {
      const fallbackAttendees: string[] = (parsed.data.attendee_employee_ids || []).map((value: string) => String(value));
      const fallback = createFallbackToolboxTalk({
        company_id: companyId,
        job_id: parsed.data.job_id || null,
        topic: parsed.data.topic,
        summary: parsed.data.summary || null,
        occurred_on: occurredOn,
        created_by: userId,
        attendee_employee_ids: Array.from(new Set(fallbackAttendees)),
      });
      return okItem(fallback, 201);
    }

    const attendeeIds: string[] = Array.from(
      new Set((parsed.data.attendee_employee_ids || []).map((value: string) => String(value)))
    );
    if (attendeeIds.length > 0) {
      const attendeeRows = attendeeIds.map((employeeId) => ({
        company_id: companyId,
        toolbox_talk_id: talkInsert.data.id,
        employee_id: employeeId,
      }));
      const attendeeInsert = await supabase.from("toolbox_talk_attendees").upsert(attendeeRows, {
        onConflict: "company_id,toolbox_talk_id,employee_id",
      });
      if (attendeeInsert.error) {
        const fallback = createFallbackToolboxTalk({
          company_id: companyId,
          job_id: parsed.data.job_id || null,
          topic: parsed.data.topic,
          summary: parsed.data.summary || null,
          occurred_on: occurredOn,
          created_by: userId,
          attendee_employee_ids: attendeeIds,
        });
        return okItem(fallback, 201);
      }
    }

    return okItem({
      ...talkInsert.data,
      attendee_employee_ids: attendeeIds,
      attendees_count: attendeeIds.length,
    }, 201);
  } catch (error) {
    if (error instanceof TenantResolverError) return tenantError(error);
    return serverError();
  }
}
