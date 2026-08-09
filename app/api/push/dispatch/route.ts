import { z } from "zod";
import { forbidden, serverError, validationError } from "@/lib/http/errors";
import { okItem } from "@/lib/http/json";
import { isAuthorizedPushDispatchRequest } from "@/lib/push/security";
import { processPushNotificationJobs } from "@/lib/push/worker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(20),
});

export async function POST(request: Request) {
  if (!isAuthorizedPushDispatchRequest(request, process.env.PUSH_DISPATCH_SECRET)) {
    return forbidden();
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return validationError(
      parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))
    );
  }

  const db = getSupabaseAdmin();
  if (!db) return serverError("Push dispatcher is unavailable");

  try {
    const result = await processPushNotificationJobs({ db, limit: parsed.data.limit });
    return okItem(result);
  } catch (error) {
    return serverError(error instanceof Error ? error.message : "Push dispatcher failed");
  }
}
