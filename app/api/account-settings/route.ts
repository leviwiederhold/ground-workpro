import { NextResponse } from "next/server";
import { z } from "zod";
import { getCompanyId, TenantResolverError } from "@/lib/tenant/getCompanyId";
import { normalizeTimezoneOption } from "@/lib/user/profileFields";
import { resolveDisplayName } from "@/lib/user/identity";
import { markSetupStepCompleted } from "@/lib/onboarding/setupFlow";
import { selectProfileColumns, upsertProfileColumns, type ProfileRecord } from "@/lib/user/profileRecord";

const accountSettingsSchema = z.object({
  timezone: z.string().trim().max(120).optional().or(z.literal("")),
  appearance: z.enum(["system", "light", "dark"]).optional(),
  notification_preferences: z
    .object({
      email_notifications: z.boolean().optional(),
      push_notifications: z.boolean().optional(),
      message_notifications: z.boolean().optional(),
      calendar_notifications: z.boolean().optional(),
    })
    .optional(),
});

type SettingsRow = ProfileRecord;

function normalizeNotificationPreferences(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    email_notifications: source.email_notifications !== false,
    push_notifications: source.push_notifications !== false,
    message_notifications: source.message_notifications !== false,
    calendar_notifications: source.calendar_notifications !== false,
  };
}

function normalizeSettings(row: SettingsRow | null | undefined, fallbackEmail: string) {
  const email = fallbackEmail;
  const fullName = String(row?.full_name ?? "").trim();
  return {
    email,
    display_name: "",
    full_name: fullName,
    resolved_name: resolveDisplayName({ fullName, email }),
    timezone: String(row?.timezone ?? "").trim(),
    appearance: String(row?.appearance_preference ?? "").trim() || "system",
    notification_preferences: normalizeNotificationPreferences(row?.notification_preferences),
  };
}

async function selectSettings(supabase: Awaited<ReturnType<typeof getCompanyId>>["supabase"], userId: string) {
  return await selectProfileColumns(supabase, userId, [
    "full_name",
    "timezone",
    "appearance_preference",
    "notification_preferences",
  ]);
}

export async function GET() {
  try {
    const { supabase, userId, userEmail } = await getCompanyId();
    const authUser = await supabase.auth.getUser();
    const fallbackEmail = String(authUser.data?.user?.email ?? userEmail ?? "").trim();
    const settingsResult = await selectSettings(supabase, userId);
    if (settingsResult.error) {
      return NextResponse.json({ error: settingsResult.error.message }, { status: 400 });
    }
    return NextResponse.json({ item: normalizeSettings(settingsResult.data as SettingsRow, fallbackEmail) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, companyId, userId, userEmail } = await getCompanyId();
    const body = await request.json().catch(() => null);
    const parsed = accountSettingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Validation error",
          details: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const authUser = await supabase.auth.getUser();
    const fallbackEmail = String(authUser.data?.user?.email ?? userEmail ?? "").trim();
    const payload = {
      ...parsed.data,
      timezone: normalizeTimezoneOption(parsed.data.timezone),
    };
    const updatePayload = {
      id: userId,
      timezone: payload.timezone || null,
      appearance_preference: payload.appearance || "system",
      notification_preferences: payload.notification_preferences || {},
    };

    const upsertResult = await upsertProfileColumns({
      supabase,
      userId,
      payload: updatePayload,
      selectColumns: ["full_name", "timezone", "appearance_preference", "notification_preferences"],
    });
    if (upsertResult.error) {
      return NextResponse.json({ error: upsertResult.error.message }, { status: 400 });
    }

    await markSetupStepCompleted({
      supabase,
      companyId,
      userId,
      key: "complete_account_settings",
      scope: "user",
    });

    return NextResponse.json({ item: normalizeSettings(upsertResult.data as SettingsRow, fallbackEmail) });
  } catch (error) {
    if (error instanceof TenantResolverError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
