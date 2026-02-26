import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem, okSuccess } from "@/lib/http/json";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const updateCourseSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(120).optional(),
  durationMinutes: z.coerce.number().int().min(0).max(24 * 60).optional(),
  videoUrl: z.string().trim().url().optional().or(z.literal("")),
  thumbnailUrl: z.string().trim().url().optional().or(z.literal("")),
  required: z.boolean().optional(),
  dueDate: z.string().trim().optional().nullable(),
  notes: z.string().trim().max(2000).optional(),
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

export async function PATCH(
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

    const parsedBody = updateCourseSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationError(toValidationDetails(parsedBody.error));
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const body = parsedBody.data;
    if (body.title !== undefined) updates.title = body.title;
    if (body.category !== undefined) updates.category = body.category;
    if (body.durationMinutes !== undefined) updates.duration_minutes = body.durationMinutes;
    if (body.videoUrl !== undefined) updates.video_url = body.videoUrl || null;
    if (body.thumbnailUrl !== undefined || body.videoUrl !== undefined) {
      const sourceVideoUrl = String(
        body.videoUrl !== undefined ? body.videoUrl : ""
      );
      const sourceThumbnail = String(body.thumbnailUrl !== undefined ? body.thumbnailUrl : "");
      updates.thumbnail_url = deriveThumbnailUrl(sourceVideoUrl, sourceThumbnail);
    }
    if (body.required !== undefined) updates.required = body.required;
    if (body.dueDate !== undefined) updates.due_date = body.dueDate ? String(body.dueDate).slice(0, 10) : null;
    if (body.notes !== undefined) updates.notes = body.notes || null;

    const { supabase, companyId } = await getCompanyId();
    const { data, error } = await supabase
      .from("training_courses")
      .update(updates)
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id)
      .select("id, title, category, duration_minutes, video_url, thumbnail_url, required, due_date, notes, created_at, updated_at")
      .single();

    if (error) {
      if (error.code === "PGRST116") return notFound("Course not found");
      return serverError(error.message);
    }

    if (!data) return notFound("Course not found");

    return okItem({
      id: data.id,
      title: data.title,
      category: data.category,
      durationMinutes: Number(data.duration_minutes ?? 0),
      videoUrl: data.video_url || "",
      thumbnailUrl: data.thumbnail_url || "",
      required: Boolean(data.required),
      dueDate: data.due_date,
      notes: data.notes || "",
      assignedEmployeeIds: [],
      completedEmployeeIds: [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}

export async function DELETE(
  _request: Request,
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

    const { supabase, companyId } = await getCompanyId();
    const { error } = await supabase
      .from("training_courses")
      .delete()
      .eq("company_id", companyId)
      .eq("id", parsedParams.data.id);

    if (error) return serverError(error.message);

    return okSuccess();
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
