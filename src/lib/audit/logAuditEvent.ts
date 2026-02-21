/* eslint-disable @typescript-eslint/no-explicit-any */
import { pushFallbackAuditLog } from "@/lib/audit/fallbackStore";

type AuditPayload = {
  supabase: any;
  companyId: string;
  actorUserId: string;
  eventType: string;
  entityType?: string | null;
  entityId?: string | number | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

function asJson(value: Record<string, unknown> | null | undefined) {
  if (!value) return {};
  return value;
}

export async function logAuditEvent(payload: AuditPayload): Promise<void> {
  const {
    supabase,
    companyId,
    actorUserId,
    eventType,
    entityType = null,
    entityId = null,
    before = null,
    after = null,
    metadata = null,
  } = payload;

  if (!supabase || !companyId || !actorUserId || !eventType) {
    return;
  }

  const insertPayload: Record<string, unknown> = {
    company_id: companyId,
    actor_user_id: actorUserId,
    action: eventType,
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId === null || entityId === undefined ? null : String(entityId),
    before_data: asJson(before),
    after_data: asJson(after),
    metadata: asJson(metadata),
  };

  const currentPayload = { ...insertPayload };
  const fallbackPayload = {
    company_id: companyId,
    actor_user_id: actorUserId,
    action: eventType,
    event_type: eventType,
    entity_type: entityType,
    entity_id: entityId === null || entityId === undefined ? null : String(entityId),
    before_data: asJson(before),
    after_data: asJson(after),
    metadata: asJson(metadata),
  };
  for (let i = 0; i < 20; i += 1) {
    const result = await supabase.from("audit_logs").insert(currentPayload);
    if (!result.error) {
      return;
    }

    const message = result.error.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) {
      if (
        message.toLowerCase().includes("audit_logs") &&
        (message.toLowerCase().includes("does not exist") ||
          message.toLowerCase().includes("not find"))
      ) {
        pushFallbackAuditLog(fallbackPayload);
      }
      return;
    }
    const missingColumn = match[1];
    if (!(missingColumn in currentPayload)) {
      return;
    }
    delete currentPayload[missingColumn];
  }

  pushFallbackAuditLog(fallbackPayload);
}
