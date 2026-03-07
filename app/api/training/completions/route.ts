import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItems } from "@/lib/http/json";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  courseId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
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

export async function GET(request: Request) {
  try {
    const parsedQuery = querySchema.safeParse({
      courseId: new URL(request.url).searchParams.get("courseId") ?? undefined,
      employeeId: new URL(request.url).searchParams.get("employeeId") ?? undefined,
    });

    if (!parsedQuery.success) {
      return validationError(toValidationDetails(parsedQuery.error));
    }

    const { supabase, companyId } = await getCompanyId();
    let query = supabase
      .from("training_progress")
      .select("id, course_id, employee_id, completed_at, completed_by, created_at, updated_at")
      .eq("company_id", companyId)
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false });

    if (parsedQuery.data.courseId) {
      query = query.eq("course_id", parsedQuery.data.courseId);
    }
    if (parsedQuery.data.employeeId) {
      query = query.eq("employee_id", parsedQuery.data.employeeId);
    }

    const result = await query;
    if (result.error) return serverError(result.error.message);

    const employeeIds = Array.from(new Set((result.data ?? []).map((row) => String(row.employee_id))));
    const employeesResult = employeeIds.length
      ? await supabase.from("employees").select("id, name").eq("company_id", companyId).in("id", employeeIds)
      : { data: [], error: null };

    if (employeesResult.error) return serverError(employeesResult.error.message);

    const employeeNameById = new Map((employeesResult.data ?? []).map((row) => [String(row.id), String(row.name ?? "")])) ;

    return okItems(
      (result.data ?? []).map((row) => ({
        id: row.id,
        courseId: row.course_id,
        employeeId: row.employee_id,
        employeeName: employeeNameById.get(String(row.employee_id)) || "",
        completedAt: row.completed_at,
        completedBy: row.completed_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
    );
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
