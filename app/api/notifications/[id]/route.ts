import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { deleteFallbackNotification } from "@/lib/notifications/fallbackStore";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  id: z.string().uuid(),
});

function isMissingNotificationsTable(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("notifications") && (normalized.includes("does not exist") || normalized.includes("not find"));
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const parsedParams = paramsSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsedParams.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const { supabase, companyId, userId } = await getCompanyId();

    const result = await supabase
      .from("notifications")
      .delete()
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("id", parsedParams.data.id)
      .select("id")
      .maybeSingle();

    if (result.error) {
      if (isMissingNotificationsTable(result.error.message)) {
        const deleted = deleteFallbackNotification({
          companyId,
          userId,
          notificationId: parsedParams.data.id,
          companyWide: false,
        });
        if (!deleted) {
          return NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return NextResponse.json({ item: { id: parsedParams.data.id, deleted: true } });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    if (!result.data?.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ item: { id: String(result.data.id), deleted: true } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
