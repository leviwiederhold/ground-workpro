import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getEffectiveRole } from "@/lib/auth/effectiveRole";
import { formatNotification } from "@/lib/notifications/format";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

type ActivityItem = {
  id: string;
  source: "notification" | "audit";
  type: string;
  notification_type: string;
  title: string;
  message: string;
  href: string | null;
  actorName: string | null;
  is_read: boolean;
  read_at: string | null;
  payload: Record<string, unknown>;
  createdAt: string | null;
  created_at: string | null;
};

function deriveAuditHref(entityType: string, entityId: string | null, action: string, metadata: Record<string, unknown> | null) {
  const normalizedEntity = String(entityType ?? "").toLowerCase();
  const normalizedAction = String(action ?? "").toLowerCase();
  if (normalizedEntity === "job" && entityId) return `/jobs/${entityId}`;
  if (normalizedEntity === "bid" && entityId) return `/bids`;
  if (normalizedEntity === "safety_log") return "/safety";
  if (normalizedEntity === "pricing_settings") return "/finance";
  if (normalizedEntity === "integration_connection") return "/integrations";
  if (normalizedAction.includes("purchase_order")) return "/vendors";
  if (normalizedAction.includes("work_order")) return "/maintenance";
  const metaHref = typeof (metadata ?? {}).href === "string" ? String((metadata ?? {}).href) : null;
  if (metaHref) return metaHref;
  return null;
}

function formatAuditMessage(action: string, entityType: string, entityId: string | null) {
  const normalized = String(action ?? "").replaceAll(".", " ");
  const entity = String(entityType ?? "entity").replaceAll("_", " ");
  if (entityId) {
    return `${normalized} ${entity} #${entityId}`;
  }
  return `${normalized} ${entity}`.trim();
}

function isMissingTable(message: string, table: string) {
  const normalized = message.toLowerCase();
  return normalized.includes(table) && (normalized.includes("does not exist") || normalized.includes("not find"));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ limit: url.searchParams.get("limit") ?? undefined });
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsed.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const limit = parsed.data.limit;
    const { supabase, companyId, userId } = await getCompanyId();
    const role = await getEffectiveRole();
    if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const companyWide = role === "admin" || role === "pm";

    let notificationsQuery = supabase
      .from("notifications")
      .select("id, user_id, type, payload, read_at, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!companyWide) {
      notificationsQuery = notificationsQuery.eq("user_id", userId);
    }

    let auditQuery = supabase
      .from("audit_logs")
      .select("id, actor_user_id, action, entity_type, entity_id, metadata, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!companyWide) {
      auditQuery = auditQuery.eq("actor_user_id", userId);
    }

    const [notificationsResult, auditResult] = await Promise.all([notificationsQuery, auditQuery]);

    const items: ActivityItem[] = [];
    const employeeNameByUserId = new Map<string, string>();
    const actorUserIds = new Set<string>();
    for (const row of notificationsResult.data ?? []) {
      const id = String((row as { user_id?: string }).user_id ?? "").trim();
      if (id) actorUserIds.add(id);
    }
    for (const row of auditResult.data ?? []) {
      const id = String((row as { actor_user_id?: string }).actor_user_id ?? "").trim();
      if (id) actorUserIds.add(id);
    }
    if (actorUserIds.size > 0) {
      const namesResult = await supabase
        .from("employees")
        .select("user_id, name, full_name")
        .eq("company_id", companyId)
        .in("user_id", Array.from(actorUserIds));
      if (!namesResult.error) {
        for (const row of namesResult.data ?? []) {
          const userIdKey = String((row as { user_id?: string }).user_id ?? "").trim();
          const name = String((row as { name?: string; full_name?: string }).name ?? (row as { name?: string; full_name?: string }).full_name ?? "").trim();
          if (userIdKey && name) employeeNameByUserId.set(userIdKey, name);
        }
      }
    }
    if (!notificationsResult.error) {
      for (const row of notificationsResult.data ?? []) {
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const formatted = formatNotification(row.type as never, payload);
        const actorUserId = String((row as { user_id?: string }).user_id ?? "").trim();
        items.push({
          id: `n:${row.id}`,
          source: "notification",
          type: String(row.type ?? "notification"),
          notification_type: String(row.type ?? "notification"),
          title: formatted.title,
          message: formatted.message,
          href: typeof payload.href === "string" ? payload.href : null,
          actorName: employeeNameByUserId.get(actorUserId) ?? (companyWide ? "Team member" : null),
          is_read: Boolean((row as { read_at?: string | null }).read_at),
          read_at: (row as { read_at?: string | null }).read_at ?? null,
          payload,
          createdAt: String(row.created_at ?? null),
          created_at: String(row.created_at ?? null),
        });
      }
    } else if (!isMissingTable(notificationsResult.error.message ?? "", "notifications")) {
      return NextResponse.json({ error: notificationsResult.error.message }, { status: 400 });
    }

    if (!auditResult.error) {
      for (const row of auditResult.data ?? []) {
        const actorUserId = String((row as { actor_user_id?: string }).actor_user_id ?? "").trim();
        items.push({
          id: `a:${row.id}`,
          source: "audit",
          type: String(row.action ?? "audit"),
          notification_type: String(row.action ?? "audit"),
          title: "Audit Event",
          message: formatAuditMessage(
            String(row.action ?? "event"),
            String(row.entity_type ?? "entity"),
            row.entity_id == null ? null : String(row.entity_id)
          ),
          href: deriveAuditHref(
            String(row.entity_type ?? ""),
            row.entity_id == null ? null : String(row.entity_id),
            String(row.action ?? ""),
            (row as { metadata?: Record<string, unknown> | null }).metadata ?? null
          ),
          actorName: employeeNameByUserId.get(actorUserId) ?? (companyWide ? "Team member" : null),
          is_read: true,
          read_at: String(row.created_at ?? null),
          payload: {},
          createdAt: String(row.created_at ?? null),
          created_at: String(row.created_at ?? null),
        });
      }
    } else if (!isMissingTable(auditResult.error.message ?? "", "audit_logs")) {
      return NextResponse.json({ error: auditResult.error.message }, { status: 400 });
    }

    items.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
    return NextResponse.json({ items: items.slice(0, limit) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
