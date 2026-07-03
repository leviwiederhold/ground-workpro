import { NextResponse } from "next/server";
import { z } from "zod";
import { getPlatformAdmin, PlatformAdminError } from "@/lib/auth/platformAdmin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ADMIN_OVERRIDE_SELECT_COLUMNS, mapCompanyOverride } from "@/lib/billing/adminOverrideMap";

export const dynamic = "force-dynamic";

const SELECT_COLUMNS = ADMIN_OVERRIDE_SELECT_COLUMNS;

// Body for setting an override. Value semantics depend on type:
//   percent_discount -> value = percent 1..100
//   fixed_discount   -> value = amount in cents (> 0)
//   free_until       -> until = ISO timestamp in the future
//   free_lifetime    -> no value/until
//   none             -> clears the override
const setOverrideSchema = z
  .object({
    type: z.enum(["none", "free_lifetime", "free_until", "percent_discount", "fixed_discount"]),
    value: z.number().finite().nullable().optional(),
    until: z.string().datetime({ offset: true }).nullable().optional(),
    reason: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.type === "free_until") {
      if (!data.until) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "free_until requires an 'until' date", path: ["until"] });
      } else if (Date.parse(data.until) <= Date.now()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "'until' must be in the future", path: ["until"] });
      }
    }
    if (data.type === "percent_discount") {
      if (data.value == null || data.value <= 0 || data.value > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "percent_discount value must be 1–100", path: ["value"] });
      }
    }
    if (data.type === "fixed_discount") {
      if (data.value == null || data.value <= 0 || !Number.isInteger(data.value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "fixed_discount value must be a positive integer (cents)", path: ["value"] });
      }
    }
  });

async function requireAdmin() {
  return getPlatformAdmin();
}

function forbiddenResponse(error: unknown) {
  const status = error instanceof PlatformAdminError ? error.status : 403;
  return NextResponse.json({ error: status === 401 ? "Not authenticated" : "Forbidden" }, { status });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    await requireAdmin();
  } catch (error) {
    return forbiddenResponse(error);
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Admin client unavailable" }, { status: 500 });

  const { companyId } = await params;
  const result = await admin.from("companies").select(SELECT_COLUMNS).eq("id", companyId).maybeSingle();
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  if (!result.data) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  return NextResponse.json({ item: mapCompanyOverride(result.data) });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  let adminCtx;
  try {
    adminCtx = await requireAdmin();
  } catch (error) {
    return forbiddenResponse(error);
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Admin client unavailable" }, { status: 500 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = setOverrideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid override", details: parsed.error.flatten() }, { status: 400 });
  }

  const { companyId } = await params;
  const existing = await admin.from("companies").select(SELECT_COLUMNS).eq("id", companyId).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 400 });
  if (!existing.data) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const now = new Date().toISOString();
  const data = parsed.data;

  // Normalize value/until per type so we never persist inconsistent metadata.
  const value =
    data.type === "percent_discount" || data.type === "fixed_discount" ? data.value ?? null : null;
  const until = data.type === "free_until" ? data.until ?? null : null;

  const updatePayload: Record<string, unknown> = {
    billing_override_type: data.type,
    billing_override_value: value,
    billing_override_until: until,
    billing_override_reason: data.type === "none" ? null : data.reason ?? null,
    billing_override_updated_at: now,
  };
  // Preserve original authorship; only set created_* when first establishing one.
  const previouslyNone = String(existing.data.billing_override_type ?? "none") === "none";
  if (data.type !== "none" && previouslyNone) {
    updatePayload.billing_override_created_by = adminCtx.userId;
    updatePayload.billing_override_created_at = now;
  }
  if (data.type === "none") {
    updatePayload.billing_override_created_by = null;
    updatePayload.billing_override_created_at = null;
  }

  const updated = await admin
    .from("companies")
    .update(updatePayload)
    .eq("id", companyId)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 400 });
  if (!updated.data) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  await writeAudit(admin, {
    companyId,
    actorUserId: adminCtx.userId,
    actorEmail: adminCtx.email,
    action: data.type === "none" ? "remove" : "set",
    reason: data.reason ?? null,
    previous: overrideSnapshot(existing.data),
    next: overrideSnapshot(updated.data),
  });

  return NextResponse.json({ item: mapCompanyOverride(updated.data) });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  let adminCtx;
  try {
    adminCtx = await requireAdmin();
  } catch (error) {
    return forbiddenResponse(error);
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Admin client unavailable" }, { status: 500 });

  const { companyId } = await params;
  const existing = await admin.from("companies").select(SELECT_COLUMNS).eq("id", companyId).maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 400 });
  if (!existing.data) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  const updated = await admin
    .from("companies")
    .update({
      billing_override_type: "none",
      billing_override_value: null,
      billing_override_until: null,
      billing_override_reason: null,
      billing_override_created_by: null,
      billing_override_created_at: null,
      billing_override_updated_at: new Date().toISOString(),
    })
    .eq("id", companyId)
    .select(SELECT_COLUMNS)
    .maybeSingle();
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 400 });
  if (!updated.data) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  await writeAudit(admin, {
    companyId,
    actorUserId: adminCtx.userId,
    actorEmail: adminCtx.email,
    action: "remove",
    reason: null,
    previous: overrideSnapshot(existing.data),
    next: overrideSnapshot(updated.data),
  });

  return NextResponse.json({ item: mapCompanyOverride(updated.data) });
}

function overrideSnapshot(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    type: row.billing_override_type ?? "none",
    value: row.billing_override_value ?? null,
    until: row.billing_override_until ?? null,
    reason: row.billing_override_reason ?? null,
  };
}

async function writeAudit(
  admin: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  entry: {
    companyId: string;
    actorUserId: string;
    actorEmail: string;
    action: string;
    reason: string | null;
    previous: unknown;
    next: unknown;
  }
) {
  // Non-blocking: an audit failure must not break the override write, but log it.
  const result = await admin.from("billing_override_audit").insert({
    company_id: entry.companyId,
    actor_user_id: entry.actorUserId,
    actor_email: entry.actorEmail,
    action: entry.action,
    reason: entry.reason,
    previous: entry.previous,
    next: entry.next,
  });
  if (result.error) {
    console.warn("[billing-overrides] audit write failed", result.error.message);
  }
}
