import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError } from "@/lib/http/errors";
import { okItems } from "@/lib/http/json";

export const dynamic = "force-dynamic";

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

export async function GET() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();

    const membershipResult = await supabase
      .from("memberships")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipResult.error || !membershipResult.data) {
      return forbidden();
    }

    const profileResult = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    if (profileResult.error) return serverError(profileResult.error.message);

    const employeeResult = profileResult.data?.email
      ? await supabase
          .from("employees")
          .select("id")
          .eq("company_id", companyId)
          .eq("email", String(profileResult.data.email))
          .limit(1)
      : { data: [], error: null };
    if (employeeResult.error) return serverError(employeeResult.error.message);

    const employeeId = employeeResult.data?.[0]?.id;
    if (!employeeId) {
      return okItems([]);
    }

    const rows = await supabase
      .from("training_assignments")
      .select(
        "course_id, due_date, required, assigned_at, training_courses!inner(id, title, category, duration_minutes, video_url, thumbnail_url), training_progress(completed_at)"
      )
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("assigned_at", { ascending: false });

    if (rows.error) return serverError(rows.error.message);

    const items = (rows.data ?? []).map((row) => {
      const data = row as {
        course_id: string;
        due_date: string | null;
        required: boolean | null;
        assigned_at: string;
        training_courses?: {
          title?: string | null;
          category?: string | null;
          duration_minutes?: number | null;
          video_url?: string | null;
          thumbnail_url?: string | null;
        } | null;
        training_progress?: Array<{ completed_at?: string | null }> | null;
      };
      return {
        courseId: data.course_id,
        title: data.training_courses?.title ?? "",
        category: data.training_courses?.category ?? "",
        durationMinutes: Number(data.training_courses?.duration_minutes ?? 0),
        videoUrl: data.training_courses?.video_url ?? "",
        thumbnailUrl: data.training_courses?.thumbnail_url ?? "",
        dueDate: data.due_date,
        required: Boolean(data.required),
        assignedAt: data.assigned_at,
        completedAt: data.training_progress?.[0]?.completed_at ?? null,
        completed: Boolean(data.training_progress?.[0]?.completed_at),
      };
    });

    return okItems(items);
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
