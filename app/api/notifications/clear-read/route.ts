import { NextResponse } from "next/server";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { clearFallbackReadNotifications } from "@/lib/notifications/fallbackStore";

export const dynamic = "force-dynamic";

function isMissingNotificationsTable(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("notifications") &&
    (normalized.includes("does not exist") || normalized.includes("not find"))
  );
}

function isMissingNotificationsColumns(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("column") && (normalized.includes("is_read") || normalized.includes("read_at"));
}

export async function POST() {
  try {
    const { supabase, companyId, userId } = await getCompanyId();

    const result = await supabase
      .from("notifications")
      .delete()
      .eq("company_id", companyId)
      .eq("user_id", userId)
      .eq("is_read", true)
      .select("id");

    if (result.error && isMissingNotificationsColumns(result.error.message || "")) {
      const legacy = await supabase
        .from("notifications")
        .delete()
        .eq("company_id", companyId)
        .eq("user_id", userId)
        .not("read_at", "is", null)
        .select("id");
      if (!legacy.error) {
        const fallbackDeleted = clearFallbackReadNotifications({
          companyId,
          userId,
          companyWide: false,
        });
        return NextResponse.json({ item: { deleted: (legacy.data ?? []).length + fallbackDeleted } });
      }
    }

    if (result.error) {
      if (isMissingNotificationsTable(result.error.message)) {
        const fallbackDeleted = clearFallbackReadNotifications({
          companyId,
          userId,
          companyWide: false,
        });
        return NextResponse.json({ item: { deleted: fallbackDeleted } });
      }
      return NextResponse.json({ error: result.error.message }, { status: 400 });
    }

    const fallbackDeleted = clearFallbackReadNotifications({
      companyId,
      userId,
      companyWide: false,
    });

    return NextResponse.json({ item: { deleted: (result.data ?? []).length + fallbackDeleted } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
