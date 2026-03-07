import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const assignSchema = z.object({
  employeeIds: z.array(z.string().uuid()).min(1),
  dueDate: z.string().trim().optional().nullable(),
  required: z.boolean().optional().default(false),
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return forbidden();
    }

    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return validationError(toValidationDetails(parsedParams.error));
    }

    const parsedBody = assignSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const courseId = parsedParams.data.id;

    const course = await supabase
      .from("training_courses")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", courseId)
      .maybeSingle();

    if (course.error) return serverError(course.error.message);
    if (!course.data) return notFound("Course not found");

    const uniqueEmployeeIds = Array.from(new Set(parsedBody.data.employeeIds));
    const employeeResult = await supabase
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .in("id", uniqueEmployeeIds);

    if (employeeResult.error) return serverError(employeeResult.error.message);

    const validIds = new Set((employeeResult.data ?? []).map((row) => String(row.id)));
    if (validIds.size !== uniqueEmployeeIds.length) {
      return validationError([{ path: "employeeIds", message: "One or more employees are invalid" }]);
    }

    const dueDate = parsedBody.data.dueDate ? String(parsedBody.data.dueDate).slice(0, 10) : null;
    const upsertRows = uniqueEmployeeIds.map((employeeId) => ({
      company_id: companyId,
      course_id: courseId,
      employee_id: employeeId,
      assigned_by: userId,
      assigned_at: new Date().toISOString(),
      due_date: dueDate,
      required: parsedBody.data.required,
    }));

    const assignmentUpsert = await supabase
      .from("training_assignments")
      .upsert(upsertRows, { onConflict: "company_id,course_id,employee_id" })
      .select("course_id, employee_id, due_date, required, assigned_at");

    if (assignmentUpsert.error) return serverError(assignmentUpsert.error.message);

    return okItem({
      courseId,
      assignedEmployeeIds: uniqueEmployeeIds,
      dueDate,
      required: parsedBody.data.required,
      assignedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
