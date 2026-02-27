/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { z } from "next/dist/compiled/zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { requireRole } from "@/lib/auth/requireRole";

const vendorStatusSchema = z.enum(["active", "preferred", "on_hold", "inactive", "blocked"]);
const VENDOR_STATUS_TAG_REGEX = /__gw_vendor_status:(preferred|on_hold|blocked)__/i;
const VENDOR_META_TAG_REGEX = /^__gw_vendor_meta:([^\n]+)__\n?/i;

const updateVendorSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: vendorStatusSchema.optional(),
    category: z.string().optional(),
    contact_name: z.string().optional(),
    contact: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    payment_terms: z.string().optional(),
    rating: z.coerce.number().optional(),
    active_orders: z.coerce.number().optional(),
    activeOrders: z.coerce.number().optional(),
    notes: z.string().optional(),
  })
  .refine((value: any) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

const normalizeRouteId = (id: string) => (/^\d+$/.test(id) ? Number(id) : id);

const normalizeNumber = (value: unknown, fallback = 0) => {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeStatusForDb = (value: unknown) => {
  if (!value) return undefined;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return undefined;
  return raw.replace(/[\s-]+/g, "_");
};

const getStatusFallbacks = (value: unknown) => {
  const normalized = normalizeStatusForDb(value);
  if (!normalized) return [];
  const candidates = [normalized];
  if (normalized === "preferred") candidates.push("active");
  if (normalized === "on_hold" || normalized === "blocked") candidates.push("inactive");
  if (!candidates.includes("active")) candidates.push("active");
  return candidates;
};

const parseVendorMeta = (notes: unknown) => {
  const text = String(notes ?? "");
  const line = text.match(VENDOR_META_TAG_REGEX)?.[1];
  if (!line) return {};
  const params = new URLSearchParams(line);
  return {
    category: params.get("category") ?? "",
    payment_terms: params.get("payment_terms") ?? "",
    rating: params.get("rating"),
    active_orders: params.get("active_orders"),
  };
};

const stripSystemTags = (notes: unknown) =>
  String(notes ?? "")
    .replace(VENDOR_STATUS_TAG_REGEX, "")
    .replace(VENDOR_META_TAG_REGEX, "")
    .trimStart();

const getDisplayStatus = (row: any) => {
  const tagged = String(row.notes ?? "").match(VENDOR_STATUS_TAG_REGEX)?.[1];
  if (tagged) return tagged;
  const normalized = normalizeStatusForDb(row.status) ?? "active";
  if (normalized === "inactive") return "inactive";
  return normalized;
};

const buildSystemNotes = (
  notes: unknown,
  displayStatus: string,
  meta: { category?: string; payment_terms?: string; rating?: number; active_orders?: number }
) => {
  const cleanNotes = stripSystemTags(notes);
  const metaParams = new URLSearchParams();
  metaParams.set("category", String(meta.category ?? ""));
  metaParams.set("payment_terms", String(meta.payment_terms ?? ""));
  metaParams.set("rating", String(meta.rating ?? 0));
  metaParams.set("active_orders", String(meta.active_orders ?? 0));
  const lines = [`__gw_vendor_meta:${metaParams.toString()}__`];
  if (displayStatus === "preferred" || displayStatus === "on_hold" || displayStatus === "blocked") {
    lines.push(`__gw_vendor_status:${displayStatus}__`);
  }
  if (cleanNotes) lines.push(cleanNotes);
  return lines.join("\n").trimEnd();
};

const toDbStatus = (displayStatus: string) => {
  if (displayStatus === "preferred") return "active";
  if (displayStatus === "on_hold" || displayStatus === "blocked") return "inactive";
  return displayStatus;
};

const normalizeRating = (value: unknown) => {
  const normalized = normalizeNumber(value, 0);
  const fiveScale = normalized > 5 ? normalized / 20 : normalized;
  return Math.max(0, Math.min(5, fiveScale));
};

const normalizeCount = (value: unknown) => {
  const normalized = normalizeNumber(value, 0);
  return Math.max(0, Math.floor(normalized));
};

const mapVendor = (row: any) => {
  const meta = parseVendorMeta(row.notes ?? "");
  const metaRating = normalizeNumber(meta.rating, 0);
  const metaActiveOrders = normalizeNumber(meta.active_orders, 0);
  return {
  id: row.id,
  name: row.name ?? "",
  status: getDisplayStatus(row),
  category: row.category ?? meta.category ?? "",
  contact: row.contact_name ?? row.contact ?? "",
  contact_name: row.contact_name ?? row.contact ?? "",
  phone: row.phone ?? "",
  email: row.email ?? "",
  address: row.address ?? "",
  payment_terms: row.payment_terms ?? row.paymentTerms ?? meta.payment_terms ?? "",
  rating: metaRating || normalizeNumber(row.rating ?? 0),
  activeOrders: metaActiveOrders || normalizeNumber(row.active_orders ?? row.activeOrders ?? 0),
  active_orders: metaActiveOrders || normalizeNumber(row.active_orders ?? row.activeOrders ?? 0),
  notes: stripSystemTags(row.notes ?? ""),
  };
};

async function updateWithColumnFallback(
  supabase: any,
  companyId: string,
  id: string | number,
  payload: Record<string, unknown>
) {
  const currentPayload = { ...payload };
  let lastResult: any = null;

  for (let i = 0; i < 20; i += 1) {
    const result = await supabase
      .from("vendors")
      .update(currentPayload)
      .eq("company_id", companyId)
      .eq("id", id);
    lastResult = result;
    const message = result.error?.message || "";
    const match = message.match(/Could not find the '([^']+)' column/);
    if (!match) return result;
    const missingColumn = match[1];
    if (!(missingColumn in currentPayload)) return result;
    delete currentPayload[missingColumn];
  }

  return lastResult;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    try {
      await requireRole(["admin", "pm"]);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    if (
      body &&
      typeof body === "object" &&
      ("company_id" in body || "created_by" in body || "created_at" in body)
    ) {
      return NextResponse.json(
        { error: "company_id, created_by, and created_at cannot be updated" },
        { status: 400 }
      );
    }

    const parsed = updateVendorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid vendor payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { supabase, companyId } = await getCompanyId();
    const payload = parsed.data;
    const routeId = normalizeRouteId(id);
    const { data: existingRow, error: existingError } = await supabase
      .from("vendors")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", routeId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message }, { status: 400 });
    }

    if (!existingRow) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    const existingMeta = parseVendorMeta(existingRow.notes ?? "");
    const existingDisplayStatus = getDisplayStatus(existingRow);

    const updatePayload: Record<string, unknown> = {};
    if (payload.name !== undefined) updatePayload.name = payload.name;
    const displayStatus = normalizeStatusForDb(payload.status);
    if (displayStatus !== undefined) updatePayload.status = toDbStatus(displayStatus);
    if (payload.category !== undefined) updatePayload.category = payload.category;
    if (payload.contact_name !== undefined || payload.contact !== undefined) {
      const contactName = payload.contact_name ?? payload.contact ?? "";
      updatePayload.contact_name = contactName;
      updatePayload.contact = payload.contact ?? payload.contact_name ?? contactName;
    }
    if (payload.phone !== undefined) updatePayload.phone = payload.phone;
    if (payload.email !== undefined) updatePayload.email = payload.email;
    if (payload.address !== undefined) updatePayload.address = payload.address;
    if (payload.payment_terms !== undefined) updatePayload.payment_terms = payload.payment_terms;
    if (payload.rating !== undefined) updatePayload.rating = normalizeRating(payload.rating);
    if (payload.active_orders !== undefined || payload.activeOrders !== undefined) {
      updatePayload.active_orders = normalizeCount(payload.active_orders ?? payload.activeOrders);
    }
    const ratingInput =
      payload.rating !== undefined
        ? Math.max(0, Math.min(100, normalizeNumber(payload.rating, 0)))
        : normalizeNumber(existingMeta.rating, normalizeNumber(existingRow.rating, 0));
    const activeOrdersInput =
      payload.active_orders !== undefined || payload.activeOrders !== undefined
        ? normalizeCount(payload.active_orders ?? payload.activeOrders)
        : normalizeNumber(existingMeta.active_orders, normalizeNumber(existingRow.active_orders ?? existingRow.activeOrders, 0));
    const categoryInput =
      payload.category !== undefined
        ? payload.category
        : (existingMeta.category || existingRow.category || "");
    const paymentTermsInput =
      payload.payment_terms !== undefined
        ? payload.payment_terms
        : (existingMeta.payment_terms || existingRow.payment_terms || existingRow.paymentTerms || "");
    const notesBase = payload.notes !== undefined ? payload.notes : existingRow.notes;
    updatePayload.notes = buildSystemNotes(notesBase, displayStatus ?? existingDisplayStatus, {
      category: categoryInput,
      payment_terms: paymentTermsInput,
      rating: ratingInput,
      active_orders: activeOrdersInput,
    });

    let error: any = null;
    if ("status" in updatePayload) {
      const statusCandidates = getStatusFallbacks(updatePayload.status);
      const baseUpdatePayload = { ...updatePayload };
      delete baseUpdatePayload.status;

      for (const statusCandidate of statusCandidates) {
        const attemptPayload = { ...baseUpdatePayload, status: statusCandidate };
        const result = await updateWithColumnFallback(
          supabase,
          companyId,
          routeId,
          attemptPayload
        );
        error = result.error;
        if (!error) break;
        if (!error?.message?.includes("vendors_status_check")) break;
      }

      if (error?.message?.includes("vendors_status_check")) {
        if (Object.keys(baseUpdatePayload).length > 0) {
          const fallbackResult = await updateWithColumnFallback(
            supabase,
            companyId,
            routeId,
            baseUpdatePayload
          );
          error = fallbackResult.error;
        }
      }
    } else {
      const result = await updateWithColumnFallback(
        supabase,
        companyId,
        routeId,
        updatePayload
      );
      error = result.error;
    }

    if (error?.message?.includes("vendors_status_check")) {
      return NextResponse.json(
        { error: "Unsupported vendor status for this database. Use active/inactive." },
        { status: 400 }
      );
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const { data: updatedRow, error: fetchError } = await supabase
      .from("vendors")
      .select("*")
      .eq("company_id", companyId)
      .eq("id", routeId)
      .maybeSingle();

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 400 });
    }

    if (!updatedRow) {
      return NextResponse.json({ error: "Vendor not found" }, { status: 404 });
    }

    const mappedVendor = mapVendor(updatedRow);
    return NextResponse.json({ item: mappedVendor, vendor: mappedVendor });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
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
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const { supabase, companyId } = await getCompanyId();

    const { error } = await supabase
      .from("vendors")
      .delete()
      .eq("company_id", companyId)
      .eq("id", normalizeRouteId(id));

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, item: { success: true } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || "Unexpected server error" }, { status: 500 });
  }
}
