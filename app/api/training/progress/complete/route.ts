import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";

export const dynamic = "force-dynamic";

const completeSchema = z.object({
  courseId: z.string().uuid(),
  employeeId: z.string().uuid(),
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

export async function POST(request: Request) {
  try {
    try {
      await requireRole(["admin", "pm", "foreman", "mechanic", "operator"]);
    } catch {
      return forbidden();
    }

    const parsedBody = completeSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId, userId } = await getCompanyId();

    const [courseResult, employeeResult] = await Promise.all([
      supabase
        .from("training_courses")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", parsedBody.data.courseId)
        .maybeSingle(),
      supabase
        .from("employees")
        .select("id")
        .eq("company_id", companyId)
        .eq("id", parsedBody.data.employeeId)
        .maybeSingle(),
    ]);

    if (courseResult.error) return serverError(courseResult.error.message);
    if (employeeResult.error) return serverError(employeeResult.error.message);
    if (!courseResult.data) return notFound("Course not found");
    if (!employeeResult.data) return notFound("Employee not found");

    const completedAt = parsedBody.data.completed ? new Date().toISOString() : null;

    const upsertResult = await supabase
      .from("training_progress")
      .upsert(
        {
          company_id: companyId,
          course_id: parsedBody.data.courseId,
          employee_id: parsedBody.data.employeeId,
          completed_at: completedAt,
          completed_by: parsedBody.data.completed ? userId : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,course_id,employee_id" }
      )
      .select("course_id, employee_id, completed_at")
      .single();

    if (upsertResult.error || !upsertResult.data) {
      return serverError(upsertResult.error?.message);
    }

    return okItem({
      courseId: upsertResult.data.course_id,
      employeeId: upsertResult.data.employee_id,
      completedAt: upsertResult.data.completed_at,
      completed: Boolean(upsertResult.data.completed_at),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
