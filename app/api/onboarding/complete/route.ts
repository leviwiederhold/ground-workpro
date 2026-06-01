import { NextResponse } from "next/server";
import { z } from "zod";
import { getOptionalCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { upsertProfileColumns } from "@/lib/user/profileRecord";
import { sanitizeProfileFullName } from "@/lib/user/profileFields";
import {
  getSetupStatusForUser,
  markSetupStepCompleted,
  markOptionalSetupStepsSkipped,
} from "@/lib/onboarding/setupFlow";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  first_name: z.string().trim().max(80).optional(),
  last_name: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(40).optional(),
  avatar_url: z.string().trim().max(2048).optional(),
  job_title: z.string().trim().max(120).optional(),
  timezone: z.string().trim().max(120).optional(),
  landing_page: z.string().trim().max(80).optional(),
  emergency_contact: z.string().trim().max(200).optional(),
  notification_preferences: z
    .object({
      email_notifications: z.boolean().optional(),
      push_notifications: z.boolean().optional(),
      message_notifications: z.boolean().optional(),
      calendar_notifications: z.boolean().optional(),
    })
    .partial()
    .optional(),
  // Owner/admin company step
  company_name: z.string().trim().max(160).optional(),
  company_phone: z.string().trim().max(60).optional(),
  company_address: z.string().trim().max(500).optional(),
  company_timezone: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  try {
    const { supabase, companyId, userId, userEmail } = await getOptionalCompanyId();
    const admin = getSupabaseAdmin();
    const db = admin ?? supabase;

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid setup payload" }, { status: 422 });
    }
    const data = parsed.data;

    // Resolve role to decide which steps to persist/mark.
    const statusBefore = await getSetupStatusForUser({
      supabase,
      companyId,
      userId,
      userEmail: String(userEmail ?? "").trim(),
    });
    const isOwner = statusBefore.role === "admin";

    const fullName = sanitizeProfileFullName(
      `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim(),
      String(userEmail ?? "")
    );

    // 1. Personal profile + account prefs + authoritative completion flag.
    const nowIso = new Date().toISOString();
    const profilePayload: Record<string, unknown> = {
      id: userId,
      setup_completed_at: nowIso,
    };
    if (fullName) {
      profilePayload.full_name = fullName;
      profilePayload.name = fullName;
    }
    if (data.phone !== undefined) profilePayload.phone = data.phone || null;
    if (data.avatar_url) profilePayload.avatar_url = data.avatar_url;
    if (data.job_title !== undefined) profilePayload.job_title = data.job_title || null;
    if (data.timezone) profilePayload.timezone = data.timezone;
    if (data.landing_page) profilePayload.landing_page = data.landing_page;
    if (data.notification_preferences) {
      profilePayload.notification_preferences = data.notification_preferences;
    }

    const profileResult = await upsertProfileColumns({
      supabase: db,
      userId,
      payload: profilePayload,
      selectColumns: ["full_name", "setup_completed_at"],
    });
    if (profileResult.error) {
      return NextResponse.json({ error: profileResult.error.message }, { status: 400 });
    }

    // 2. Owner/admin: company settings + company-level completion flag.
    if (isOwner && companyId) {
      const companyPayload: Record<string, unknown> = { setup_completed_at: nowIso };
      if (data.company_name) companyPayload.name = data.company_name;
      if (data.company_timezone) companyPayload.timezone = data.company_timezone;
      if (data.company_phone !== undefined) companyPayload.phone = data.company_phone || null;
      if (data.company_address !== undefined) companyPayload.address = data.company_address || null;

      // Tolerate environments missing newer columns.
      const keys = Object.keys(companyPayload);
      for (let attempt = 0; attempt < keys.length + 1; attempt += 1) {
        const update = await db.from("companies").update(companyPayload).eq("id", companyId);
        if (!update.error) break;
        const message = update.error.message ?? "";
        const missing = keys.find((k) => message.includes(k));
        if (!missing) break;
        delete companyPayload[missing];
        if (Object.keys(companyPayload).length === 0) break;
      }
    }

    // 3. Update the caller's OWN employee row (team profile) when present.
    if (companyId && (data.job_title !== undefined || data.phone !== undefined || data.emergency_contact !== undefined || fullName)) {
      const employeePayload: Record<string, unknown> = {};
      if (fullName) {
        employeePayload.name = fullName;
        employeePayload.full_name = fullName;
      }
      if (data.phone !== undefined) employeePayload.phone = data.phone || null;
      if (data.job_title !== undefined) employeePayload.job_title = data.job_title || null;
      if (data.emergency_contact !== undefined) employeePayload.emergency_contact = data.emergency_contact || null;

      if (Object.keys(employeePayload).length > 0) {
        const empKeys = Object.keys(employeePayload);
        for (let attempt = 0; attempt < empKeys.length + 1; attempt += 1) {
          const update = await db
            .from("employees")
            .update(employeePayload)
            .eq("company_id", companyId)
            .eq("user_id", userId);
          if (!update.error) break;
          const message = update.error.message ?? "";
          const missing = empKeys.find((k) => message.includes(k));
          if (!missing) break;
          delete employeePayload[missing];
          if (Object.keys(employeePayload).length === 0) break;
        }
      }
    }

    // 4. Mark legacy checklist steps complete so older logic agrees.
    try {
      await markSetupStepCompleted({ supabase: db, companyId, userId, key: "finish_profile", scope: "user" });
      await markSetupStepCompleted({ supabase: db, companyId, userId, key: "complete_account_settings", scope: "user" });
      if (isOwner) {
        await markSetupStepCompleted({ supabase: db, companyId, userId, key: "complete_company_settings", scope: "company" });
      }
      await markOptionalSetupStepsSkipped({ supabase: db, companyId, userId });
    } catch {
      // Non-fatal — setup_completed_at is the authoritative flag.
    }

    return NextResponse.json({ item: { setup_completed_at: nowIso, success: true } });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
