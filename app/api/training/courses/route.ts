import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem, okItems } from "@/lib/http/json";

export const dynamic = "force-dynamic";

const createCourseSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(120),
  durationMinutes: z.coerce.number().int().min(0).max(24 * 60),
  videoUrl: z.string().trim().url().optional().or(z.literal("")),
  thumbnailUrl: z.string().trim().url().optional().or(z.literal("")),
  required: z.boolean().optional().default(false),
  dueDate: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(2000).optional().default(""),
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

function isMissingTableError(message: string, table: string) {
  const normalized = String(message || "").toLowerCase();
  const tableName = table.toLowerCase();
  return normalized.includes(tableName) && (normalized.includes("does not exist") || normalized.includes("schema cache"));
}

function extractYouTubeVideoId(value: string): string | null {
  const input = String(value || "").trim();
  if (!input) return null;
  try {
    const url = new URL(input);
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }
      if (url.pathname.startsWith("/embed/")) {
        return url.pathname.replace("/embed/", "").split("/")[0] || null;
      }
      if (url.pathname.startsWith("/shorts/")) {
        return url.pathname.replace("/shorts/", "").split("/")[0] || null;
      }
    }
    if (url.hostname === "youtu.be") {
      return url.pathname.replace("/", "").split("/")[0] || null;
    }
  } catch {
    return null;
  }
  return null;
}

function deriveThumbnailUrl(videoUrl: string, explicitThumbnailUrl: string): string | null {
  if (String(explicitThumbnailUrl || "").trim()) return explicitThumbnailUrl.trim();
  const videoId = extractYouTubeVideoId(videoUrl);
  if (!videoId) return null;
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

type CourseRow = {
  id: string;
  title: string;
  category: string;
  duration_minutes: number | null;
  video_url: string | null;
  thumbnail_url: string | null;
  required: boolean | null;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function normalizeCourse(
  row: CourseRow,
  assignedEmployeeIds: string[],
  completedEmployeeIds: string[]
) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    durationMinutes: Number(row.duration_minutes ?? 0),
    videoUrl: row.video_url || "",
    thumbnailUrl: row.thumbnail_url || "",
    required: Boolean(row.required),
    dueDate: row.due_date,
    notes: row.notes || "",
    assignedEmployeeIds,
    completedEmployeeIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  try {
    const { supabase, companyId } = await getCompanyId();

    const { data: courses, error: coursesError } = await supabase
      .from("training_courses")
      .select("id, title, category, duration_minutes, video_url, thumbnail_url, required, due_date, notes, created_at, updated_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });

    if (coursesError && isMissingTableError(coursesError.message, "training_courses")) {
      return okItems([]);
    }
    if (coursesError) {
      return serverError(coursesError.message);
    }

    const courseIds = (courses ?? []).map((course) => String(course.id));
    if (courseIds.length === 0) {
      return okItems([]);
    }

    const [assignmentsResult, progressResult] = await Promise.all([
      supabase
        .from("training_assignments")
        .select("course_id, employee_id")
        .eq("company_id", companyId)
        .in("course_id", courseIds),
      supabase
        .from("training_progress")
        .select("course_id, employee_id")
        .eq("company_id", companyId)
        .in("course_id", courseIds)
        .not("completed_at", "is", null),
    ]);

    if (assignmentsResult.error && !isMissingTableError(assignmentsResult.error.message, "training_assignments")) {
      return serverError(assignmentsResult.error.message);
    }
    if (progressResult.error && !isMissingTableError(progressResult.error.message, "training_progress")) {
      return serverError(progressResult.error.message);
    }

    const assignedByCourse = new Map<string, string[]>();
    for (const row of assignmentsResult.data ?? []) {
      const courseId = String(row.course_id);
      const current = assignedByCourse.get(courseId) ?? [];
      current.push(String(row.employee_id));
      assignedByCourse.set(courseId, current);
    }

    const completedByCourse = new Map<string, string[]>();
    for (const row of progressResult.data ?? []) {
      const courseId = String(row.course_id);
      const current = completedByCourse.get(courseId) ?? [];
      current.push(String(row.employee_id));
      completedByCourse.set(courseId, current);
    }

    const items = (courses as CourseRow[]).map((course) =>
      normalizeCourse(
        course,
        Array.from(new Set(assignedByCourse.get(String(course.id)) ?? [])),
        Array.from(new Set(completedByCourse.get(String(course.id)) ?? []))
      )
    );

    return okItems(items);
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
      await requireRole(["admin", "pm"]);
    } catch {
      return forbidden();
    }

    const parsedBody = createCourseSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const { supabase, companyId, userId } = await getCompanyId();

    const dueDate = parsedBody.data.dueDate ? String(parsedBody.data.dueDate).slice(0, 10) : null;

    const thumbnailUrl = deriveThumbnailUrl(parsedBody.data.videoUrl || "", parsedBody.data.thumbnailUrl || "");

    const { data, error } = await supabase
      .from("training_courses")
      .insert({
        company_id: companyId,
        title: parsedBody.data.title,
        category: parsedBody.data.category,
        duration_minutes: parsedBody.data.durationMinutes,
        video_url: parsedBody.data.videoUrl || null,
        thumbnail_url: thumbnailUrl,
        required: parsedBody.data.required,
        due_date: dueDate,
        notes: parsedBody.data.notes || null,
        created_by: userId,
      })
      .select("id, title, category, duration_minutes, video_url, thumbnail_url, required, due_date, notes, created_at, updated_at")
      .single();

    if (error || !data) {
      return serverError(error?.message);
    }

    return okItem(normalizeCourse(data as CourseRow, [], []), 201);
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return toTenantErrorResponse(error);
    }
    return serverError();
  }
}
