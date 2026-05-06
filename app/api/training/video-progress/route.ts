import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { forbidden, notFound, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";

export const dynamic = "force-dynamic";

const segmentSchema = z
  .object({
    start: z.coerce.number().finite().nonnegative(),
    end: z.coerce.number().finite().nonnegative(),
  })
  .refine((value) => value.end > value.start, { message: "Segment end must be after start" });

const progressSchema = z.object({
  courseId: z.string().uuid(),
  watchedSegments: z.array(segmentSchema).max(200).default([]),
  durationSeconds: z.coerce.number().finite().nonnegative().default(0),
  lastPositionSeconds: z.coerce.number().finite().nonnegative().default(0),
});

type Segment = { start: number; end: number };

function toTenantErrorResponse(error: TenantResolverError) {
  if (error.status === 404) return notFound(error.message);
  if (error.status === 403) return forbidden(error.message);
  return serverError(error.message);
}

function clampSegment(segment: Segment, durationSeconds: number): Segment | null {
  const max = durationSeconds > 0 ? durationSeconds : Number.MAX_SAFE_INTEGER;
  const start = Math.max(0, Math.min(max, segment.start));
  const end = Math.max(0, Math.min(max, segment.end));
  if (end - start < 0.25) return null;
  return { start, end };
}

function mergeSegments(input: Segment[], durationSeconds: number): Segment[] {
  const sorted = input
    .map((segment) => clampSegment(segment, durationSeconds))
    .filter(Boolean)
    .sort((a, b) => a!.start - b!.start) as Segment[];
  const merged: Segment[] = [];
  for (const segment of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || segment.start > previous.end + 0.5) {
      merged.push({ start: segment.start, end: segment.end });
    } else {
      previous.end = Math.max(previous.end, segment.end);
    }
  }
  return merged.map((segment) => ({
    start: Math.round(segment.start * 10) / 10,
    end: Math.round(segment.end * 10) / 10,
  }));
}

function watchedSeconds(segments: Segment[]) {
  return segments.reduce((sum, segment) => sum + Math.max(0, segment.end - segment.start), 0);
}

export async function GET(request: Request) {
  try {
    const courseId = new URL(request.url).searchParams.get("courseId") || "";
    const parsed = z.string().uuid().safeParse(courseId);
    if (!parsed.success) return validationError([{ path: "courseId", message: "Invalid courseId" }]);

    const { supabase, companyId, userId } = await getCompanyId();
    const result = await supabase
      .from("training_video_progress")
      .select("*")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("training_video_id", parsed.data)
      .maybeSingle();

    if (result.error) return serverError(result.error.message);

    return okItem({
      courseId: parsed.data,
      watchedSegments: result.data?.watched_segments ?? [],
      watchedSeconds: Number(result.data?.watched_seconds ?? 0),
      durationSeconds: Number(result.data?.duration_seconds ?? 0),
      completionPercent: Number(result.data?.completion_percent ?? 0),
      lastPositionSeconds: Number(result.data?.last_position_seconds ?? 0),
      completedAt: result.data?.completed_at ?? null,
      completed: Boolean(result.data?.completed_at),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}

export async function POST(request: Request) {
  try {
    const parsed = progressSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationError(parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })));
    }

    const { supabase, companyId, userId } = await getCompanyId();
    const courseResult = await supabase
      .from("training_courses")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", parsed.data.courseId)
      .maybeSingle();
    if (courseResult.error) return serverError(courseResult.error.message);
    if (!courseResult.data) return notFound("Course not found");

    const profileResult = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .maybeSingle();
    if (profileResult.error) return serverError(profileResult.error.message);
    const employeeResult = await supabase
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .or(`user_id.eq.${userId},email.eq.${String(profileResult.data?.email ?? "").trim().toLowerCase()}`)
      .limit(1);
    if (employeeResult.error) return serverError(employeeResult.error.message);
    const employeeId = employeeResult.data?.[0]?.id ?? null;

    const existingResult = await supabase
      .from("training_video_progress")
      .select("watched_segments")
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("training_video_id", parsed.data.courseId)
      .maybeSingle();
    if (existingResult.error) return serverError(existingResult.error.message);

    const existingSegments = Array.isArray(existingResult.data?.watched_segments)
      ? (existingResult.data?.watched_segments as Segment[])
      : [];
    const durationSeconds = Math.max(0, parsed.data.durationSeconds);
    const mergedSegments = mergeSegments([...existingSegments, ...parsed.data.watchedSegments], durationSeconds);
    const uniqueWatchedSeconds = Math.round(watchedSeconds(mergedSegments) * 10) / 10;
    const completionPercent =
      durationSeconds > 0 ? Math.min(100, Math.round((uniqueWatchedSeconds / durationSeconds) * 1000) / 10) : 0;
    const completedAt = completionPercent >= 75 ? new Date().toISOString() : null;
    const lastPositionSeconds = durationSeconds > 0
      ? Math.min(durationSeconds, Math.max(0, parsed.data.lastPositionSeconds))
      : Math.max(0, parsed.data.lastPositionSeconds);

    const upsertResult = await supabase
      .from("training_video_progress")
      .upsert(
        {
          company_id: companyId,
          user_id: userId,
          training_video_id: parsed.data.courseId,
          watched_segments: mergedSegments,
          watched_seconds: uniqueWatchedSeconds,
          duration_seconds: durationSeconds,
          completion_percent: completionPercent,
          last_position_seconds: lastPositionSeconds,
          completed_at: completedAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,user_id,training_video_id" }
      )
      .select("*")
      .single();

    if (upsertResult.error || !upsertResult.data) return serverError(upsertResult.error?.message);

    if (employeeId && completedAt) {
      const completionResult = await supabase
        .from("training_progress")
        .upsert(
          {
            company_id: companyId,
            course_id: parsed.data.courseId,
            employee_id: employeeId,
            completed_at: completedAt,
            completed_by: userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id,course_id,employee_id" }
        );
      if (completionResult.error) return serverError(completionResult.error.message);
    }

    return okItem({
      courseId: upsertResult.data.training_video_id,
      watchedSegments: upsertResult.data.watched_segments ?? [],
      watchedSeconds: Number(upsertResult.data.watched_seconds ?? 0),
      durationSeconds: Number(upsertResult.data.duration_seconds ?? 0),
      completionPercent: Number(upsertResult.data.completion_percent ?? 0),
      lastPositionSeconds: Number(upsertResult.data.last_position_seconds ?? 0),
      completedAt: upsertResult.data.completed_at,
      completed: Boolean(upsertResult.data.completed_at),
    });
  } catch (error) {
    if (error instanceof TenantResolverError) return toTenantErrorResponse(error);
    return serverError();
  }
}
